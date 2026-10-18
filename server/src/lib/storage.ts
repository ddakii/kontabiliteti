import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { badRequest } from './errors';

const ALLOWED = new Map<string, string>([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['text/csv', '.csv'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  ['application/vnd.ms-excel', '.xls'],
]);

export function assertUpload(file: { mimetype: string; size: number; originalname: string }) {
  if (!ALLOWED.has(file.mimetype)) {
    throw badRequest('Lloji i skedarit nuk lejohet. Përdorni PDF, JPG, PNG, WEBP, CSV ose Excel.');
  }
  if (file.size <= 0 || file.size > config.maxUploadBytes) {
    throw badRequest('Madhësia e skedarit nuk lejohet.');
  }
}

export async function storePrivateFile(
  firmId: string,
  companyId: string,
  file: { mimetype: string; size: number; originalname: string; buffer: Buffer },
) {
  assertUpload(file);
  const extension = ALLOWED.get(file.mimetype) ?? '';
  const storedName = `${randomUUID()}${extension}`;
  const directory = path.resolve(config.storageDir, firmId, companyId);
  const fullPath = path.resolve(directory, storedName);
  if (!fullPath.startsWith(path.resolve(config.storageDir))) {
    throw badRequest('Shtegu i skedarit u refuzua.');
  }
  await mkdir(directory, { recursive: true });
  await writeFile(fullPath, file.buffer);
  return {
    storedName: path.join(firmId, companyId, storedName),
    originalName: path.basename(file.originalname).slice(0, 180),
    mimeType: file.mimetype,
    sizeBytes: file.size,
  };
}

export function openPrivateFile(storedName: string) {
  const fullPath = path.resolve(config.storageDir, storedName);
  const root = path.resolve(config.storageDir);
  if (!fullPath.startsWith(root)) throw badRequest('Shtegu i skedarit u refuzua.');
  return { fullPath, stream: createReadStream(fullPath) };
}
