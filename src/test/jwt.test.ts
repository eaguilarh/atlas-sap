import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signAccessToken, verifyAccessToken } from '../services/jwt.js';

describe('JWT service', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.JWT_SECRET = 'test-secret-key-with-at-least-32-characters';
    process.env.JWT_ISSUER = 'atlas-sap-operations';
    process.env.JWT_AUDIENCE = 'atlas-api';
  });

  it('signs and verifies access token', () => {
    const payload = { sub: 'user-123', email: 'test@test.com', role: 'fte' };
    const token = signAccessToken(payload);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);

    const verified = verifyAccessToken(token);
    expect(verified).not.toBeNull();
    expect(verified!.sub).toBe('user-123');
    expect(verified!.email).toBe('test@test.com');
    expect(verified!.role).toBe('fte');
  });

  it('rejects invalid token', () => {
    const result = verifyAccessToken('invalid.token.string');
    expect(result).toBeNull();
  });

  it('rejects token with wrong secret', () => {
    const payload = { sub: 'user-123', email: 'test@test.com', role: 'fte' };
    const token = signAccessToken(payload);

    process.env.JWT_SECRET = 'different-secret-key-with-at-least-32-characters';
    vi.resetModules();

    const { verifyAccessToken: verifyWithWrongSecret } = await import('../services/jwt.js');
    const result = verifyWithWrongSecret(token);
    expect(result).toBeNull();
  });

  it('includes issuer and audience in token', () => {
    const payload = { sub: 'user-123', email: 'test@test.com', role: 'fte' };
    const token = signAccessToken(payload);
    const parts = token.split('.');
    const payloadDecoded = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

    expect(payloadDecoded.iss).toBe('atlas-sap-operations');
    expect(payloadDecoded.aud).toBe('atlas-api');
  });

  it('token expires in 24h', () => {
    const payload = { sub: 'user-123', email: 'test@test.com', role: 'fte' };
    const token = signAccessToken(payload);
    const parts = token.split('.');
    const payloadDecoded = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

    const now = Math.floor(Date.now() / 1000);
    expect(payloadDecoded.exp - payloadDecoded.iat).toBe(86400); // 24 hours
  });
});