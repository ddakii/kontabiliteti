import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { parseBody, rateLimit, requireAuth } from '../middleware/security';
import {
  acceptInvitation,
} from '../services/office';
import {
  currentProfile,
  disableTwoFactor,
  enableTwoFactor,
  forgotPassword,
  loginAccount,
  logoutAll,
  logoutSession,
  registerAccount,
  resendVerification,
  resetPassword,
  sessionCookieOptions,
  setupTwoFactor,
  verifyEmail,
  verifyTwoFactor,
} from '../services/auth';
import { sendData } from '../lib/http';

export const authRouter = Router();

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(10).max(200),
});

authRouter.post('/register', rateLimit(8, 15 * 60 * 1000, 'register'), async (req, res, next) => {
  try {
    const body = parseBody(
      z.object({
        name: z.string().min(2).max(120),
        email: z.string().email(),
        password: z.string().min(10).max(200),
        firmName: z.string().min(2).max(180),
        planCode: z.string().optional(),
      }),
      req.body,
    );
    const result = await registerAccount({ ...body, ip: req.ip });
    sendData(res, result, 201);
  } catch (error) {
    next(error);
  }
});

authRouter.post('/login', rateLimit(10, 15 * 60 * 1000, 'login'), async (req, res, next) => {
  try {
    const body = parseBody(credentials, req.body);
    const result = await loginAccount({ ...body, ip: req.ip, userAgent: req.get('user-agent') });
    if (!result.requiresTwoFactor) res.cookie(config.sessionCookie, result.token, sessionCookieOptions());
    sendData(res, result.requiresTwoFactor ? result : { user: { id: result.user.id, name: result.user.name, email: result.user.email } });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/2fa/verify', async (req, res, next) => {
  try {
    const body = parseBody(z.object({ challengeToken: z.string().min(10), code: z.string().min(6).max(8) }), req.body);
    const result = await verifyTwoFactor({ ...body, ip: req.ip, userAgent: req.get('user-agent') });
    res.cookie(config.sessionCookie, result.token, sessionCookieOptions());
    sendData(res, { user: { id: result.user.id, name: result.user.name, email: result.user.email } });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await logoutSession(req.auth!.sessionId, req.auth!.userId, req.ip);
    res.clearCookie(config.sessionCookie, { path: '/' });
    sendData(res, { loggedOut: true });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/logout-all', requireAuth, async (req, res, next) => {
  try {
    await logoutAll(req.auth!.userId, req.ip);
    res.clearCookie(config.sessionCookie, { path: '/' });
    sendData(res, { loggedOut: true });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/verify-email', async (req, res, next) => {
  try {
    const body = parseBody(z.object({ token: z.string().min(10) }), req.body);
    await verifyEmail(body.token);
    sendData(res, { verified: true });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/resend-verification', requireAuth, async (req, res, next) => {
  try {
    sendData(res, await resendVerification(req.auth!.userId));
  } catch (error) {
    next(error);
  }
});

authRouter.post('/forgot-password', rateLimit(6, 15 * 60 * 1000, 'forgot'), async (req, res, next) => {
  try {
    const body = parseBody(z.object({ email: z.string().email() }), req.body);
    sendData(res, await forgotPassword(body.email));
  } catch (error) {
    next(error);
  }
});

authRouter.post('/reset-password', async (req, res, next) => {
  try {
    const body = parseBody(z.object({ token: z.string().min(10), password: z.string().min(10).max(200) }), req.body);
    await resetPassword(body.token, body.password, req.ip);
    sendData(res, { reset: true });
  } catch (error) {
    next(error);
  }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    sendData(res, await currentProfile(req.auth!.userId));
  } catch (error) {
    next(error);
  }
});

authRouter.post('/2fa/setup', requireAuth, async (req, res, next) => {
  try {
    sendData(res, await setupTwoFactor(req.auth!.userId));
  } catch (error) {
    next(error);
  }
});

authRouter.post('/2fa/enable', requireAuth, async (req, res, next) => {
  try {
    const body = parseBody(z.object({ code: z.string().min(6).max(8) }), req.body);
    await enableTwoFactor(req.auth!.userId, body.code);
    sendData(res, { enabled: true });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/2fa/disable', requireAuth, async (req, res, next) => {
  try {
    const body = parseBody(z.object({ password: z.string().min(10), code: z.string().min(6).max(8) }), req.body);
    await disableTwoFactor(req.auth!.userId, body.password, body.code);
    sendData(res, { enabled: false });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/invitations/accept', async (req, res, next) => {
  try {
    const body = parseBody(z.object({ token: z.string().min(10), name: z.string().min(2).optional(), password: z.string().min(10).optional() }), req.body);
    sendData(res, await acceptInvitation(body));
  } catch (error) {
    next(error);
  }
});
