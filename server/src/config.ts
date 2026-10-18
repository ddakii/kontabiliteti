import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

function requiredInProduction(name: string, value: string | undefined): string {
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Mungon variabla e detyrueshme ${name}.`);
  }
  return '';
}

const encryptionKey = process.env.AUTH_ENCRYPTION_KEY ?? '';
if (process.env.NODE_ENV === 'production') {
  if (!/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
    throw new Error('AUTH_ENCRYPTION_KEY duhet të jetë 64 karaktere hex në produksion.');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL mungon.');
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  appUrl: process.env.APP_URL ?? 'http://localhost:5173',
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  databaseUrl: process.env.DATABASE_URL ?? '',
  encryptionKey,
  sessionCookie: process.env.SESSION_COOKIE_NAME ?? 'kp_session',
  sessionDays: Number(process.env.SESSION_DAYS ?? 14),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 15 * 1024 * 1024),
  storageDir: path.resolve(process.env.STORAGE_DIR ?? path.join(__dirname, '../storage')),
  timezone: process.env.APP_TIMEZONE ?? 'Europe/Belgrade',
  trialDays: Number(process.env.DEFAULT_TRIAL_DAYS ?? 14),
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? '',
    password: process.env.SMTP_PASSWORD ?? '',
    from: process.env.SMTP_FROM ?? 'Kontabiliteti Pro <noreply@example.com>',
  },
  exposeDevTokens: (process.env.NODE_ENV ?? 'development') !== 'production',
};

export function assertEncryptionKey(): Buffer {
  const key = config.encryptionKey || process.env.AUTH_ENCRYPTION_KEY || '';
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('AUTH_ENCRYPTION_KEY mungon ose nuk është 64 karaktere hex.');
  }
  return Buffer.from(key, 'hex');
}

void requiredInProduction;
