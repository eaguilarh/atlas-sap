import jwt, { SignOptions, JwtPayload } from 'jsonwebtoken';
import { getEnv } from '../config/env.js';
import { generateSecureToken, hashToken } from '../utils/crypto.js';
import { getPool } from '../config/db.js';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface JWTPayload extends JwtPayload {
  sub: string;
  email: string;
  role: string;
}

const ACCESS_TOKEN_EXPIRY = '24h';
const REFRESH_TOKEN_DAYS = 30;

export function signAccessToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  const env = getEnv();
  const options: SignOptions = {
    expiresIn: ACCESS_TOKEN_EXPIRY,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function verifyAccessToken(token: string): JWTPayload | null {
  const env = getEnv();
  try {
    return jwt.verify(token, env.JWT_SECRET, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    }) as JWTPayload;
  } catch {
    return null;
  }
}

export async function generateRefreshToken(userId: string, clientIp: string): Promise<TokenPair> {
  const pool = getPool();
  const refreshToken = generateSecureToken();
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.refresh_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
      token_hash VARCHAR(255) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      created_ip VARCHAR(45),
      revoked_at TIMESTAMPTZ,
      revoked_ip VARCHAR(45),
      replaced_by_token_hash VARCHAR(255)
    );
  `).catch(() => {});

  await pool.query(
    `INSERT INTO public.refresh_tokens (user_id, token_hash, expires_at, created_ip) VALUES ($1, $2, $3, $4)`,
    [userId, tokenHash, expiresAt, clientIp]
  );

  return { accessToken: '', refreshToken, expiresAt };
}

export async function verifyRefreshToken(token: string, userId: string): Promise<boolean> {
  const pool = getPool();
  const tokenHash = hashToken(token);
  const result = await pool.query(
    `SELECT 1 FROM public.refresh_tokens 
     WHERE user_id = $1 AND token_hash = $2 AND revoked_at IS NULL AND expires_at > NOW()`,
    [userId, tokenHash]
  );
  return result.rows.length > 0;
}

export async function revokeRefreshToken(
  token: string,
  userId: string,
  revokedIp: string,
  replacedByToken?: string
): Promise<void> {
  const pool = getPool();
  const tokenHash = hashToken(token);
  const updateFields = ['revoked_at = NOW()', 'revoked_ip = $1'];
  const params: unknown[] = [revokedIp, userId, tokenHash];

  if (replacedByToken) {
    const replacedHash = hashToken(replacedByToken);
    updateFields.push('replaced_by_token_hash = $4');
    params.push(replacedHash);
  }

  await pool.query(
    `UPDATE public.refresh_tokens SET ${updateFields.join(', ')} WHERE user_id = $2 AND token_hash = $3`,
    params
  );

  await pool.query(
    `UPDATE public.refresh_tokens SET revoked_at = NOW(), revoked_ip = $1 
     WHERE user_id = $2 AND replaced_by_token_hash = $3`,
    [revokedIp, userId, tokenHash]
  );
}

export async function rotateRefreshToken(
  oldToken: string,
  userId: string,
  clientIp: string
): Promise<TokenPair> {
  await revokeRefreshToken(oldToken, userId, clientIp);
  return generateRefreshToken(userId, clientIp);
}

export async function createTokenPair(
  userId: string,
  email: string,
  role: string,
  clientIp: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date; refreshExpiresAt: Date }> {
  const accessToken = signAccessToken({ sub: userId, email, role });
  const { refreshToken, expiresAt: refreshExpiresAt } = await generateRefreshToken(userId, clientIp);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  return { accessToken, refreshToken, expiresAt, refreshExpiresAt };
}