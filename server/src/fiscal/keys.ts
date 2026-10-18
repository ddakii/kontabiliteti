import 'reflect-metadata';
import { createHash, createPublicKey, webcrypto, X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cryptoProvider, Pkcs10CertificateRequestGenerator, X509CertificateGenerator } from '@peculiar/x509';
import { config } from '../config';
import { decryptSecret, encryptSecret } from '../lib/tokens';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

(cryptoProvider.set as (value: unknown) => unknown)(webcrypto);

export type GeneratedKey = { pkcs8Pem: string; csrPem: string; fingerprint: string };

function assertIds(companyId: string, posId: string) {
  if (!UUID.test(companyId) || !UUID.test(posId)) throw new Error('Identifikuesi i çelësit është i pavlefshëm.');
}

function keyFile(companyId: string, posId: string) {
  assertIds(companyId, posId);
  const root = path.resolve(config.storageDir, 'fiscal-keys', companyId);
  const file = path.resolve(root, `${posId}.enc`);
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Rruga e çelësit është e pavlefshme.');
  return file;
}

export function relativeKeyPath(companyId: string, posId: string) {
  assertIds(companyId, posId);
  return `fiscal-keys/${companyId}/${posId}.enc`;
}

function pemEncode(label: string, der: ArrayBuffer): string {
  const body = Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n');
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

async function importSigningPair(pkcs8Pem: string): Promise<webcrypto.CryptoKeyPair> {
  const der = Buffer.from(pkcs8Pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''), 'base64');
  const privateKey = await webcrypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const spki = createPublicKey(pkcs8Pem).export({ type: 'spki', format: 'der' });
  const publicKey = await webcrypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
  return { privateKey, publicKey };
}

/** Çelësi gjenerohet këtu dhe ruhet i enkriptuar në diskun e këtij procesi, jo në bazë dhe jo në shfletues. */
export async function generateCsr(input: {
  businessName: string;
  nui: string;
  branchId: string;
  posId: string;
}): Promise<GeneratedKey> {
  if (!input.businessName.trim() || /[,+=\r\n"]/.test(input.businessName)) {
    throw new Error('Emri i biznesit nga ATK përmban karaktere që nuk vendosen në kërkesën e certifikatës.');
  }
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pkcs8Pem = pemEncode('PRIVATE KEY', await webcrypto.subtle.exportKey('pkcs8', keys.privateKey));
  const csr = await Pkcs10CertificateRequestGenerator.create({
    name: `C=RKS, O=${input.nui}, OU=${input.posId}, L=${input.branchId}, CN=${input.businessName}`,
    keys: keys as unknown as globalThis.CryptoKeyPair,
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
  });
  const fingerprint = createHash('sha256')
    .update(createPublicKey(pkcs8Pem).export({ type: 'spki', format: 'der' }))
    .digest('hex');
  return { pkcs8Pem, csrPem: csr.toString('pem'), fingerprint };
}

/** Certifikatë vetë-nënshkruar vetëm për prova lokale. ATK e zëvendëson këtë me certifikatën e vet. */
export async function selfSignedCertificate(privateKeyPem: string): Promise<string> {
  const keys = await importSigningPair(privateKeyPem);
  const certificate = await X509CertificateGenerator.createSelfSigned({
    name: 'CN=Test lokal',
    keys: keys as unknown as globalThis.CryptoKeyPair,
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
    notBefore: new Date(),
    notAfter: new Date(Date.now() + 86_400_000),
  });
  return certificate.toString('pem');
}

export function certificateMatchesKey(certificatePem: string, privateKeyPem: string): boolean {
  const certificate = new X509Certificate(certificatePem);
  const fromCertificate = certificate.publicKey.export({ type: 'spki', format: 'der' });
  const fromKey = createPublicKey(privateKeyPem).export({ type: 'spki', format: 'der' });
  return Buffer.from(fromCertificate).equals(Buffer.from(fromKey));
}

export function describeCertificate(certificatePem: string) {
  const certificate = new X509Certificate(certificatePem);
  return {
    subject: certificate.subject,
    notAfter: new Date(certificate.validTo),
    fingerprint: certificate.fingerprint256.replace(/:/g, '').toLowerCase(),
  };
}

export function savePrivateKey(companyId: string, posId: string, pkcs8Pem: string) {
  const file = keyFile(companyId, posId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.renameSync(file, `${file}.${Date.now()}.replaced`);
  fs.writeFileSync(file, encryptSecret(pkcs8Pem), { mode: 0o600 });
}

export function readPrivateKey(companyId: string, posId: string): string {
  return decryptSecret(fs.readFileSync(keyFile(companyId, posId), 'utf8'));
}

export function privateKeyExists(companyId: string, posId: string): boolean {
  return fs.existsSync(keyFile(companyId, posId));
}

export function retirePrivateKey(companyId: string, posId: string) {
  const file = keyFile(companyId, posId);
  if (!fs.existsSync(file)) return;
  fs.renameSync(file, `${file}.${Date.now()}.replaced`);
}
