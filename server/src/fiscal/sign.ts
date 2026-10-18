import { sign, verify } from 'node:crypto';

/**
 * Nënshkrimi i shembullit C# për .NET 8:
 * SHA-256 i bajtëve UTF-8 të Base64-it, pastaj ECDSA P-256 në format IEEE P1363 (r||s).
 */
export function signEncodedCoupon(privateKeyPem: string, protobufBytes: Buffer): { details: string; signature: string } {
  const details = protobufBytes.toString('base64');
  const signature = sign('sha256', Buffer.from(details, 'utf8'), {
    key: privateKeyPem,
    dsaEncoding: 'ieee-p1363',
  });
  if (signature.length !== 64) {
    throw new Error('Nënshkrimi ECDSA nuk doli në formatin 64-bajtësh që përdor shembulli .NET.');
  }
  return { details, signature: signature.toString('base64') };
}

export function verifyEncodedCoupon(publicKeyPem: string, details: string, signatureBase64: string): boolean {
  const signature = Buffer.from(signatureBase64, 'base64');
  return verify(
    'sha256',
    Buffer.from(details, 'utf8'),
    { key: publicKeyPem, dsaEncoding: 'ieee-p1363' },
    signature,
  );
}

export function citizenQrPayload(privateKeyPem: string, citizenBytes: Buffer): string {
  const signed = signEncodedCoupon(privateKeyPem, citizenBytes);
  return `${signed.details}|${signed.signature}`;
}
