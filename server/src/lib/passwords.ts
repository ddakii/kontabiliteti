import bcrypt from 'bcryptjs';

const ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ROUNDS);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export function assertPasswordStrength(password: string): void {
  if (password.length < 10) {
    throw new Error('Fjalëkalimi duhet të ketë të paktën 10 karaktere.');
  }
  if (!/[A-Za-zËÇëç]/.test(password) || !/\d/.test(password)) {
    throw new Error('Fjalëkalimi duhet të përmbajë shkronja dhe numra.');
  }
}
