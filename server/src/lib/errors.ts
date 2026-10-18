export class AppError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function notFound(message = 'Regjistrimi nuk u gjet.'): AppError {
  return new AppError('NOT_FOUND', 404, message);
}

export function forbidden(message = 'Nuk keni leje për këtë veprim.'): AppError {
  return new AppError('FORBIDDEN', 403, message);
}

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError('BAD_REQUEST', 400, message, details);
}
