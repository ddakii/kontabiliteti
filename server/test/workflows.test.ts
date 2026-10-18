import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';

const app = createApp();
const password = 'Test12345!';

function stamp() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerFirm(name: string) {
  const email = `${stamp()}@example.test`;
  const created = await request(app)
    .post('/api/auth/register')
    .set('X-Kontabiliteti-Request', '1')
    .send({ name: 'Testuesi', email, password, firmName: name, planCode: 'PROFESSIONAL' });
  expect(created.status).toBe(201);
  await request(app)
    .post('/api/auth/verify-email')
    .set('X-Kontabiliteti-Request', '1')
    .send({ token: created.body.data.devVerificationToken });
  const login = await request(app)
    .post('/api/auth/login')
    .set('X-Kontabiliteti-Request', '1')
    .send({ email, password });
  expect(login.status).toBe(200);
  return {
    email,
    firmId: created.body.data.firmId as string,
    cookie: login.headers['set-cookie'] as string[],
  };
}

function authed(cookie: string[], firmId: string, companyId?: string) {
  const req = request(app);
  return {
    get: (url: string) => req.get(url).set('X-Kontabiliteti-Request', '1').set('X-Firm-Id', firmId).set('X-Company-Id', companyId ?? '').set('Cookie', cookie),
    post: (url: string) => req.post(url).set('X-Kontabiliteti-Request', '1').set('X-Firm-Id', firmId).set('X-Company-Id', companyId ?? '').set('Cookie', cookie),
    patch: (url: string) => req.patch(url).set('X-Kontabiliteti-Request', '1').set('X-Firm-Id', firmId).set('X-Company-Id', companyId ?? '').set('Cookie', cookie),
  };
}

describe('rrjedhat kryesore dhe izolimi i qiramarrësve', () => {
  beforeAll(async () => {
    const role = await prisma.role.findFirst({ where: { key: 'OWNER', scopeKey: 'system' } });
    if (!role) throw new Error('Ekzekutoni seed-in para testeve.');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('ndan faturat, pagesat dhe PDF-të e dy kompanive dhe refuzon zyrën tjetër', async () => {
    const firmA = await registerFirm(`Zyra A ${stamp()}`);
    const firmB = await registerFirm(`Zyra B ${stamp()}`);
    const companyA1 = await createCompany(firmA, 'Kompania Alfa');
    const companyA2 = await createCompany(firmA, 'Kompania Beta');
    const companyB = await createCompany(firmB, 'Kompania Gama');

    const invoiceA = await issueInvoice(firmA, companyA1, 'Blerësi Alfa', '50', '2');
    const invoiceB = await issueInvoice(firmA, companyA2, 'Blerësi Beta', '80', '1');
    expect(invoiceA.id).not.toBe(invoiceB.id);
    expect(invoiceA.displayNumber).toMatch(/^FAT-2026-/);
    expect(invoiceB.displayNumber).toMatch(/^FAT-2026-/);

    const pdf = await authed(firmA.cookie, firmA.firmId, companyA1).get(`/api/invoices/${invoiceA.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');

    const stolenPdf = await authed(firmB.cookie, firmB.firmId, companyB).get(`/api/invoices/${invoiceA.id}/pdf`);
    expect(stolenPdf.status).toBe(404);
    const stolenCompany = await authed(firmB.cookie, firmB.firmId).get(`/api/companies/${companyA1}`);
    expect(stolenCompany.status).toBe(404);
    const forgedFirm = await authed(firmB.cookie, firmA.firmId, companyA1).get(`/api/invoices/${invoiceA.id}`);
    expect(forgedFirm.status).toBe(404);

    const banks = await authed(firmA.cookie, firmA.firmId, companyA1).get('/api/bank-accounts');
    const cash = banks.body.data.find((account: { isCash: boolean }) => account.isCash);
    const payment = await authed(firmA.cookie, firmA.firmId, companyA1)
      .post('/api/payments')
      .send({
        direction: 'INCOMING',
        amount: '40.00',
        date: '2026-10-18',
        method: 'CASH',
        bankAccountId: cash.id,
        allocations: [{ invoiceId: invoiceA.id, amount: '40.00' }],
      });
    expect(payment.status).toBe(201);
    const after = await authed(firmA.cookie, firmA.firmId, companyA1).get(`/api/invoices/${invoiceA.id}`);
    expect(after.body.data.status).toBe('PARTIALLY_PAID');
    expect(Number(after.body.data.amountPaid)).toBe(40);

    const reportA = await authed(firmA.cookie, firmA.firmId, companyA1).get('/api/reports/income-statement?from=2026-01-01&to=2026-12-31');
    const reportB = await authed(firmA.cookie, firmA.firmId, companyA2).get('/api/reports/income-statement?from=2026-01-01&to=2026-12-31');
    expect(reportA.status).toBe(200);
    expect(reportB.status).toBe(200);
    expect(reportA.body.data.revenueTotal).not.toBe(reportB.body.data.revenueTotal);
  });

  it('refuzon bilancin hapës të pabalancuar dhe e respekton kufirin e planit', async () => {
    const firm = await registerFirm(`Zyra Limit ${stamp()}`);
    const company = await createCompany(firm, 'Kompania Limit');
    const opening = await authed(firm.cookie, firm.firmId, company)
      .post(`/api/companies/${company}/opening-balances`)
      .send({ date: '2026-01-01', lines: [{ accountCode: '1000', debit: '10.00', credit: '0.00' }, { accountCode: '3000', debit: '0.00', credit: '9.00' }] });
    expect(opening.status).toBe(400);
    const plan = await prisma.subscriptionPlan.create({
      data: { code: `LIM-${stamp()}`, name: 'Limit test', description: 'Test', maxCompanies: 1, maxMembers: 5 },
    });
    await prisma.subscription.update({ where: { firmId: firm.firmId }, data: { planId: plan.id, status: 'ACTIVE' } });
    const blocked = await authed(firm.cookie, firm.firmId)
      .post('/api/companies')
      .send({ legalName: 'E dyta', accountingStartDate: '2026-01-01' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('LIMIT_REACHED');
  });

  it('mban listën mujore dhe vjetërsimin brenda kompanisë', async () => {
    const firmA = await registerFirm(`Zyra Muaji ${stamp()}`);
    const firmB = await registerFirm(`Zyra Tjetër ${stamp()}`);
    const companyA = await createCompany(firmA, 'Kompania Muaji');
    const companyB = await createCompany(firmB, 'Kompania Huaj');
    const checklist = await authed(firmA.cookie, firmA.firmId, companyA).get('/api/month-checklist?year=2026&month=10');
    expect(checklist.status).toBe(200);
    expect(checklist.body.data.items.length).toBeGreaterThan(5);
    const itemId = checklist.body.data.items[0].id as string;
    const stolen = await authed(firmB.cookie, firmB.firmId, companyB).patch(`/api/month-checklist/items/${itemId}`).send({ status: 'DONE' });
    expect(stolen.status).toBe(404);
    const aging = await authed(firmA.cookie, firmA.firmId, companyA).get('/api/aging?asOf=2026-10-18');
    expect(aging.status).toBe(200);
    expect(aging.body.data.asOf).toBe('2026-10-18');
  });
});

async function createCompany(firm: { cookie: string[]; firmId: string }, legalName: string) {
  const response = await authed(firm.cookie, firm.firmId)
    .post('/api/companies')
    .send({ legalName, accountingStartDate: '2026-01-15', municipality: 'Prishtinë', vatStatus: 'REGISTERED' });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

async function issueInvoice(
  firm: { cookie: string[]; firmId: string },
  companyId: string,
  customerName: string,
  unitPrice = '50',
  quantity = '2',
) {
  const http = authed(firm.cookie, firm.firmId, companyId);
  const rates = await http.get('/api/tax-rates');
  const rate = rates.body.data.find((item: { code: string }) => item.code === 'TVSH18');
  await http.post(`/api/tax-rates/${rate.id}/confirm`).send({ note: 'Konfirmim vetëm për test automatik.' });
  const customer = await http.post('/api/customers').send({ name: customerName, municipality: 'Prishtinë' });
  const draft = await http.post('/api/invoices').send({
    customerId: customer.body.data.id,
    issueDate: '2026-10-10',
    dueDate: '2026-10-25',
    lines: [{ description: `Shërbim ${customerName}`, quantity, unitPrice, taxRateId: rate.id }],
  });
  expect(draft.status).toBe(201);
  const issued = await http.post(`/api/invoices/${draft.body.data.id}/finalize`).send({});
  expect(issued.status).toBe(200);
  expect(issued.body.data.displayNumber).toMatch(/^FAT-2026-/);
  expect(Number(issued.body.data.total)).toBeCloseTo(Number(quantity) * Number(unitPrice) * 1.18, 2);
  return issued.body.data as { id: string; displayNumber: string };
}

void createHash;
