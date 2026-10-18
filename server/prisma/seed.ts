import { PrismaClient, type TaxTreatmentKind } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'node:path';
import { FEATURES, PERMISSIONS, SYSTEM_ROLES } from '../src/lib/access';
import { KOSOVO_MUNICIPALITIES, TAX_TEMPLATES } from '../src/lib/chart';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

const PLANS = [
  {
    code: 'STARTER',
    name: 'Starter',
    description: 'Zyrë e vogël, fatura bazë, kontabilitet dhe raporte thelbësore. Çmimet i cakton administratori.',
    maxCompanies: 10,
    maxMembers: 2,
    sortOrder: 1,
    features: ['invoices', 'purchases', 'accounting', 'reports'],
  },
  {
    code: 'PROFESSIONAL',
    name: 'Professional',
    description: 'Më shumë kompani dhe kontabilistë, portal dokumentesh, detyra dhe eksporte.',
    maxCompanies: 50,
    maxMembers: 10,
    sortOrder: 2,
    features: ['invoices', 'purchases', 'accounting', 'reports', 'exports', 'portal', 'tasks', 'bank_reconciliation'],
  },
  {
    code: 'BUSINESS',
    name: 'Business',
    description: 'Kufij më të lartë, paga, asete, inventar dhe leje të avancuara.',
    maxCompanies: 200,
    maxMembers: 30,
    sortOrder: 3,
    features: [...FEATURES],
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    description: 'Kufij të konfigurueshëm dhe të gjitha modulet. Çmimi nuk është i paracaktuar.',
    maxCompanies: null,
    maxMembers: null,
    sortOrder: 4,
    features: [...FEATURES],
  },
];

async function main() {
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({ where: { key }, update: { description }, create: { key, description } });
  }
  const permissions = await prisma.permission.findMany();
  const byKey = new Map(permissions.map((permission) => [permission.key, permission.id]));

  for (const role of SYSTEM_ROLES) {
    const saved = await prisma.role.upsert({
      where: { scopeKey_key: { scopeKey: 'system', key: role.key } },
      update: { name: role.name, description: role.description, accessScope: role.accessScope, isSystem: true },
      create: {
        scopeKey: 'system',
        key: role.key,
        name: role.name,
        description: role.description,
        accessScope: role.accessScope,
        isSystem: true,
      },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: saved.id } });
    await prisma.rolePermission.createMany({
      data: role.permissions.map((permission) => ({ roleId: saved.id, permissionId: byKey.get(permission)! })),
    });
  }

  for (const plan of PLANS) {
    const saved = await prisma.subscriptionPlan.upsert({
      where: { code: plan.code },
      update: {
        name: plan.name,
        description: plan.description,
        maxCompanies: plan.maxCompanies,
        maxMembers: plan.maxMembers,
        sortOrder: plan.sortOrder,
        monthlyPrice: null,
        annualPrice: null,
      },
      create: {
        code: plan.code,
        name: plan.name,
        description: plan.description,
        maxCompanies: plan.maxCompanies,
        maxMembers: plan.maxMembers,
        sortOrder: plan.sortOrder,
      },
    });
    await prisma.planEntitlement.deleteMany({ where: { planId: saved.id } });
    await prisma.planEntitlement.createMany({
      data: FEATURES.map((featureKey) => ({
        planId: saved.id,
        featureKey,
        enabled: plan.features.includes(featureKey),
      })),
    });
  }

  for (const name of KOSOVO_MUNICIPALITIES) {
    await prisma.municipality.upsert({ where: { name }, update: {}, create: { name } });
  }

  for (const template of TAX_TEMPLATES) {
    const existing = await prisma.taxRate.findFirst({ where: { isTemplate: true, code: template.code, companyId: null } });
    const data = {
      code: template.code,
      name: template.name,
      ratePercent: template.ratePercent,
      treatment: template.treatment as TaxTreatmentKind,
      effectiveFrom: new Date(`${template.effectiveFrom}T00:00:00.000Z`),
      sourceNote: template.sourceNote,
      isTemplate: true,
      isActive: true,
    };
    if (existing) await prisma.taxRate.update({ where: { id: existing.id }, data });
    else await prisma.taxRate.create({ data });
  }

  await prisma.platformSetting.upsert({
    where: { key: 'trialDays' },
    update: {},
    create: { key: 'trialDays', value: Number(process.env.DEFAULT_TRIAL_DAYS ?? 14) },
  });
  await prisma.platformSetting.upsert({
    where: { key: 'graceDays' },
    update: {},
    create: { key: 'graceDays', value: 7 },
  });

  if (process.env.PLATFORM_ADMIN_EMAIL && process.env.PLATFORM_ADMIN_PASSWORD) {
    const email = process.env.PLATFORM_ADMIN_EMAIL.toLowerCase();
    const passwordHash = await bcrypt.hash(process.env.PLATFORM_ADMIN_PASSWORD, 12);
    await prisma.user.upsert({
      where: { email },
      update: { isPlatformAdmin: true, emailVerifiedAt: new Date(), passwordHash },
      create: {
        email,
        name: 'Administratori i platformës',
        passwordHash,
        isPlatformAdmin: true,
        emailVerifiedAt: new Date(),
      },
    });
  }

  if (process.env.SEED_DEMO === 'true' && process.env.NODE_ENV !== 'production') {
    await seedDemo();
  }
}

async function seedDemo() {
  const email = 'demo@kontabiliteti.local';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return;
  const passwordHash = await bcrypt.hash(process.env.DEMO_PASSWORD || 'admin123', 12);
  const owner = await prisma.role.findFirstOrThrow({ where: { scopeKey: 'system', key: 'OWNER' } });
  const plan = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { code: 'PROFESSIONAL' } });
  const user = await prisma.user.create({
    data: { email, name: 'Arta Dema', passwordHash, emailVerifiedAt: new Date() },
  });
  const firm = await prisma.accountingFirm.create({
    data: {
      legalName: 'Zyra Kontabël Demo',
      tradeName: 'DEMO — mos e përdorni për të dhëna reale',
      email,
      municipality: 'Prishtinë',
      address: 'Rr. Demo 1',
    },
  });
  await prisma.firmSettings.create({ data: { firmId: firm.id, onboardingCompletedAt: new Date() } });
  await prisma.firmMembership.create({ data: { firmId: firm.id, userId: user.id, roleId: owner.id } });
  const subscription = await prisma.subscription.create({
    data: {
      firmId: firm.id,
      planId: plan.id,
      status: 'TRIAL',
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
  });
  await prisma.subscriptionEvent.create({
    data: {
      firmId: firm.id,
      subscriptionId: subscription.id,
      type: 'TRIAL_STARTED',
      note: 'Provë demonstruese. Nuk është pagesë.',
    },
  });
  console.log('U krijua llogaria demonstruese demo@kontabiliteti.local');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
