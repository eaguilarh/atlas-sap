const SENSITIVE_KEYS = [
  'password',
  'password_hash',
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'apikey',
  'secret',
  'key',
];

export function sanitize<T>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;

  const clean: Record<string, unknown> = Array.isArray(obj) ? [] : {};

  for (const [key, val] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k))) {
      clean[key] = '[REDACTED]';
    } else if (typeof val === 'object' && val !== null) {
      clean[key] = sanitize(val);
    } else {
      clean[key] = val;
    }
  }

  return clean as T;
}