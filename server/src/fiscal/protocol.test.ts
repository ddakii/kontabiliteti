import fs from 'node:fs';
import path from 'node:path';
import 'reflect-metadata';
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { Pkcs10CertificateRequest } from '@peculiar/x509';
import { describe, expect, it } from 'vitest';
import { atkUrl } from './atk';
import { buildCoupon } from './coupon';
import { certificateMatchesKey, generateCsr, selfSignedCertificate } from './keys';
import { eurosToCents, eurosToPriceUnits, grossUnitPriceUnits } from './money';
import { decodePosCoupon, encodePosCoupon } from './proto';
import { ATK_PROTO } from './protoText';
import { signEncodedCoupon, verifyEncodedCoupon } from './sign';
import { fiscalDocumentTitle, fiscalReadiness } from './status';
import { fiscalTaxLetter } from './tax';

describe('protokolli ATK', () => {
  it('mban të njëjtin models.proto me tekstin që serializohet', () => {
    const file = fs.readFileSync(path.join(__dirname, 'models.proto'), 'utf8');
    expect(file.replace(/\s+/g, ' ').trim()).toBe(ATK_PROTO.replace(/\s+/g, ' ').trim());
  });

  it('shndërron çmimet në €0.0001 dhe totalet në centë, pa presje lundruese', () => {
    expect(eurosToPriceUnits('1.00')).toBe(10000);
    expect(eurosToPriceUnits('0.0001')).toBe(1);
    expect(eurosToPriceUnits('12.3456')).toBe(123456);
    expect(eurosToPriceUnits('1.00005')).toBe(10001);
    expect(eurosToCents('1.00')).toBe(100);
    expect(eurosToCents('0.01')).toBe(1);
    expect(eurosToCents('12.34')).toBe(1234);
    expect(eurosToCents('1.015')).toBe(102);
    expect(grossUnitPriceUnits('4.50', '3')).toBe(15000);
  });

  it('refuzon normat që shembulli publik nuk i emërton', () => {
    expect(fiscalTaxLetter('EXEMPT', '0')).toBe('A');
    expect(fiscalTaxLetter('ZERO', '0')).toBe('C');
    expect(fiscalTaxLetter('REDUCED', '8')).toBe('D');
    expect(fiscalTaxLetter('STANDARD', '18')).toBe('E');
    expect(() => fiscalTaxLetter('STANDARD', '10')).toThrow(/nuk ka shkronjë/);
  });

  it('serializon kuponin e shembullit dhe e lexon përsëri', () => {
    const time = Math.floor(Date.UTC(2024, 9, 1, 15, 30, 20) / 1000);
    const bytes = encodePosCoupon({
      BusinessId: 60100,
      CouponId: 10,
      BranchId: 1,
      Location: 'Prishtine',
      OperatorId: 'Kushtrimi',
      PosId: 1,
      ApplicationId: 1234,
      VerificationNo: '1234567890123456',
      Type: 1,
      Time: time,
      Items: [
        { Name: 'uje rugove', Price: 15000, Unit: 'cope', Quantity: 3, Total: 450, TaxRate: 'C', Type: 'TT' },
        { Name: 'buke', Price: 8000, Unit: 'cope', Quantity: 4, Total: 320, TaxRate: 'D', Type: 'TT' },
      ],
      Payments: [{ Type: 1, Amount: 1820 }],
      Total: 1820,
      TaxGroups: [{ TaxRate: 'C', TotalForTax: 450, TotalTax: 0 }],
      TotalTax: 185,
      TotalNoTax: 1635,
    });
    const decoded = decodePosCoupon(bytes);
    expect(decoded.BusinessId).toBe(60100);
    expect(decoded.Total).toBe(1820);
    const items = decoded.Items as { Price: number; Total: number }[];
    expect(items[0]?.Price).toBe(15000);
    expect(items[0]?.Total).toBe(450);
    expect(decoded.ReferenceNo).toBeUndefined();
  });

  it('ndërton kupon nga fatura dhe nënshkrimin e verifikon në P1363', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const built = buildCoupon({
      businessId: '810123456',
      couponId: '1',
      branchId: '1',
      posId: '1',
      applicationId: '1234',
      location: 'Prishtinë',
      operatorId: 'Arta',
      verificationNo: '1234567890123456',
      type: 'SALE',
      time: 1_700_000_000,
      unit: 'cope',
      itemType: 'TT',
      paymentKind: 'CASH',
      discount: '0.00',
      lines: [{
        description: 'Shërbim',
        quantity: '2.0000',
        vatPercent: '18.0000',
        taxTreatment: 'STANDARD',
        netAmount: '100.00',
        vatAmount: '18.00',
        lineTotal: '118.00',
      }],
    });
    expect(built.summary.totalCents).toBe(11800);
    expect(built.summary.totalTaxCents).toBe(1800);
    expect(built.summary.items[0]?.priceUnits).toBe(590000);
    expect(built.pos.Payments[0]?.Amount).toBe(11800);
    const signed = signEncodedCoupon(pem, built.posBytes);
    expect(Buffer.from(signed.signature, 'base64')).toHaveLength(64);
    const publicPem = createPublicKey(pem).export({ type: 'spki', format: 'pem' }).toString();
    expect(verifyEncodedCoupon(publicPem, signed.details, signed.signature)).toBe(true);
  });

  it('përputh certifikatën me çelësin dhe ndan mjediset', async () => {
    const csr = await generateCsr({ businessName: 'Test Biznes', nui: '810123456', branchId: '1', posId: '2' });
    const pem = await selfSignedCertificate(csr.pkcs8Pem);
    expect(certificateMatchesKey(pem, csr.pkcs8Pem)).toBe(true);
    const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    expect(certificateMatchesKey(pem, other)).toBe(false);
    expect(csr.csrPem).toContain('BEGIN CERTIFICATE REQUEST');
    expect(csr.pkcs8Pem).toContain('BEGIN PRIVATE KEY');
    const parsed = new Pkcs10CertificateRequest(csr.csrPem);
    expect(parsed.subject).toContain('Test Biznes');
    expect(parsed.subject).toContain('810123456');
    expect(await parsed.verify()).toBe(true);
    expect(atkUrl('TEST', '/pos/coupon')).toBe('https://fiskalizimi-test.atk-ks.org/pos/coupon');
    expect(atkUrl('PRODUCTION', '/ca/signcsr')).toBe('https://fiskalizimi.atk-ks.org/ca/signcsr');
    expect(atkUrl('TEST', '/ca/verify/810123456')).toBe('https://fiskalizimi-test.atk-ks.org/ca/verify/810123456');
  });

  it('nuk e quan faturë të fiskalizuar parapamjen', () => {
    expect(fiscalDocumentTitle('READY', null)).not.toContain('Faturë e fiskalizuar');
    expect(fiscalDocumentTitle('REJECTED', null)).toContain('refuzuar');
    expect(fiscalDocumentTitle('UNKNOWN', null)).toContain('nuk është konfirmuar');
    expect(fiscalDocumentTitle('FISCALIZED', null)).not.toContain('Faturë e fiskalizuar');
    expect(fiscalDocumentTitle('FISCALIZED', '99')).toBe('Faturë e fiskalizuar');
    expect(fiscalReadiness({ dataComplete: true, certificateConfigured: true, connectionChecked: false }).ready).toBe(false);
    expect(fiscalReadiness({ dataComplete: true, certificateConfigured: true, connectionChecked: true }).label).toBe('Gati për fiskalizim');
  });

  it('kërkon referencën për anulim', () => {
    expect(() => buildCoupon({
      businessId: '1',
      couponId: '2',
      branchId: '1',
      posId: '1',
      applicationId: '1',
      location: 'Prishtinë',
      operatorId: 'Arta',
      verificationNo: '1234567890123456',
      type: 'CANCEL',
      time: 1,
      unit: 'cope',
      itemType: 'TT',
      paymentKind: 'CASH',
      discount: '0.00',
      lines: [{
        description: 'Shërbim',
        quantity: '1',
        vatPercent: '0',
        taxTreatment: 'ZERO',
        netAmount: '10.00',
        vatAmount: '0.00',
        lineTotal: '10.00',
      }],
    })).toThrow(/origjinal/);
  });
});
