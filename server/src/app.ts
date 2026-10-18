import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { config } from './config';
import { AppError } from './lib/errors';
import { authRouter } from './routes/auth';
import { platformRouter } from './routes/platform';
import { portalRouter, workspaceRouter } from './routes/workspace';
import { csrfGuard } from './middleware/security';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: config.webOrigin, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use((req, _res, next) => {
    req.correlationId = req.get('x-correlation-id') || randomUUID();
    next();
  });
  app.get('/api/health', (_req, res) => {
    res.json({ data: { status: 'ok', service: 'kontabiliteti-pro' } });
  });
  app.use('/api', csrfGuard);
  app.use('/api/auth', authRouter);
  app.use('/api/platform', platformRouter);
  app.use('/api/portal', portalRouter);
  app.use('/api', workspaceRouter);
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details, correlationId: req.correlationId } });
      return;
    }
    if (error instanceof ZodError) {
      res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Të dhënat nuk janë të vlefshme.', correlationId: req.correlationId } });
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      res.status(409).json({ error: { code: 'DUPLICATE', message: 'Ky regjistrim ekziston tashmë.', correlationId: req.correlationId } });
      return;
    }
    console.error(JSON.stringify({ correlationId: req.correlationId, message: error instanceof Error ? error.message : 'Gabim' }));
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Ndodhi një gabim i brendshëm.', correlationId: req.correlationId } });
  });
  return app;
}
