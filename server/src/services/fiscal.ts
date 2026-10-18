import { Prisma, type FiscalCouponType, type FiscalPaymentKind, type FiscalReceiptStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { writeAudit } from '../lib/audit';
import { AppError, badRequest, notFound } from '../lib/errors';
import { decryptSecret, encryptSecret } from '../lib/tokens';
import type { CompanyActor } from '../types/express';
import {
  AtkTransportError,
  checkAtkHost,
  sanitizeAtkMessage,
  signCsr,
  submitPosCoupon,
  verifyBusiness,
  type FiscalEnvironmentName,
} from '../fiscal/atk';
import { buildCoupon, newVerificationNo, type CouponLine } from '../fiscal/coupon';
import { assertUint } from '../fiscal/money';
import {
  certificateMatchesKey,
  describeCertificate,
  generateCsr,
  privateKeyExists,
  readPrivateKey,
  relativeKeyPath,
  retirePrivateKey,
  savePrivateKey,
} from '../fiscal/keys';
import { renderFiscalReceiptPdf } from '../fiscal/pdf';
import { citizenQrPayload, signEncodedCoupon } from '../fiscal/sign';
import { fiscalDocumentTitle, fiscalReadiness } from '../fiscal/status';

const ACTIVE: FiscalReceiptStatus[] = ['DRAFT', 'READY', 'PROCESSING', 'FISCALIZED', 'UNKNOWN'];
const BLOCKING: FiscalReceiptStatus[] = ['PROCESSING', 'FISCALIZED', 'UNKNOWN'];

function scope(actor: CompanyActor) {
  return { firmId: actor.firmId, companyId: actor.companyId };
}

function publicError(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof Error) return error.message.slice(0, 400);
  return 'Veprimi fiskal dështoi.';
}

async function loadSettings(actor: CompanyActor) {
  const settings = await prisma.fiscalSettings.findFirst({
    where: scope(actor),
    include: { branches: { include: { terminals: true }, orderBy: { branchNumber: 'asc' } } },
  });
  if (!settings) throw notFound('Konfigurimi i fiskalizimit nuk u gjet.');
  return settings;
}

function terminalReady(terminal: { certificatePem: string | null; onboardedAt: Date | null; id: string; companyId: string }) {
  return Boolean(terminal.certificatePem && terminal.onboardedAt && privateKeyExists(terminal.companyId, terminal.id));
}

function presentSettings(settings: Awaited<ReturnType<typeof loadSettings>>) {
  const readyTerminals = settings.branches.flatMap((branch) => branch.terminals).filter(terminalReady);
  const dataComplete = Boolean(
    settings.nui &&
      settings.fiscalizationNoEnc &&
      settings.applicationId &&
      settings.defaultUnit &&
      settings.itemType &&
      settings.branches.length > 0 &&
      settings.branches.some((branch) => branch.terminals.length > 0),
  );
  const readiness = fiscalReadiness({
    dataComplete,
    certificateConfigured: readyTerminals.length > 0,
    connectionChecked: settings.connectionOk,
  });
  let certificateSubject: string | null = null;
  const first = readyTerminals[0];
  if (first?.certificatePem) {
    try {
      certificateSubject = describeCertificate(first.certificatePem).subject;
    } catch {
      certificateSubject = null;
    }
  }
  return {
    id: settings.id,
    environment: settings.environment,
    nui: settings.nui,
    hasFiscalizationNo: Boolean(settings.fiscalizationNoEnc),
    applicationId: settings.applicationId,
    businessName: settings.businessName,
    defaultUnit: settings.defaultUnit,
    itemType: settings.itemType,
    connectionCheckedAt: settings.connectionCheckedAt,
    connectionOk: settings.connectionOk,
    connectionNote: settings.connectionNote,
    label: readiness.label,
    ready: readiness.ready,
    steps: readiness.steps,
    certificateSubject,
    disclaimer:
      'Ky modul flet protokollin publik të shembullit ATK. Nuk është certifikim i programit dhe nuk e dërgon kuponin nëse mungon një përgjigje e suksesshme.',
    branches: settings.branches.map((branch) => ({
      id: branch.id,
      branchNumber: branch.branchNumber,
      location: branch.location,
      terminals: branch.terminals.map((terminal) => ({
        id: terminal.id,
        posNumber: terminal.posNumber,
        hasCertificate: terminalReady(terminal),
        certificateNotAfter: terminal.certificateNotAfter,
        keyFingerprint: terminal.keyFingerprint,
        onboardedAt: terminal.onboardedAt,
      })),
    })),
  };
}

export async function fiscalOverview(actor: CompanyActor) {
  const settings = await prisma.fiscalSettings.findFirst({
    where: scope(actor),
    include: { branches: { include: { terminals: true }, orderBy: { branchNumber: 'asc' } } },
  });
  const recent = await prisma.fiscalReceipt.findMany({
    where: scope(actor),
    orderBy: { createdAt: 'desc' },
    take: 8,
    include: { invoice: { select: { displayNumber: true } } },
  });
  if (!settings) {
    const readiness = fiscalReadiness({ dataComplete: false, certificateConfigured: false, connectionChecked: false });
    return {
      configured: false,
      label: readiness.label,
      ready: false,
      steps: readiness.steps,
      environment: 'TEST' as const,
      branches: [],
      recent: [],
      disclaimer:
        'NUI dhe numri i fiskalizimit merren nga ATK dhe EDI. Dega, POS-i dhe njësia i vendosen këtu. Çelësi privat krijohet në server dhe nuk shfaqet.',
    };
  }
  return { configured: true, ...presentSettings(settings), recent: recent.map(publicReceipt) };
}

export async function saveFiscalSettings(
  actor: CompanyActor,
  input: {
    nui: string;
    fiscalizationNo?: string;
    applicationId: string;
    defaultUnit: string;
    itemType: string;
    environment: FiscalEnvironmentName;
    confirmProduction?: boolean;
  },
) {
  assertUint(input.nui, 'NUI');
  assertUint(input.applicationId, 'Numri i aplikacionit');
  if (input.environment === 'PRODUCTION' && input.confirmProduction !== true) {
    throw badRequest('Produksioni dërgon kuponë të vërtetë. Konfirmoni veçmas kalimin.');
  }
  if (!input.defaultUnit.trim() || !input.itemType.trim()) {
    throw badRequest('Njësia matëse dhe lloji i artikullit janë të detyrueshme. Shembulli publik përdor TT, por duhet ta vendosni ju.');
  }
  const current = await prisma.fiscalSettings.findFirst({ where: scope(actor), include: { branches: { include: { terminals: true } } } });
  const nextFiscalization = input.fiscalizationNo?.trim()
    ? encryptSecret(input.fiscalizationNo.trim())
    : current?.fiscalizationNoEnc;
  if (!nextFiscalization) throw badRequest('Numri i fiskalizimit merret nga EDI dhe është i detyrueshëm.');
  const fiscalizationChanged = Boolean(
    current?.fiscalizationNoEnc &&
      input.fiscalizationNo?.trim() &&
      decryptSecret(current.fiscalizationNoEnc) !== input.fiscalizationNo.trim(),
  );
  const identityChanged = Boolean(
    current?.nui &&
      (current.nui !== input.nui ||
        current.applicationId !== input.applicationId ||
        current.environment !== input.environment ||
        fiscalizationChanged),
  );
  if (identityChanged && current) {
    for (const branch of current.branches) {
      for (const terminal of branch.terminals) {
        retirePrivateKey(actor.companyId, terminal.id);
        await prisma.fiscalPos.updateMany({
          where: { id: terminal.id, ...scope(actor) },
          data: { certificatePem: null, certificateNotAfter: null, keyFingerprint: null, onboardedAt: null, privateKeyPath: null },
        });
      }
    }
  }
  const saved = await prisma.fiscalSettings.upsert({
    where: { companyId: actor.companyId },
    create: {
      ...scope(actor),
      nui: input.nui,
      fiscalizationNoEnc: nextFiscalization,
      applicationId: input.applicationId,
      defaultUnit: input.defaultUnit.trim(),
      itemType: input.itemType.trim(),
      environment: input.environment,
    },
    update: {
      nui: input.nui,
      fiscalizationNoEnc: nextFiscalization,
      applicationId: input.applicationId,
      defaultUnit: input.defaultUnit.trim(),
      itemType: input.itemType.trim(),
      environment: input.environment,
      connectionOk: identityChanged ? false : undefined,
      connectionCheckedAt: identityChanged ? null : undefined,
      connectionNote: identityChanged ? 'Lidhja duhet kontrolluar përsëri pas ndryshimit të identitetit.' : undefined,
    },
  });
  if (saved.firmId !== actor.firmId) throw notFound('Konfigurimi i fiskalizimit nuk u gjet.');
  await writeAudit({
    firmId: actor.firmId,
    companyId: actor.companyId,
    userId: actor.userId,
    action: 'fiscal.settings',
    entityId: saved.id,
    summary: `U ruajt konfigurimi i fiskalizimit për mjedisin ${input.environment}.`,
  });
  return fiscalOverview(actor);
}

export async function addFiscalBranch(actor: CompanyActor, input: { branchNumber: string; location: string }) {
  assertUint(input.branchNumber, 'Dega');
  const settings = await loadSettings(actor);
  try {
    const branch = await prisma.fiscalBranch.create({
      data: { ...scope(actor), settingsId: settings.id, branchNumber: input.branchNumber, location: input.location.trim() },
    });
    await writeAudit({
      firmId: actor.firmId,
      companyId: actor.companyId,
      userId: actor.userId,
      action: 'fiscal.branch',
      entityId: branch.id,
      summary: `U shtua dega ${input.branchNumber}.`,
    });
    return fiscalOverview(actor);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw badRequest('Kjo degë ekziston tashmë për kompaninë.');
    }
    throw error;
  }
}

export async function addFiscalPos(actor: CompanyActor, input: { branchId: string; posNumber: string }) {
  assertUint(input.posNumber, 'POS');
  const branch = await prisma.fiscalBranch.findFirst({ where: { id: input.branchId, ...scope(actor) } });
  if (!branch) throw notFound('Dega nuk u gjet.');
  try {
    const pos = await prisma.fiscalPos.create({
      data: { ...scope(actor), branchId: branch.id, posNumber: input.posNumber },
    });
    await writeAudit({
      firmId: actor.firmId,
      companyId: actor.companyId,
      userId: actor.userId,
      action: 'fiscal.pos',
      entityId: pos.id,
      summary: `U shtua POS ${input.posNumber}.`,
    });
    return fiscalOverview(actor);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw badRequest('Ky POS ekziston tashmë në degë.');
    }
    throw error;
  }
}

export async function onboardFiscalPos(actor: CompanyActor, posId: string) {
  const settings = await loadSettings(actor);
  const terminal = settings.branches.flatMap((branch) => branch.terminals.map((item) => ({ ...item, branch }))).find((item) => item.id === posId);
  if (!terminal) throw notFound('POS-i nuk u gjet.');
  if (!settings.nui || !settings.fiscalizationNoEnc || !settings.applicationId) {
    throw badRequest('Plotësoni NUI, numrin e fiskalizimit dhe numrin e aplikacionit para certifikatës.');
  }
  const fiscalizationNo = decryptSecret(settings.fiscalizationNoEnc);
  const verified = await verifyBusiness(settings.environment, settings.nui, {
    fiscalization_no: fiscalizationNo,
    pos_id: assertUint(terminal.posNumber, 'POS'),
    branch_id: assertUint(terminal.branch.branchNumber, 'Dega'),
    application_id: assertUint(settings.applicationId, 'Aplikacioni'),
  });
  if (verified.status < 200 || verified.status >= 300) {
    throw new AppError('ATK_REJECTED', 502, `Verifikimi i biznesit u refuzua. ${sanitizeAtkMessage(verified.body)}`);
  }
  const businessName = stringField(verified.body, 'business_name');
  const verificationCode = stringField(verified.body, 'verification_code');
  if (!businessName || !verificationCode) throw new AppError('ATK_REJECTED', 502, 'ATK nuk ktheu emrin e biznesit dhe kodin e verifikimit.');
  const generated = await generateCsr({
    businessName,
    nui: settings.nui,
    branchId: terminal.branch.branchNumber,
    posId: terminal.posNumber,
  });
  const signed = await signCsr(settings.environment, {
    business_name: businessName,
    business_id: assertUint(settings.nui, 'NUI'),
    branch_id: assertUint(terminal.branch.branchNumber, 'Dega'),
    verification_code: verificationCode,
    pos_id: assertUint(terminal.posNumber, 'POS'),
    application_id: assertUint(settings.applicationId, 'Aplikacioni'),
    csr: generated.csrPem,
  });
  const certificatePem = stringField(signed.body, 'signed_certificate');
  if (signed.status < 200 || signed.status >= 300 || !certificatePem?.includes('BEGIN CERTIFICATE')) {
    throw new AppError('ATK_REJECTED', 502, `Nënshkrimi i CSR u refuzua. ${sanitizeAtkMessage(signed.body)}`);
  }
  if (!certificateMatchesKey(certificatePem, generated.pkcs8Pem)) {
    throw new AppError('CERTIFICATE_MISMATCH', 502, 'Certifikata e kthyer nuk përputhet me çelësin e krijuar. Nuk u ruajt.');
  }
  const described = describeCertificate(certificatePem);
  savePrivateKey(actor.companyId, terminal.id, generated.pkcs8Pem);
  await prisma.fiscalPos.updateMany({
    where: { id: terminal.id, ...scope(actor) },
    data: {
      certificatePem,
      certificateNotAfter: described.notAfter,
      keyFingerprint: generated.fingerprint,
      privateKeyPath: relativeKeyPath(actor.companyId, terminal.id),
      onboardedAt: new Date(),
    },
  });
  await prisma.fiscalSettings.updateMany({
    where: { id: settings.id, ...scope(actor) },
    data: { businessName },
  });
  await writeAudit({
    firmId: actor.firmId,
    companyId: actor.companyId,
    userId: actor.userId,
    action: 'fiscal.onboard',
    entityId: terminal.id,
    summary: `U konfigurua certifikata e POS ${terminal.posNumber}. Çelësi mbetet në këtë server.`,
  });
  return fiscalOverview(actor);
}

export async function checkFiscalConnection(actor: CompanyActor) {
  const settings = await loadSettings(actor);
  try {
    const result = await checkAtkHost(settings.environment);
    const ok = result.status >= 200 && result.status < 400;
    await prisma.fiscalSettings.updateMany({
      where: { id: settings.id, ...scope(actor) },
      data: {
        connectionOk: ok,
        connectionCheckedAt: new Date(),
        connectionNote: ok
          ? 'Hosti u arrit. Nuk u krijua dhe nuk u dërgua kupon fiskal.'
          : `Hosti u përgjigj me status ${result.status}. Nuk u dërgua kupon.`,
      },
    });
  } catch (error) {
    await prisma.fiscalSettings.updateMany({
      where: { id: settings.id, ...scope(actor) },
      data: {
        connectionOk: false,
        connectionCheckedAt: new Date(),
        connectionNote: error instanceof AtkTransportError ? error.message : 'Lidhja dështoi. Nuk u dërgua kupon.',
      },
    });
  }
  await writeAudit({
    firmId: actor.firmId,
    companyId: actor.companyId,
    userId: actor.userId,
    action: 'fiscal.check',
    entityId: settings.id,
    summary: 'U kontrollua lidhja me hostin e ATK-së pa dërguar kupon.',
  });
  return fiscalOverview(actor);
}

export async function fiscalInvoices(actor: CompanyActor) {
  const settings = await prisma.fiscalSettings.findFirst({
    where: scope(actor),
    include: { branches: { include: { terminals: true } } },
  });
  const invoices = await prisma.invoice.findMany({
    where: { ...scope(actor), currency: 'EUR' },
    orderBy: { issueDate: 'desc' },
    take: 100,
    include: {
      lines: true,
      fiscalReceipts: { where: { type: 'SALE' }, orderBy: { createdAt: 'desc' }, take: 3 },
    },
  });
  return invoices.map((invoice) => {
    const blockers = invoiceBlockers(invoice, settings);
    const active = invoice.fiscalReceipts.find((receipt) => ACTIVE.includes(receipt.status));
    return {
      id: invoice.id,
      displayNumber: invoice.displayNumber,
      issueDate: invoice.issueDate,
      total: invoice.total,
      status: invoice.status,
      ready: blockers.length === 0 && !active,
      blockers: active ? [`Ekziston kupon ${active.couponId} me status ${active.status}.`, ...blockers] : blockers,
      receipt: active ? publicReceipt(active) : null,
    };
  });
}

export async function listFiscalReceipts(actor: CompanyActor, query: { q?: string; status?: string; page: number; pageSize: number }) {
  const where: Prisma.FiscalReceiptWhereInput = { ...scope(actor) };
  if (query.status) where.status = query.status as FiscalReceiptStatus;
  if (query.q) {
    where.OR = [
      { couponId: { contains: query.q } },
      { transactionId: { contains: query.q } },
      { invoice: { displayNumber: { contains: query.q, mode: 'insensitive' } } },
    ];
  }
  const [total, rows] = await prisma.$transaction([
    prisma.fiscalReceipt.count({ where }),
    prisma.fiscalReceipt.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { invoice: { select: { displayNumber: true } }, pos: { select: { posNumber: true } } },
    }),
  ]);
  return { total, rows: rows.map(publicReceipt) };
}

export async function getFiscalReceipt(actor: CompanyActor, id: string) {
  const receipt = await prisma.fiscalReceipt.findFirst({
    where: { id, ...scope(actor) },
    include: {
      invoice: { select: { id: true, displayNumber: true, total: true } },
      pos: { select: { posNumber: true, branch: { select: { branchNumber: true, location: true } } } },
      attempts: { orderBy: { createdAt: 'asc' } },
      originalReceipt: { select: { id: true, couponId: true, transactionId: true } },
    },
  });
  if (!receipt) throw notFound('Kuponi fiskal nuk u gjet.');
  return {
    ...publicReceipt(receipt),
    payloadSummary: receipt.payloadSummary,
    detailsBase64: receipt.detailsBase64,
    signature: receipt.signature,
    qrPayload: receipt.status === 'FISCALIZED' ? receipt.qrPayload : null,
    attempts: receipt.attempts.map((attempt) => ({
      id: attempt.id,
      outcome: attempt.outcome,
      httpStatus: attempt.httpStatus,
      message: attempt.message,
      createdAt: attempt.createdAt,
    })),
    originalReceipt: receipt.originalReceipt,
  };
}

export async function submitFiscalInvoice(
  actor: CompanyActor,
  invoiceId: string,
  input: { posId: string; paymentKind: FiscalPaymentKind },
) {
  const settings = await loadSettings(actor);
  const overview = presentSettings(settings);
  if (!overview.ready) throw badRequest(`Fiskalizimi nuk është gati. ${overview.label}.`);
  const terminal = settings.branches.flatMap((branch) => branch.terminals.map((item) => ({ ...item, branch }))).find((item) => item.id === input.posId);
  if (!terminal || !terminalReady(terminal) || !terminal.certificatePem) throw notFound('POS-i nuk u gjet ose nuk ka certifikatë.');
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, ...scope(actor) }, include: { lines: true } });
  if (!invoice) throw notFound('Fatura nuk u gjet.');
  const blockers = invoiceBlockers(invoice, settings);
  if (blockers.length) throw badRequest(blockers.join(' '));
  const privateKey = readPrivateKey(actor.companyId, terminal.id);
  if (!certificateMatchesKey(terminal.certificatePem, privateKey)) {
    throw badRequest('Certifikata nuk përputhet me çelësin në këtë server. Konfiguroni përsëri POS-in.');
  }

  const existing = await prisma.fiscalReceipt.findFirst({
    where: { ...scope(actor), invoiceId, type: 'SALE', status: { in: ACTIVE } },
    orderBy: { createdAt: 'desc' },
  });
  if (existing && (BLOCKING.includes(existing.status) || existing.signature)) {
    if (existing.status === 'READY' && existing.signature) await markUnknown(actor, existing.id, 'Nënshkrimi ekziston, por përgjigjja e ATK-së mungon.');
    return getFiscalReceipt(actor, existing.id);
  }

  const receipt = existing ?? (await reserveReceipt(actor, {
    settingsId: settings.id,
    invoiceId,
    posId: terminal.id,
    type: 'SALE',
    environment: settings.environment,
    paymentKind: input.paymentKind,
    total: invoice.total,
    reason: null,
    originalReceiptId: null,
  }));
  if (receipt.status === 'FISCALIZED' || receipt.status === 'UNKNOWN' || receipt.status === 'PROCESSING') {
    return getFiscalReceipt(actor, receipt.id);
  }

  const lines: CouponLine[] = invoice.lines.map((line) => ({
    description: line.description,
    quantity: line.quantity.toString(),
    vatPercent: line.vatPercent.toString(),
    taxTreatment: line.taxTreatment,
    netAmount: line.netAmount.toString(),
    vatAmount: line.vatAmount.toString(),
    lineTotal: line.lineTotal.toString(),
  }));
  return sendReserved(actor, receipt.id, privateKey, settings.environment, {
    businessId: settings.nui!,
    couponId: receipt.couponId,
    branchId: terminal.branch.branchNumber,
    posId: terminal.posNumber,
    applicationId: settings.applicationId!,
    location: terminal.branch.location,
    operatorId: actor.name,
    verificationNo: receipt.verificationNo,
    type: 'SALE',
    time: Math.floor(Date.now() / 1000),
    unit: settings.defaultUnit!,
    itemType: settings.itemType!,
    paymentKind: input.paymentKind,
    discount: invoice.discountTotal.toString(),
    lines,
  });
}

export async function adjustFiscalReceipt(
  actor: CompanyActor,
  receiptId: string,
  input: { kind: 'CANCEL' | 'RETURN'; reason: string },
) {
  const original = await prisma.fiscalReceipt.findFirst({
    where: { id: receiptId, ...scope(actor) },
    include: { pos: { include: { branch: true } } },
  });
  if (!original) throw notFound('Kuponi fiskal nuk u gjet.');
  if (original.type !== 'SALE' || original.status !== 'FISCALIZED') {
    throw badRequest('Anulohen ose kthehen vetëm kuponët e shitjes që ATK i ka pranuar.');
  }
  const active = await prisma.fiscalReceipt.findFirst({
    where: { ...scope(actor), originalReceiptId: original.id, status: { in: ACTIVE } },
  });
  if (active) return getFiscalReceipt(actor, active.id);
  const settings = await loadSettings(actor);
  if (!settings.nui || !settings.applicationId || !settings.defaultUnit || !settings.itemType) {
    throw badRequest('Konfigurimi është i paplotë për anulim ose kthim.');
  }
  const lines = linesFromSummary(original.payloadSummary);
  if (!lines) throw badRequest('Kuponi origjinal nuk ka artikuj të ruajtur. Nuk krijohet kupon i ri për të mbuluar mungesën.');
  const privateKey = readPrivateKey(actor.companyId, original.posId);
  if (!original.pos.certificatePem || !certificateMatchesKey(original.pos.certificatePem, privateKey)) {
    throw badRequest('Çelësi i POS-it origjinal nuk është në këtë server.');
  }
  const receipt = await reserveReceipt(actor, {
    settingsId: settings.id,
    invoiceId: original.invoiceId,
    posId: original.posId,
    type: input.kind,
    environment: original.environment,
    paymentKind: original.paymentKind,
    total: original.total,
    reason: input.reason.trim(),
    originalReceiptId: original.id,
  });
  return sendReserved(actor, receipt.id, privateKey, original.environment, {
    businessId: settings.nui,
    couponId: receipt.couponId,
    branchId: original.pos.branch.branchNumber,
    posId: original.pos.posNumber,
    applicationId: settings.applicationId!,
    location: original.pos.branch.location,
    operatorId: actor.name,
    verificationNo: receipt.verificationNo,
    type: input.kind,
    time: Math.floor(Date.now() / 1000),
    unit: settings.defaultUnit!,
    itemType: settings.itemType!,
    paymentKind: original.paymentKind,
    referenceNo: original.couponId,
    discount: '0.00',
    lines,
  });
}

export async function fiscalReceiptPdf(actor: CompanyActor, id: string) {
  const receipt = await prisma.fiscalReceipt.findFirst({
    where: { id, ...scope(actor) },
    include: {
      invoice: { select: { displayNumber: true } },
      pos: { include: { branch: true } },
      company: { select: { legalName: true } },
      settings: { select: { nui: true } },
    },
  });
  if (!receipt) throw notFound('Kuponi fiskal nuk u gjet.');
  return renderFiscalReceiptPdf({
    companyName: receipt.company.legalName,
    nui: receipt.settings.nui,
    status: receipt.status,
    type: receipt.type,
    environment: receipt.environment,
    couponId: receipt.couponId,
    transactionId: receipt.transactionId,
    invoiceNumber: receipt.invoice?.displayNumber ?? null,
    total: receipt.total.toFixed(2),
    branchNumber: receipt.pos.branch.branchNumber,
    posNumber: receipt.pos.posNumber,
    verificationNo: receipt.verificationNo,
    qrPayload: receipt.qrPayload,
    errorMessage: receipt.errorMessage,
  });
}

export async function markFiscalUnknown(actor: CompanyActor, receiptId: string) {
  const receipt = await prisma.fiscalReceipt.findFirst({ where: { id: receiptId, ...scope(actor) } });
  if (!receipt) throw notFound('Kuponi fiskal nuk u gjet.');
  if (receipt.status !== 'PROCESSING' && receipt.status !== 'READY') {
    throw badRequest('Vetëm një dërgim i papërfunduar shënohet si rezultat i panjohur.');
  }
  await markUnknown(actor, receipt.id, 'Përdoruesi e shënoi rezultatin si të panjohur. Nuk u krijua kupon i ri.');
  return getFiscalReceipt(actor, receipt.id);
}

async function markUnknown(actor: CompanyActor, receiptId: string, message: string) {
  await prisma.fiscalReceipt.updateMany({
    where: { id: receiptId, ...scope(actor), status: { in: ['PROCESSING', 'READY'] } },
    data: { status: 'UNKNOWN', errorMessage: message, responseAt: new Date() },
  });
  await prisma.fiscalAttempt.create({
    data: { receiptId, ...scope(actor), outcome: 'UNKNOWN', message },
  });
}

async function reserveReceipt(
  actor: CompanyActor,
  input: {
    settingsId: string;
    invoiceId: string | null;
    posId: string;
    type: FiscalCouponType;
    environment: FiscalEnvironmentName;
    paymentKind: FiscalPaymentKind;
    total: Prisma.Decimal;
    reason: string | null;
    originalReceiptId: string | null;
  },
) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const settings = await tx.fiscalSettings.update({
          where: { id: input.settingsId },
          data: { nextCouponId: { increment: 1 } },
        });
        if (settings.companyId !== actor.companyId || settings.firmId !== actor.firmId) throw notFound();
        return tx.fiscalReceipt.create({
          data: {
            ...scope(actor),
            settingsId: input.settingsId,
            invoiceId: input.invoiceId,
            posId: input.posId,
            couponId: String(settings.nextCouponId - 1),
            type: input.type,
            environment: input.environment,
            status: 'READY',
            verificationNo: newVerificationNo(),
            paymentKind: input.paymentKind,
            total: input.total,
            payloadSummary: {},
            originalReceiptId: input.originalReceiptId,
            reason: input.reason,
            createdById: actor.userId,
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
      throw error;
    }
  }
  throw new AppError('FISCAL_CONFLICT', 409, 'Kuponi nuk u rezervua. Provoni përsëri pa e dërguar dy herë.');
}

async function sendReserved(
  actor: CompanyActor,
  receiptId: string,
  privateKey: string,
  environment: FiscalEnvironmentName,
  draft: Parameters<typeof buildCoupon>[0],
) {
  let built;
  try {
    built = buildCoupon(draft);
  } catch (error) {
    await prisma.fiscalReceipt.updateMany({
      where: { id: receiptId, ...scope(actor), status: 'READY', signature: null },
      data: { status: 'NOT_SENT', errorMessage: publicError(error) },
    });
    await prisma.fiscalAttempt.create({
      data: { receiptId, ...scope(actor), outcome: 'NOT_SENT', message: publicError(error) },
    });
    return getFiscalReceipt(actor, receiptId);
  }
  const signed = signEncodedCoupon(privateKey, built.posBytes);
  const qrPayload = citizenQrPayload(privateKey, built.citizenBytes);
  const locked = await prisma.fiscalReceipt.updateMany({
    where: { id: receiptId, ...scope(actor), status: 'READY', signature: null },
    data: {
      status: 'PROCESSING',
      detailsBase64: signed.details,
      signature: signed.signature,
      qrPayload,
      payloadSummary: { ...built.summary, lines: draft.lines } as Prisma.InputJsonValue,
      submittedAt: new Date(),
      attemptCount: { increment: 1 },
    },
  });
  if (locked.count !== 1) return getFiscalReceipt(actor, receiptId);
  try {
    const response = await submitPosCoupon(environment, {
      details: signed.details,
      signature: signed.signature,
    });
    await applyAtkResponse(actor, receiptId, response.status, response.body);
  } catch (error) {
    const message = error instanceof AtkTransportError ? error.message : 'Përgjigjja e ATK-së nuk u mor.';
    await prisma.fiscalReceipt.updateMany({
      where: { id: receiptId, ...scope(actor), status: 'PROCESSING' },
      data: { status: 'UNKNOWN', errorMessage: message, responseAt: new Date() },
    });
    await prisma.fiscalAttempt.create({
      data: { receiptId, ...scope(actor), outcome: 'UNKNOWN', message },
    });
  }
  const receipt = await getFiscalReceipt(actor, receiptId);
  await writeAudit({
    firmId: actor.firmId,
    companyId: actor.companyId,
    userId: actor.userId,
    action: 'fiscal.submit',
    entityId: receiptId,
    summary: `Kuponi ${receipt.couponId} përfundoi me status ${receipt.status}.`,
  });
  return receipt;
}

async function applyAtkResponse(actor: CompanyActor, receiptId: string, status: number, body: unknown) {
  const transactionId = readTransactionId(body);
  const message = sanitizeAtkMessage(body);
  let outcome: FiscalReceiptStatus = 'REJECTED';
  if (status >= 200 && status < 300 && transactionId) outcome = 'FISCALIZED';
  else if (status >= 200 && status < 300) outcome = 'UNKNOWN';
  else if (status >= 500 || status === 408) outcome = 'UNKNOWN';
  await prisma.fiscalReceipt.updateMany({
    where: { id: receiptId, ...scope(actor), status: 'PROCESSING' },
    data: {
      status: outcome,
      transactionId,
      atkMessage: outcome === 'FISCALIZED' ? message : null,
      errorMessage: outcome === 'FISCALIZED' ? null : message,
      responseAt: new Date(),
    },
  });
  await prisma.fiscalAttempt.create({
    data: { receiptId, ...scope(actor), outcome, httpStatus: status, message: outcome === 'FISCALIZED' ? 'ATK e pranoi kuponin.' : message },
  });
}

function readTransactionId(body: unknown): string | null {
  if (!body || typeof body !== 'object' || !('transaction_id' in body)) return null;
  const value = body.transaction_id;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value;
  return null;
}

function stringField(body: unknown, key: string): string | null {
  if (!body || typeof body !== 'object' || !(key in body)) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function linesFromSummary(summary: unknown): CouponLine[] | null {
  if (!summary || typeof summary !== 'object' || !('lines' in summary) || !Array.isArray(summary.lines)) return null;
  const lines = summary.lines.filter((line): line is CouponLine => {
    if (!line || typeof line !== 'object') return false;
    const item = line as CouponLine;
    return typeof item.description === 'string' && typeof item.quantity === 'string' && typeof item.lineTotal === 'string';
  });
  return lines.length ? lines : null;
}

function invoiceBlockers(
  invoice: {
    status: string;
    currency: string;
    lines: { description: string }[];
  },
  settings: { nui: string | null; applicationId: string | null; defaultUnit: string | null; itemType: string | null; connectionOk: boolean } | null,
) {
  const blockers: string[] = [];
  if (!['ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'].includes(invoice.status)) {
    blockers.push('Fiskalizohet vetëm një faturë e lëshuar, jo drafti dhe jo faturë e anuluar.');
  }
  if (invoice.currency !== 'EUR') blockers.push('Kuponi ATK në këtë modul pranon vetëm euro.');
  if (invoice.lines.length === 0) blockers.push('Fatura nuk ka rreshta.');
  if (!settings?.nui || !settings.applicationId || !settings.defaultUnit || !settings.itemType) {
    blockers.push('Konfigurimi i fiskalizimit është i paplotë.');
  }
  if (!settings?.connectionOk) blockers.push('Testi i lidhjes nuk ka përfunduar me sukses.');
  return blockers;
}

function publicReceipt(receipt: {
  id: string;
  couponId: string;
  type: string;
  environment: string;
  status: string;
  verificationNo: string;
  transactionId: string | null;
  atkMessage: string | null;
  errorMessage: string | null;
  attemptCount: number;
  total: Prisma.Decimal;
  paymentKind: string;
  reason: string | null;
  createdById: string;
  submittedAt: Date | null;
  responseAt: Date | null;
  createdAt: Date;
  invoiceId: string | null;
  posId: string;
  originalReceiptId?: string | null;
  invoice?: { displayNumber: string | null; id?: string; total?: Prisma.Decimal } | null;
  pos?: { posNumber: string; branch?: { branchNumber: string; location: string } } | null;
}) {
  return {
    id: receipt.id,
    couponId: receipt.couponId,
    type: receipt.type,
    environment: receipt.environment,
    status: receipt.status,
    verificationNo: receipt.verificationNo,
    transactionId: receipt.transactionId,
    atkMessage: receipt.atkMessage,
    errorMessage: receipt.errorMessage,
    attemptCount: receipt.attemptCount,
    total: receipt.total,
    paymentKind: receipt.paymentKind,
    reason: receipt.reason,
    createdById: receipt.createdById,
    submittedAt: receipt.submittedAt,
    responseAt: receipt.responseAt,
    createdAt: receipt.createdAt,
    invoiceId: receipt.invoiceId,
    invoiceNumber: receipt.invoice?.displayNumber ?? null,
    posId: receipt.posId,
    posNumber: receipt.pos?.posNumber ?? null,
    branchNumber: receipt.pos?.branch?.branchNumber ?? null,
    originalReceiptId: receipt.originalReceiptId ?? null,
    documentTitle: fiscalDocumentTitle(receipt.status, receipt.transactionId),
  };
}
