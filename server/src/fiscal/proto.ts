import protobuf from 'protobufjs';
import { ATK_PROTO } from './protoText';

const root = protobuf.parse(ATK_PROTO).root;
const PosCoupon = root.lookupType('atk.PosCoupon');
const CitizenCoupon = root.lookupType('atk.CitizenCoupon');

export type ProtoTaxGroup = { TaxRate: string; TotalForTax: number; TotalTax: number };

export type ProtoItem = {
  Name: string;
  Price: number;
  Unit: string;
  Quantity: number;
  Total: number;
  TaxRate: string;
  Type: string;
};

export type ProtoPayment = { Type: number; Amount: number };

export type PosCouponMessage = {
  BusinessId: number;
  CouponId: number;
  BranchId: number;
  Location: string;
  OperatorId: string;
  PosId: number;
  ApplicationId: number;
  VerificationNo: string;
  Type: number;
  Time: number;
  Items: ProtoItem[];
  Payments: ProtoPayment[];
  Total: number;
  TaxGroups: ProtoTaxGroup[];
  TotalTax: number;
  TotalNoTax: number;
  ReferenceNo?: number;
  TotalDiscount?: number;
};

export type CitizenCouponMessage = {
  BusinessId: number;
  CouponId: number;
  BranchId: number;
  PosId: number;
  Type: number;
  Time: number;
  Total: number;
  TaxGroups: ProtoTaxGroup[];
  TotalTax: number;
  TotalNoTax: number;
};

function encode(type: protobuf.Type, message: object): Buffer {
  const error = type.verify(message);
  if (error) throw new Error(`Kuponi nuk është i vlefshëm për protokollin: ${error}`);
  return Buffer.from(type.encode(type.create(message)).finish());
}

/** Heq fushat zero që proto3 nuk i serializon. */
export function encodePosCoupon(message: PosCouponMessage): Buffer {
  const payload: PosCouponMessage = { ...message };
  if (!payload.ReferenceNo) delete payload.ReferenceNo;
  if (!payload.TotalDiscount) delete payload.TotalDiscount;
  return encode(PosCoupon, payload);
}

export function encodeCitizenCoupon(message: CitizenCouponMessage): Buffer {
  return encode(CitizenCoupon, message);
}

export function decodePosCoupon(bytes: Buffer): Record<string, unknown> {
  return PosCoupon.toObject(PosCoupon.decode(bytes), { longs: Number, enums: String, defaults: false });
}
