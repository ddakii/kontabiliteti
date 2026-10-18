import nodemailer from 'nodemailer';
import { config } from '../config';
import { prisma } from './prisma';

export async function sendEmail(input: {
  to: string;
  subject: string;
  body: string;
  firmId?: string;
  relatedType?: string;
  relatedId?: string;
  attachment?: { filename: string; content: Buffer; contentType: string };
}) {
  if (!config.smtp.host) {
    await prisma.emailOutbox.create({
      data: {
        firmId: input.firmId,
        toAddress: input.to,
        subject: input.subject,
        body: input.body,
        status: 'NOT_CONFIGURED',
        error: 'SMTP nuk është i konfiguruar. Mesazhi nuk u dërgua.',
        relatedType: input.relatedType,
        relatedId: input.relatedId,
      },
    });
    return { delivered: false as const, reason: 'NOT_CONFIGURED' as const };
  }

  try {
    const transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
    });
    await transport.sendMail({
      from: config.smtp.from,
      to: input.to,
      subject: input.subject,
      text: input.body,
      attachments: input.attachment
        ? [{ filename: input.attachment.filename, content: input.attachment.content, contentType: input.attachment.contentType }]
        : undefined,
    });
    await prisma.emailOutbox.create({
      data: {
        firmId: input.firmId,
        toAddress: input.to,
        subject: input.subject,
        body: input.body,
        status: 'SENT',
        relatedType: input.relatedType,
        relatedId: input.relatedId,
        sentAt: new Date(),
      },
    });
    return { delivered: true as const };
  } catch (error) {
    await prisma.emailOutbox.create({
      data: {
        firmId: input.firmId,
        toAddress: input.to,
        subject: input.subject,
        body: input.body,
        status: 'FAILED',
        error: error instanceof Error ? error.message : 'Dërgimi dështoi.',
        relatedType: input.relatedType,
        relatedId: input.relatedId,
      },
    });
    return { delivered: false as const, reason: 'FAILED' as const };
  }
}
