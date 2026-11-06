import { vi } from 'vitest';
import pino from 'pino';

vi.mock('pino', () => ({
  default: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }),
}));

process.env.JWT_SECRET = 'test-secret-key-with-at-least-32-characters';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.ALLOWED_ORIGINS = 'http://localhost:54321';