import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sanitize } from '../utils/sanitize.js';
import { generateSecureToken, hashToken, hashPassword, generateResetCode, generateRequestId } from '../utils/crypto.js';

describe('sanitize', () => {
  it('redacts password fields', () => {
    const input = { password: 'secret123', name: 'John' };
    const result = sanitize(input);
    expect(result.password).toBe('[REDACTED]');
    expect(result.name).toBe('John');
  });

  it('redacts nested sensitive fields', () => {
    const input = { user: { password_hash: 'hash', email: 'test@test.com' } };
    const result = sanitize(input);
    expect(result.user.password_hash).toBe('[REDACTED]');
    expect(result.user.email).toBe('test@test.com');
  });

  it('handles arrays', () => {
    const input = [{ token: 'abc', id: 1 }, { token: 'def', id: 2 }];
    const result = sanitize(input);
    expect(result[0].token).toBe('[REDACTED]');
    expect(result[0].id).toBe(1);
  });

  it('handles null and undefined', () => {
    expect(sanitize(null)).toBeNull();
    expect(sanitize(undefined)).toBeUndefined();
  });

  it('redacts authorization header', () => {
    const input = { authorization: 'Bearer token123', contentType: 'application/json' };
    const result = sanitize(input);
    expect(result.authorization).toBe('[REDACTED]');
    expect(result.contentType).toBe('application/json');
  });
});

describe('crypto utils', () => {
  it('generateSecureToken returns hex string of correct length', () => {
    const token = generateSecureToken(32);
    expect(token).toHaveLength(64); // 32 bytes = 64 hex chars
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it('hashToken produces consistent SHA256', () => {
    const token = 'test-token';
    const hash1 = hashToken(token);
    const hash2 = hashToken(token);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('hashPassword produces consistent SHA256', () => {
    const password = 'mypassword';
    const hash1 = hashPassword(password);
    const hash2 = hashPassword(password);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('generateResetCode returns 6-digit string', () => {
    const code = generateResetCode();
    expect(code).toMatch(/^\d{6}$/);
  });

  it('generateRequestId returns valid UUID', () => {
    const id = generateRequestId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});