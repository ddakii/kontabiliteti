import { randomInt } from 'node:crypto';
import type { FiscalCouponType, FiscalPaymentKind } from '@prisma/client';
import { d } from '../domain/money';
import { assertUint, eurosToCents, grossUnitPriceUnits } from './money';
import { encodeCitizenCoupon, encodePosCoupon, type CitizenCouponMessage, type PosCouponMessage } from './proto';
import { fiscalTaxLetter } from './tax';

const PAYMENT: Record<FiscalPaymentKind, number> = {
  CASH: 1,
  CREDIT_CARD: 2,
  VOUCHER: 3,
  CHEQUE: 4,
  CRYPTO: 5,
  OTHER: 6,
};

const COUPON: Record<FiscalCouponType, number> = { SALE: 1, CANCEL: 2, RETURN: 3 };

export type CouponLine = {
  description: string;
  quantity: string;
  vatPercent: string;
  taxTreatment: string;
  netAmount: string;
  vatAmount: string;
  lineTotal: string;
};

export type CouponDraft = {
  businessId: string;
  couponId: string;
  branchId: string;
  posId: string;
  applicationId: string;
  location: string;
  operatorId: string;
  verificationNo: string;
  type: FiscalCouponType;
  time: number;
  unit: string;
  itemType: string;
  paymentKind: FiscalPaymentKind;
  referenceNo?: string;
  discount: string;
  lines: CouponLine[];
};

export type CouponBuild = {
  pos: PosCouponMessage;
  citizen: CitizenCouponMessage;
  posBytes: Buffer;
  citizenBytes: Buffer;
  summary: {
    totalCents: number;
    totalTaxCents: number;
    totalNoTaxCents: number;
    discountCents: number;
    items: { name: string; quantity: string; priceUnits: number; totalCents: number; taxRate: string }[];
    taxGroups: { taxRate: string; totalForTaxCents: number; totalTaxCents: number }[];
  };
};

export function newVerificationNo(): string {
  let value = '';
  for (let index = 0; index < 16; index += 1) value += String(randomInt(0, 10));
  return value;
}

export function buildCoupon(draft: CouponDraft): CouponBuild {
  if (draft.lines.length === 0) throw new Error('Kuponi duhet të ketë të paktën një artikull.');
  if (!draft.location.trim()) throw new Error('Vendndodhja e degës mungon.');
  if (!draft.operatorId.trim()) throw new Error('Mungon operatori që e lëshon kuponin.');
  if (!draft.unit.trim()) throw new Error('Vendosni njësinë matëse te konfigurimi. Faturat nuk e ruajnë njësinë.');
  if (!draft.itemType.trim()) throw new Error('Vendosni llojin e artikullit te konfigurimi. Shembulli publik përdor TT, por programi nuk e zgjedh vetë.');
  if (!/^\d{16}$/.test(draft.verificationNo)) throw new Error('Numri i verifikimit duhet të ketë 16 shifra.');
  if ((draft.type === 'CANCEL' || draft.type === 'RETURN') && !draft.referenceNo) {
    throw new Error('Anulimi dhe kthimi kërkojnë kuponin origjinal.');
  }

  const groups = new Map<string, { net: number; tax: number }>();
  const items = draft.lines.map((line) => {
    const letter = fiscalTaxLetter(line.taxTreatment, line.vatPercent);
    const net = eurosToCents(line.netAmount);
    const tax = eurosToCents(line.vatAmount);
    const total = eurosToCents(line.lineTotal);
    if (net + tax !== total) throw new Error(`Rreshti "${line.description}" nuk ka neto + TVSH = total.`);
    const current = groups.get(letter) ?? { net: 0, tax: 0 };
    current.net += net;
    current.tax += tax;
    groups.set(letter, current);
    return {
      Name: line.description.trim(),
      Price: grossUnitPriceUnits(line.lineTotal, line.quantity),
      Unit: draft.unit.trim(),
      Quantity: Number(line.quantity),
      Total: total,
      TaxRate: letter,
      Type: draft.itemType.trim(),
      quantity: line.quantity,
    };
  });
  if (items.some((item) => !item.Name)) throw new Error('Përshkrimi i artikullit mungon.');
  if (items.some((item) => !Number.isFinite(item.Quantity) || item.Quantity <= 0)) {
    throw new Error('Sasia nuk u lexua si numër i vlefshëm për fushën float të protokollit.');
  }

  const totalNoTaxCents = [...groups.values()].reduce((sum, group) => sum + group.net, 0);
  const totalTaxCents = [...groups.values()].reduce((sum, group) => sum + group.tax, 0);
  const totalCents = items.reduce((sum, item) => sum + item.Total, 0);
  if (totalNoTaxCents + totalTaxCents !== totalCents) throw new Error('Grupet e TVSH-së nuk përputhen me totalin.');
  const discountCents = eurosToCents(draft.discount);
  const taxGroups = [...groups.entries()].map(([taxRate, group]) => ({
    TaxRate: taxRate,
    TotalForTax: group.net,
    TotalTax: group.tax,
  }));
  const reference = draft.referenceNo ? assertUint(draft.referenceNo, 'Kuponi origjinal') : undefined;
  const pos: PosCouponMessage = {
    BusinessId: assertUint(draft.businessId, 'NUI'),
    CouponId: assertUint(draft.couponId, 'Numri i kuponit'),
    BranchId: assertUint(draft.branchId, 'Dega'),
    Location: draft.location.trim(),
    OperatorId: draft.operatorId.trim().slice(0, 40),
    PosId: assertUint(draft.posId, 'POS'),
    ApplicationId: assertUint(draft.applicationId, 'Aplikacioni'),
    VerificationNo: draft.verificationNo,
    Type: COUPON[draft.type],
    Time: draft.time,
    Items: items.map(({ quantity: _quantity, ...item }) => item),
    Payments: [{ Type: PAYMENT[draft.paymentKind], Amount: totalCents }],
    Total: totalCents,
    TaxGroups: taxGroups,
    TotalTax: totalTaxCents,
    TotalNoTax: totalNoTaxCents,
    ReferenceNo: reference,
    TotalDiscount: discountCents,
  };
  const citizen: CitizenCouponMessage = {
    BusinessId: pos.BusinessId,
    CouponId: pos.CouponId,
    BranchId: pos.BranchId,
    PosId: pos.PosId,
    Type: pos.Type,
    Time: pos.Time,
    Total: pos.Total,
    TaxGroups: taxGroups,
    TotalTax: totalTaxCents,
    TotalNoTax: totalNoTaxCents,
  };
  if (d(draft.discount).lt(0)) throw new Error('Zbritja nuk mund të jetë negative.');
  return {
    pos,
    citizen,
    posBytes: encodePosCoupon(pos),
    citizenBytes: encodeCitizenCoupon(citizen),
    summary: {
      totalCents,
      totalTaxCents,
      totalNoTaxCents,
      discountCents,
      items: items.map((item) => ({
        name: item.Name,
        quantity: item.quantity,
        priceUnits: item.Price,
        totalCents: item.Total,
        taxRate: item.TaxRate,
      })),
      taxGroups: taxGroups.map((group) => ({
        taxRate: group.TaxRate,
        totalForTaxCents: group.TotalForTax,
        totalTaxCents: group.TotalTax,
      })),
    },
  };
}
