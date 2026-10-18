import { addDays } from '../lib/dates';
import { sendEmail } from '../lib/email';
import { AppError, badRequest } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { assertPasswordStrength, hashPassword, verifyPassword } from '../lib/passwords';
import { decryptSecret, encryptSecret, generateTotpSecret, randomToken, sha256, verifyTotp } from '../lib/tokens';
import { writeAudit } from '../lib/audit';
import { config } from '../config';

const GENERIC_RESET = 'Nëse llogaria ekziston, udhëzimet e rivendosjes janë përgatitur.';

export async function registerAccount(input: {
  name: string;
  email: string;
  password: string;
  firmName: string;
  planCode?: string;
  ip?: string;
}) {
  assertPasswordStrength(input.password);
  const email = input.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new AppError('EMAIL_IN_USE', 409, 'Ky email është i regjistruar.');

  const plan =
    (input.planCode
      ? await prisma.subscriptionPlan.findFirst({ where: { code: input.planCode, isActive: true, isPublic: true } })
      : null) ?? (await prisma.subscriptionPlan.findFirst({ where: { code: 'PROFESSIONAL', isActive: true } }));
  if (!plan) throw new AppError('PLAN_MISSING', 500, 'Planet e abonimit nuk janë konfiguruar. Ekzekutoni seed-in.');

  const ownerRole = await prisma.role.findFirst({ where: { scopeKey: 'system', key: 'OWNER' } });
  if (!ownerRole) throw new AppError('ROLE_MISSING', 500, 'Rolet e sistemit mungojnë. Ekzekutoni seed-in.');

  const trialDays = Number((await platformNumber('trialDays')) ?? config.trialDays);
  const passwordHash = await hashPassword(input.password);
  const rawToken = randomToken();
  const trialEnds = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, name: input.name.trim(), passwordHash },
    });
    const firm = await tx.accountingFirm.create({
      data: { legalName: input.firmName.trim(), email, status: 'ACTIVE' },
    });
    await tx.firmSettings.create({ data: { firmId: firm.id } });
    await tx.firmMembership.create({
      data: { firmId: firm.id, userId: user.id, roleId: ownerRole.id, status: 'ACTIVE' },
    });
    const subscription = await tx.subscription.create({
      data: {
        firmId: firm.id,
        planId: plan.id,
        status: 'TRIAL',
        interval: 'MONTHLY',
        trialEndsAt: trialEnds,
        readOnly: false,
      },
    });
    await tx.subscriptionEvent.create({
      data: {
        firmId: firm.id,
        subscriptionId: subscription.id,
        type: 'TRIAL_STARTED',
        note: `Provë e autorizuar për ${trialDays} ditë në planin ${plan.name}. Nuk është pagesë.`,
      },
    });
    await tx.verificationToken.create({
      data: {
        userId: user.id,
        purpose: 'verify-email',
        tokenHash: sha256(rawToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    await writeAudit(
      {
        firmId: firm.id,
        userId: user.id,
        action: 'auth.register',
        entityType: 'AccountingFirm',
        entityId: firm.id,
        summary: 'U regjistrua zyra e kontabilitetit.',
        ip: input.ip,
      },
      tx,
    );
    return { user, firm };
  });

  const link = `${config.appUrl}/verifiko-emailin?token=${rawToken}`;
  await sendEmail({
    to: email,
    subject: 'Verifikoni emailin — Kontabiliteti Pro',
    body: `Përshëndetje ${created.user.name},\n\nVerifikoni emailin e zyrës duke hapur këtë lidhje:\n${link}\n\nLidhja skadon pas 24 orësh.`,
    firmId: created.firm.id,
    relatedType: 'verify-email',
  });

  return {
    userId: created.user.id,
    firmId: created.firm.id,
    devVerificationToken: config.exposeDevTokens ? rawToken : undefined,
  };
}

export async function loginAccount(input: { email: string; password: string; ip?: string; userAgent?: string }) {
  const email = input.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  const valid = user ? await verifyPassword(input.password, user.passwordHash) : false;
  if (!user || !valid || user.status !== 'ACTIVE') {
    await writeAudit({
      userId: user?.id,
      action: 'auth.login_failed',
      summary: 'Përpjekje e dështuar për hyrje.',
      metadata: { email },
      ip: input.ip,
    });
    throw new AppError('INVALID_CREDENTIALS', 401, 'Email-i ose fjalëkalimi nuk është i saktë.');
  }
  if (user.totpEnabledAt && user.totpSecretEncrypted) {
    const challenge = randomToken();
    await prisma.verificationToken.create({
      data: {
        userId: user.id,
        purpose: '2fa-login',
        tokenHash: sha256(challenge),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
    return { requiresTwoFactor: true as const, challengeToken: challenge };
  }
  const session = await createSession(user.id, input.ip, input.userAgent);
  await writeAudit({ userId: user.id, action: 'auth.login', summary: 'Hyrje në llogari.', ip: input.ip });
  return { requiresTwoFactor: false as const, token: session.token, user };
}

export async function verifyTwoFactor(input: { challengeToken: string; code: string; ip?: string; userAgent?: string }) {
  const token = await consumeToken(input.challengeToken, '2fa-login');
  const user = await prisma.user.findUnique({ where: { id: token.userId } });
  if (!user?.totpSecretEncrypted || !user.totpEnabledAt) throw badRequest('Verifikimi me dy hapa nuk është aktiv.');
  const secret = decryptSecret(user.totpSecretEncrypted);
  if (!verifyTotp(secret, input.code)) throw new AppError('INVALID_2FA', 401, 'Kodi i verifikimit nuk është i saktë.');
  const session = await createSession(user.id, input.ip, input.userAgent);
  await writeAudit({ userId: user.id, action: 'auth.login', summary: 'Hyrje me verifikim me dy hapa.', ip: input.ip });
  return { token: session.token, user };
}

export async function logoutSession(sessionId: string, userId: string, ip?: string) {
  await prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
  await writeAudit({ userId, action: 'auth.logout', summary: 'Dalje nga pajisja aktuale.', ip });
}

export async function logoutAll(userId: string, ip?: string) {
  await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  await writeAudit({ userId, action: 'auth.logout_all', summary: 'Dalje nga të gjitha sesionet.', ip });
}

export async function verifyEmail(rawToken: string) {
  const token = await consumeToken(rawToken, 'verify-email');
  await prisma.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: new Date() } });
  await writeAudit({ userId: token.userId, action: 'auth.email_verified', summary: 'Emaili u verifikua.' });
}

export async function resendVerification(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('UNAUTHENTICATED', 401, 'Duhet të hyni në llogari.');
  if (user.emailVerifiedAt) return { alreadyVerified: true as const };
  const rawToken = randomToken();
  await prisma.verificationToken.create({
    data: {
      userId,
      purpose: 'verify-email',
      tokenHash: sha256(rawToken),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  const link = `${config.appUrl}/verifiko-emailin?token=${rawToken}`;
  await sendEmail({
    to: user.email,
    subject: 'Verifikoni emailin — Kontabiliteti Pro',
    body: `Verifikoni emailin:\n${link}`,
  });
  return { alreadyVerified: false as const, devVerificationToken: config.exposeDevTokens ? rawToken : undefined };
}

export async function forgotPassword(emailInput: string) {
  const email = emailInput.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== 'ACTIVE') return { message: GENERIC_RESET };
  const rawToken = randomToken();
  await prisma.verificationToken.create({
    data: {
      userId: user.id,
      purpose: 'password-reset',
      tokenHash: sha256(rawToken),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const link = `${config.appUrl}/rivendos-fjalekalimin?token=${rawToken}`;
  await sendEmail({
    to: user.email,
    subject: 'Rivendosja e fjalëkalimit — Kontabiliteti Pro',
    body: `Rivendosni fjalëkalimin:\n${link}\n\nLidhja skadon pas një ore.`,
  });
  return {
    message: GENERIC_RESET,
    devResetToken: config.exposeDevTokens ? rawToken : undefined,
  };
}

export async function resetPassword(rawToken: string, password: string, ip?: string) {
  assertPasswordStrength(password);
  const token = await consumeToken(rawToken, 'password-reset');
  await prisma.user.update({ where: { id: token.userId }, data: { passwordHash: await hashPassword(password) } });
  await prisma.session.updateMany({ where: { userId: token.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  await writeAudit({ userId: token.userId, action: 'auth.password_reset', summary: 'Fjalëkalimi u rivendos.', ip });
}

export async function setupTwoFactor(userId: string) {
  const secret = generateTotpSecret();
  await prisma.user.update({
    where: { id: userId },
    data: { totpSecretEncrypted: encryptSecret(secret), totpEnabledAt: null },
  });
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const label = encodeURIComponent(user?.email ?? 'kontabilisti');
  return {
    secret,
    otpauthUrl: `otpauth://totp/KontabilitetiPro:${label}?secret=${secret}&issuer=KontabilitetiPro&digits=6&period=30`,
  };
}

export async function enableTwoFactor(userId: string, code: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.totpSecretEncrypted) throw badRequest('Filloni së pari konfigurimin e verifikimit me dy hapa.');
  if (!verifyTotp(decryptSecret(user.totpSecretEncrypted), code)) throw badRequest('Kodi nuk është i saktë.');
  await prisma.user.update({ where: { id: userId }, data: { totpEnabledAt: new Date() } });
  await writeAudit({ userId, action: 'auth.2fa_enabled', summary: 'U aktivizua verifikimi me dy hapa.' });
}

export async function disableTwoFactor(userId: string, password: string, code: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('UNAUTHENTICATED', 401, 'Duhet të hyni në llogari.');
  if (!(await verifyPassword(password, user.passwordHash))) throw new AppError('INVALID_CREDENTIALS', 401, 'Fjalëkalimi nuk është i saktë.');
  if (!user.totpSecretEncrypted || !verifyTotp(decryptSecret(user.totpSecretEncrypted), code)) {
    throw badRequest('Kodi nuk është i saktë.');
  }
  await prisma.user.update({ where: { id: userId }, data: { totpSecretEncrypted: null, totpEnabledAt: null } });
  await writeAudit({ userId, action: 'auth.2fa_disabled', summary: 'U çaktivizua verifikimi me dy hapa.' });
}

export async function currentProfile(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('UNAUTHENTICATED', 401, 'Duhet të hyni në llogari.');
  const memberships = await prisma.firmMembership.findMany({
    where: { userId, status: 'ACTIVE' },
    include: { firm: true, role: { include: { permissions: { include: { permission: true } } } } },
  });
  const clientAccess = await prisma.companyMembership.findMany({
    where: { userId, status: 'ACTIVE' },
    include: { company: true },
  });
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: Boolean(user.emailVerifiedAt),
      twoFactorEnabled: Boolean(user.totpEnabledAt),
      isPlatformAdmin: user.isPlatformAdmin,
      locale: user.locale,
    },
    firms: memberships.map((membership) => ({
      id: membership.firm.id,
      legalName: membership.firm.legalName,
      role: membership.role.key,
      roleName: membership.role.name,
      status: membership.firm.status,
      permissions: membership.role.permissions.map((item) => item.permission.key),
    })),
    clientCompanies: clientAccess.map((membership) => ({
      id: membership.company.id,
      legalName: membership.company.legalName,
      firmId: membership.firmId,
      canUpload: membership.canUpload,
    })),
  };
}

async function createSession(userId: string, ip?: string, userAgent?: string) {
  const token = randomToken();
  const expires = new Date();
  expires.setDate(expires.getDate() + config.sessionDays);
  await prisma.session.create({
    data: { userId, tokenHash: sha256(token), expiresAt: expires, ip, userAgent: userAgent?.slice(0, 300) },
  });
  return { token };
}

async function consumeToken(rawToken: string, purpose: string) {
  const token = await prisma.verificationToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
  if (!token || token.purpose !== purpose || token.usedAt || token.expiresAt < new Date()) {
    throw badRequest('Lidhja nuk është e vlefshme ose ka skaduar.');
  }
  await prisma.verificationToken.update({ where: { id: token.id }, data: { usedAt: new Date() } });
  return token;
}

async function platformNumber(key: string): Promise<number | null> {
  const setting = await prisma.platformSetting.findUnique({ where: { key } });
  if (!setting || typeof setting.value !== 'number') return null;
  return setting.value;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.env === 'production',
    path: '/',
    maxAge: config.sessionDays * 24 * 60 * 60 * 1000,
  };
}

void addDays;
