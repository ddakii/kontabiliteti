import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { AppError } from '../lib/errors';
import { fiscalDocumentTitle } from './status';

const regularFont = path.resolve(__dirname, '../../assets/fonts/DejaVuSans.ttf');
const boldFont = path.resolve(__dirname, '../../assets/fonts/DejaVuSans-Bold.ttf');

export type FiscalPdfInput = {
  companyName: string;
  nui: string | null;
  status: string;
  type: string;
  environment: string;
  couponId: string;
  transactionId: string | null;
  invoiceNumber: string | null;
  total: string;
  branchNumber: string | null;
  posNumber: string | null;
  verificationNo: string;
  qrPayload: string | null;
  errorMessage: string | null;
};

export async function renderFiscalReceiptPdf(input: FiscalPdfInput): Promise<Buffer> {
  if (!fs.existsSync(regularFont) || !fs.existsSync(boldFont)) {
    throw new AppError('FONT_MISSING', 500, 'Fontet për PDF mungojnë.');
  }
  const title = fiscalDocumentTitle(input.status, input.transactionId);
  const qr = input.status === 'FISCALIZED' && input.qrPayload ? await QRCode.toBuffer(input.qrPayload, { width: 180, margin: 1 }) : null;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.font(boldFont).fontSize(16).text(title);
    doc.moveDown(0.4);
    doc.font(regularFont).fontSize(10).fillColor('#334155').text(input.companyName);
    if (input.nui) doc.text(`NUI: ${input.nui}`);
    doc.text(`Fatura: ${input.invoiceNumber ?? '—'}`);
    doc.text(`Kuponi: ${input.couponId} · ${input.type} · ${input.environment}`);
    doc.text(`Dega: ${input.branchNumber ?? '—'} · POS: ${input.posNumber ?? '—'}`);
    doc.text(`Totali: ${input.total} EUR`);
    doc.text(`Verifikimi: ${input.verificationNo}`);
    if (input.status === 'FISCALIZED' && input.transactionId) doc.text(`Numri i transaksionit ATK: ${input.transactionId}`);
    if (input.errorMessage) doc.text(input.errorMessage);
    doc.moveDown();
    if (qr) {
      doc.font(boldFont).fillColor('#0F172A').text('Kodi QR i kuponit të qytetarit');
      doc.moveDown(0.3);
      doc.image(qr, { width: 140 });
      doc.moveDown();
      doc.font(regularFont).fontSize(8).fillColor('#64748B').text('QR përmban kuponin e qytetarit dhe nënshkrimin, sipas shembullit publik. Nuk është një adresë e shpikur.');
    } else {
      doc.font(regularFont).fontSize(10).fillColor('#92400E').text('Ky dokument nuk është kupon i fiskalizuar. Nuk ka kod QR verifikimi.');
    }
    doc.moveDown();
    doc.font(regularFont).fontSize(8).fillColor('#64748B').text('Gjeneruar nga Kontabiliteti Pro. Nuk është certifikim i programit nga ATK.');
    doc.end();
  });
}
