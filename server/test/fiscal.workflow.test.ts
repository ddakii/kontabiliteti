import { generateKeyPairSync } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { type AtkCall, resetAtkTransport, setAtkTransport } from '../src/fiscal/atk';
import { savePrivateKey, selfSignedCertificate } from '../src/fiscal/keys';
import { prisma } from '../src/lib/prisma';

const app = createApp();
const password = 'Test12345!';
const calls: AtkCall[] = [];

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
  await request(app).post('/api/auth/verify-email').set('X-Kontabiliteti-Request', '1').send({ token: created.body.data.devVerificationToken });
  const login = await request(app).post('/api/auth/login').set('X-Kontabiliteti-Request', '1').send({ email, password });
  return { firmId: created.body.data.firmId as string, cookie: login.headers['set-cookie'] as string[] };
}

function authed(cookie: string[], firmId: string, companyId?: string) {
  const req = request(app);
  const headers = { 'X-Kontabiliteti-Request': '1', 'X-Firm-Id': firmId, 'X-Company-Id': companyId ?? '', Cookie: cookie };
  return {
    get: (url: string) => req.get(url).set(headers),
    post: (url: string) => req.post(url).set(headers),
    put: (url: string) => req.put(url).set(headers),
  };
}

async function installKey(companyId: string, posId: string) {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  savePrivateKey(companyId, posId, pkcs8);
  return selfSignedCertificate(pkcs8);
}

describe('fiskalizimi ATK', () => {
  beforeAll(() => {
    setAtkTransport(async (call) => {
      calls.push(call);
      if (call.url.endsWith('/swagger/index.html')) return { status: 200, body: {} };
      if (call.url.endsWith('/pos/coupon')) {
        if (call.body && typeof call.body === 'object' && 'details' in call.body && String(call.body.details).includes('FAIL')) {
          return { status: 400, body: { error: 'details and signature don\'t match' } };
        }
        return { status: 200, body: { message: 'ok', transaction_id: 4242 } };
      }
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });
  });

  afterAll(async () => {
    resetAtkTransport();
    await prisma.$disconnect();
  });

  it('ndan kuponët, nuk i dërgon dy herë dhe nuk e quan të fiskalizuar refuzimin', async () => {
    calls.length = 0;
    const firmA = await registerFirm(`Zyra Fiskale ${stamp()}`);
    const firmB = await registerFirm(`Zyra Huaj ${stamp()}`);
    const companyA = await createCompany(firmA, 'Kompania Fiskale');
    const companyB = await createCompany(firmB, 'Kompania Huaj');
    const http = authed(firmA.cookie, firmA.firmId, companyA);
    const saved = await http.put('/api/fiscal/settings').send({
      nui: '810123456',
      fiscalizationNo: 'EDI-TEST-1',
      applicationId: '1234',
      defaultUnit: 'cope',
      itemType: 'TT',
      environment: 'TEST',
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data.ready).toBe(false);
    expect(JSON.stringify(saved.body)).not.toContain('EDI-TEST-1');
    expect(JSON.stringify(saved.body)).not.toContain('PRIVATE KEY');
    const branch = await http.post('/api/fiscal/branches').send({ branchNumber: '1', location: 'Prishtinë' });
    expect(branch.status).toBe(201);
    const branchId = branch.body.data.branches[0].id as string;
    const pos = await http.post('/api/fiscal/terminals').send({ branchId, posNumber: '1' });
    expect(pos.status).toBe(201);
    const posId = pos.body.data.branches[0].terminals[0].id as string;
    const certificate = await installKey(companyA, posId);
    await prisma.fiscalPos.update({
      where: { id: posId },
      data: { certificatePem: certificate, onboardedAt: new Date(), certificateNotAfter: new Date(Date.now() + 86_400_000), keyFingerprint: 'test' },
    });
    const checked = await http.post('/api/fiscal/check').send({});
    expect(checked.status).toBe(200);
    expect(checked.body.data.ready).toBe(true);
    expect(checked.body.data.label).toBe('Gati për fiskalizim');
    expect(calls.some((call) => call.url.includes('/pos/coupon'))).toBe(false);
    expect(calls.some((call) => call.url === 'https://fiskalizimi-test.atk-ks.org/swagger/index.html')).toBe(true);

    const invoice = await issueInvoice(firmA, companyA);
    const before = calls.filter((call) => call.url.endsWith('/pos/coupon')).length;
    const submitted = await http.post(`/api/fiscal/invoices/${invoice.id}/submit`).send({ posId, paymentKind: 'CASH' });
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.status).toBe('FISCALIZED');
    expect(submitted.body.data.transactionId).toBe('4242');
    expect(submitted.body.data.documentTitle).toBe('Faturë e fiskalizuar');
    const couponCalls = calls.filter((call) => call.url.endsWith('/pos/coupon'));
    expect(couponCalls).toHaveLength(before + 1);
    expect(couponCalls.at(-1)?.url).toBe('https://fiskalizimi-test.atk-ks.org/pos/coupon');
    const again = await http.post(`/api/fiscal/invoices/${invoice.id}/submit`).send({ posId, paymentKind: 'CASH' });
    expect(again.body.data.id).toBe(submitted.body.data.id);
    expect(calls.filter((call) => call.url.endsWith('/pos/coupon'))).toHaveLength(before + 1);

    const stolen = await authed(firmB.cookie, firmB.firmId, companyB).get(`/api/fiscal/receipts/${submitted.body.data.id}`);
    expect(stolen.status).toBe(404);
    const forged = await authed(firmB.cookie, firmB.firmId, companyA).get('/api/fiscal');
    expect(forged.status).toBe(404);

    const pdf = await http.get(`/api/fiscal/receipts/${submitted.body.data.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');

    const original = await prisma.fiscalReceipt.findUniqueOrThrow({ where: { id: submitted.body.data.id } });
    const adjusted = await http.post(`/api/fiscal/receipts/${original.id}/adjust`).send({ kind: 'CANCEL', reason: 'Test anulimi' });
    expect(adjusted.status).toBe(200);
    expect(adjusted.body.data.type).toBe('CANCEL');
    expect(adjusted.body.data.status).toBe('FISCALIZED');
    const still = await prisma.fiscalReceipt.findUniqueOrThrow({ where: { id: original.id } });
    expect(still.status).toBe('FISCALIZED');
  });

  it('e lë të panjohur dërgimin pa përgjigje dhe nuk hap kupon të ri', async () => {
    const firm = await registerFirm(`Zyra Panjohur ${stamp()}`);
    const company = await createCompany(firm, 'Kompania Panjohur');
    const http = authed(firm.cookie, firm.firmId, company);
    await http.put('/api/fiscal/settings').send({
      nui: '810123499', fiscalizationNo: 'EDI-2', applicationId: '9', defaultUnit: 'cope', itemType: 'TT', environment: 'TEST',
    });
    const branch = await http.post('/api/fiscal/branches').send({ branchNumber: '1', location: 'Pejë' });
    const pos = await http.post('/api/fiscal/terminals').send({ branchId: branch.body.data.branches[0].id, posNumber: '1' });
    const posId = pos.body.data.branches[0].terminals[0].id as string;
    await prisma.fiscalPos.update({
      where: { id: posId },
      data: { certificatePem: await installKey(company, posId), onboardedAt: new Date(), certificateNotAfter: new Date(Date.now() + 86_400_000) },
    });
    await http.post('/api/fiscal/check').send({});
    const invoice = await issueInvoice(firm, company);
    const previous = setAtkTransport;
    setAtkTransport(async (call) => {
      calls.push(call);
      if (call.url.endsWith('/swagger/index.html')) return { status: 200, body: {} };
      throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    });
    const submitted = await http.post(`/api/fiscal/invoices/${invoice.id}/submit`).send({ posId, paymentKind: 'CASH' });
    expect(submitted.body.data.status).toBe('UNKNOWN');
    expect(submitted.body.data.documentTitle).not.toContain('Faturë e fiskalizuar');
    const couponId = submitted.body.data.couponId as string;
    const retry = await http.post(`/api/fiscal/invoices/${invoice.id}/submit`).send({ posId, paymentKind: 'CASH' });
    expect(retry.body.data.couponId).toBe(couponId);
    expect(retry.body.data.status).toBe('UNKNOWN');
    const count = await prisma.fiscalReceipt.count({ where: { invoiceId: invoice.id, type: 'SALE' } });
    expect(count).toBe(1);
    previous(async (call) => {
      calls.push(call);
      if (call.url.endsWith('/swagger/index.html')) return { status: 200, body: {} };
      if (call.url.endsWith('/pos/coupon')) return { status: 400, body: { error: 'rejected' } };
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });
  });

  it('dërgon refuzimin te testi dhe produksionin te hosti tjetër, vetëm përmes mock-ut', async () => {
    setAtkTransport(async (call) => {
      calls.push(call);
      if (call.url.endsWith('/swagger/index.html')) return { status: 200, body: {} };
      return { status: 400, body: { error: 'rejected by test' } };
    });
    const firm = await registerFirm(`Zyra Mjedisi ${stamp()}`);
    const company = await createCompany(firm, 'Kompania Mjedisi');
    const http = authed(firm.cookie, firm.firmId, company);
    await http.put('/api/fiscal/settings').send({
      nui: '810123488', fiscalizationNo: 'EDI-3', applicationId: '8', defaultUnit: 'cope', itemType: 'TT', environment: 'TEST',
    });
    const branch = await http.post('/api/fiscal/branches').send({ branchNumber: '2', location: 'Gjakovë' });
    const pos = await http.post('/api/fiscal/terminals').send({ branchId: branch.body.data.branches[0].id, posNumber: '3' });
    const posId = pos.body.data.branches[0].terminals[0].id as string;
    await prisma.fiscalPos.update({
      where: { id: posId },
      data: { certificatePem: await installKey(company, posId), onboardedAt: new Date() },
    });
    await http.post('/api/fiscal/check').send({});
    const invoice = await issueInvoice(firm, company);
    setAtkTransport(async (call) => {
      calls.push(call);
      if (call.url.endsWith('/swagger/index.html')) return { status: 200, body: {} };
      return { status: 400, body: { error: 'rejected by test' } };
    });
    const rejected = await http.post(`/api/fiscal/invoices/${invoice.id}/submit`).send({ posId, paymentKind: 'CREDIT_CARD' });
    expect(rejected.body.data.status).toBe('REJECTED');
    expect(rejected.body.data.documentTitle).not.toContain('Faturë e fiskalizuar');
    const switched = await http.put('/api/fiscal/settings').send({
      nui: '810123488', fiscalizationNo: 'EDI-3', applicationId: '8', defaultUnit: 'cope', itemType: 'TT', environment: 'PRODUCTION', confirmProduction: true,
    });
    expect(switched.body.data.ready).toBe(false);
    await prisma.fiscalPos.update({
      where: { id: posId },
      data: { certificatePem: await installKey(company, posId), onboardedAt: new Date(), keyFingerprint: 'prod-test' },
    });
    await http.post('/api/fiscal/check').send({});
    const second = await issueInvoice(firm, company, 'Blerësi tjetër');
    const sent = await http.post(`/api/fiscal/invoices/${second.id}/submit`).send({ posId, paymentKind: 'CASH' });
    expect(sent.body.data.environment).toBe('PRODUCTION');
    expect(sent.body.data.status).toBe('REJECTED');
    expect(calls.some((call) => call.url === 'https://fiskalizimi.atk-ks.org/pos/coupon')).toBe(true);
    expect(calls.filter((call) => call.url.includes('fiskalizimi.atk-ks.org') && call.url.includes('-test'))).toHaveLength(0);
  });
});

async function createCompany(firm: { cookie: string[]; firmId: string }, legalName: string) {
  const response = await authed(firm.cookie, firm.firmId).post('/api/companies').send({ legalName, accountingStartDate: '2026-01-15', municipality: 'Prishtinë', vatStatus: 'REGISTERED' });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

async function issueInvoice(firm: { cookie: string[]; firmId: string }, companyId: string, customerName = 'Blerësi Fiskal') {
  const http = authed(firm.cookie, firm.firmId, companyId);
  const rates = await http.get('/api/tax-rates');
  const rate = rates.body.data.find((item: { code: string }) => item.code === 'TVSH18');
  await http.post(`/api/tax-rates/${rate.id}/confirm`).send({ note: 'Konfirmim vetëm për test automatik.' });
  const customer = await http.post('/api/customers').send({ name: `${customerName} ${stamp()}`, municipality: 'Prishtinë' });
  const draft = await http.post('/api/invoices').send({
    customerId: customer.body.data.id,
    issueDate: '2026-10-10',
    dueDate: '2026-10-25',
    lines: [{ description: 'Shërbim kontabël', quantity: '2', unitPrice: '50', taxRateId: rate.id }],
  });
  expect(draft.status).toBe(201);
  const issued = await http.post(`/api/invoices/${draft.body.data.id}/finalize`).send({});
  expect(issued.status).toBe(200);
  return issued.body.data as { id: string };
}
