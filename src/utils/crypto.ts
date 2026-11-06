import crypto from 'crypto';

export function generateSecureToken(bytes = 64): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export function generateResetCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function generateRequestId(): string {
  return crypto.randomUUID();
}