import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { displayDate } from '../lib/dates';
import { AppError } from '../lib/errors';

type InvoicePdf = {
  company: {
    legalName: string;
    tradeName?: string | null;
    address?: string | null;
    municipality?: string | null;
    fiscalNumber?: string | null;
    vatNumber?: string | null;
    businessNumber?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  customer?: {
    name: string;
    address?: string | null;
    municipality?: string | null;
    fiscalNumber?: string | null;
    vatNumber?: string | null;
  } | null;
  displayNumber?: string | null;
  issueDate: Date | string;
  dueDate: Date | string;
  currency: string;
  notes?: string | null;
  paymentInstructions?: string | null;
  paymentTerms?: string | null;
  subtotal: { toString(): string };
  discountTotal: { toString(): string };
  taxableBase: { toString(): string };
  vatTotal: { toString(): string };
  total: { toString(): string };
  amountPaid: { toString(): string };
  amountCredited: { toString(): string };
  lines: {
    description: string;
    quantity: { toString(): string };
    unitPrice: { toString(): string };
    discountPercent: { toString(): string };
    vatPercent: { toString(): string };
    netAmount: { toString(): string };
    vatAmount: { toString(): string };
    lineTotal: { toString(): string };
  }[];
};

const regularFont = path.resolve(__dirname, '../../assets/fonts/DejaVuSans.ttf');
const boldFont = path.resolve(__dirname, '../../assets/fonts/DejaVuSans-Bold.ttf');

export function renderInvoicePdf(invoice: InvoicePdf): Promise<Buffer> {
  if (!fs.existsSync(regularFont) || !fs.existsSync(boldFont)) {
    throw new AppError('FONT_MISSING', 500, 'Fontet për PDF mungojnë. Shkarkoni DejaVu Sans te server/assets/fonts.');
  }
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('Body', regularFont);
    doc.registerFont('Bold', boldFont);

    const left = 48;
    const right = 547;
    doc.rect(0, 0, 595, 8).fill('#2563EB');
    doc.fillColor('#0F172A').font('Bold').fontSize(18).text('FATURË', left, 28);
    doc.font('Body').fontSize(10).fillColor('#64748B').text(invoice.displayNumber ?? 'Draft', left, 52);
    doc.font('Bold').fontSize(12).fillColor('#0F172A').text(invoice.company.legalName, 300, 28, { width: 247, align: 'right' });
    doc.font('Body').fontSize(9).fillColor('#334155');
    const seller = [
      invoice.company.tradeName,
      invoice.company.address,
      invoice.company.municipality,
      invoice.company.fiscalNumber ? `Numri fiskal: ${invoice.company.fiscalNumber}` : null,
      invoice.company.businessNumber ? `Numri i biznesit: ${invoice.company.businessNumber}` : null,
      invoice.company.vatNumber ? `Numri i TVSH-së: ${invoice.company.vatNumber}` : null,
      invoice.company.email,
      invoice.company.phone,
    ]
      .filter(Boolean)
      .join('\n');
    doc.text(seller, 300, 48, { width: 247, align: 'right' });

    doc.moveTo(left, 150).lineTo(right, 150).strokeColor('#E2E8F0').stroke();
    doc.font('Bold').fontSize(9).fillColor('#64748B').text('BLERËSI', left, 164);
    doc.font('Bold').fontSize(11).fillColor('#0F172A').text(invoice.customer?.name ?? '—', left, 178);
    doc.font('Body').fontSize(9).fillColor('#334155').text(
      [invoice.customer?.address, invoice.customer?.municipality, invoice.customer?.fiscalNumber ? `Numri fiskal: ${invoice.customer.fiscalNumber}` : null, invoice.customer?.vatNumber ? `TVSH: ${invoice.customer.vatNumber}` : null]
        .filter(Boolean)
        .join('\n'),
      left,
      196,
      { width: 240 },
    );

    const metaY = 164;
    meta(doc, 360, metaY, 'Data e lëshimit', displayDate(iso(invoice.issueDate)));
    meta(doc, 360, metaY + 28, 'Data e afatit', displayDate(iso(invoice.dueDate)));
    meta(doc, 360, metaY + 56, 'Monedha', invoice.currency);

    let y = 280;
    doc.rect(left, y, right - left, 22).fill('#0F172A');
    doc.fillColor('#FFFFFF').font('Bold').fontSize(8);
    const columns = [left + 6, 250, 300, 350, 410, 470];
    doc.text('Përshkrimi', columns[0], y + 7, { width: 190 });
    doc.text('Sasia', columns[1], y + 7, { width: 40, align: 'right' });
    doc.text('Çmimi', columns[2], y + 7, { width: 48, align: 'right' });
    doc.text('TVSH %', columns[3], y + 7, { width: 48, align: 'right' });
    doc.text('Neto', columns[4], y + 7, { width: 50, align: 'right' });
    doc.text('Totali', columns[5], y + 7, { width: 70, align: 'right' });
    y += 28;
    doc.font('Body').fontSize(9).fillColor('#0F172A');

    invoice.lines.forEach((line, index) => {
      const height = doc.heightOfString(line.description, { width: 190 }) + 10;
      if (y + height > 740) {
        doc.addPage();
        y = 48;
      }
      if (index % 2 === 0) doc.rect(left, y - 4, right - left, height).fill('#F8FAFC');
      doc.fillColor('#0F172A').text(line.description, columns[0], y, { width: 190 });
      doc.text(formatQty(line.quantity.toString()), columns[1], y, { width: 40, align: 'right' });
      doc.text(money(line.unitPrice.toString()), columns[2], y, { width: 48, align: 'right' });
      doc.text(Number(line.vatPercent.toString()).toFixed(0), columns[3], y, { width: 48, align: 'right' });
      doc.text(money(line.netAmount.toString()), columns[4], y, { width: 50, align: 'right' });
      doc.text(money(line.lineTotal.toString()), columns[5], y, { width: 70, align: 'right' });
      y += height;
    });

    y += 12;
    if (y > 680) {
      doc.addPage();
      y = 48;
    }
    const totals = [
      ['Nëntotali', invoice.subtotal.toString()],
      ['Zbritja', invoice.discountTotal.toString()],
      ['Baza e tatueshme', invoice.taxableBase.toString()],
      ['TVSH', invoice.vatTotal.toString()],
    ];
    totals.forEach(([label, value]) => {
      doc.font('Body').fillColor('#64748B').text(label, 340, y, { width: 120, align: 'right' });
      doc.fillColor('#0F172A').text(`${money(value)} ${invoice.currency}`, 460, y, { width: 87, align: 'right' });
      y += 16;
    });
    doc.rect(340, y, 207, 26).fill('#EFF6FF');
    doc.fillColor('#1D4ED8').font('Bold').text('Për t\'u paguar', 348, y + 8, { width: 100 });
    doc.text(`${money(invoice.total.toString())} ${invoice.currency}`, 450, y + 8, { width: 90, align: 'right' });
    y += 40;
    const paid = Number(invoice.amountPaid.toString());
    const credited = Number(invoice.amountCredited.toString());
    if (paid > 0 || credited > 0) {
      doc.font('Body').fontSize(9).fillColor('#334155').text(
        `E paguar: ${money(invoice.amountPaid.toString())} ${invoice.currency} · E kredituar: ${money(invoice.amountCredited.toString())} ${invoice.currency}`,
        left,
        y,
      );
      y += 18;
    }
    if (invoice.paymentInstructions || invoice.paymentTerms) {
      doc.font('Bold').fontSize(9).fillColor('#0F172A').text('Udhëzime pagese', left, y);
      doc.font('Body').fontSize(9).fillColor('#334155').text(
        [invoice.paymentTerms, invoice.paymentInstructions].filter(Boolean).join('\n'),
        left,
        y + 14,
        { width: 500 },
      );
      y += 48;
    }
    if (invoice.notes) {
      doc.font('Bold').fontSize(9).fillColor('#0F172A').text('Shënime', left, y);
      doc.font('Body').fontSize(9).fillColor('#334155').text(invoice.notes, left, y + 14, { width: 500 });
    }

    const pages = doc.bufferedPageRange();
    for (let index = 0; index < pages.count; index += 1) {
      doc.switchToPage(index);
      doc.font('Body').fontSize(8).fillColor('#94A3B8').text(
        `Faqe ${index + 1} nga ${pages.count} · Dokument i gjeneruar nga Kontabiliteti Pro · Nuk është certifikim fiskal`,
        left,
        810,
        { width: 500, align: 'center' },
      );
    }
    doc.end();
  });
}

function meta(doc: PDFKit.PDFDocument, x: number, y: number, label: string, value: string) {
  doc.font('Body').fontSize(8).fillColor('#64748B').text(label, x, y, { width: 180 });
  doc.font('Bold').fontSize(10).fillColor('#0F172A').text(value, x, y + 11, { width: 180 });
}

function money(value: string) {
  const [whole, fraction = '00'] = Number(value).toFixed(2).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${fraction}`;
}

function formatQty(value: string) {
  return Number(value).toLocaleString('sq-AL', { maximumFractionDigits: 4 });
}

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}
