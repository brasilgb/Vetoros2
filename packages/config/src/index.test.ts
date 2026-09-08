import { describe, expect, it } from 'vitest';
import { parseServerEnv } from './index.js';

const required = {
  DATABASE_URL: 'postgresql://runtime:secret@db:5432/vetoros',
  AUTH_DATABASE_URL: 'postgresql://auth:secret@db:5432/vetoros',
  REDIS_URL: 'redis://:secret@redis:6379',
};

describe('server production environment', () => {
  it('accepts a secure proxy deployment', () => {
    expect(parseServerEnv({ ...required, NODE_ENV: 'production', WEB_ORIGIN: 'https://vetoros.example', COOKIE_SECURE: 'true', TRUST_PROXY: 'true' })).toMatchObject({ NODE_ENV: 'production', COOKIE_SECURE: true, TRUST_PROXY: true });
  });

  it('rejects insecure production cookies and origin', () => {
    expect(() => parseServerEnv({ ...required, NODE_ENV: 'production', WEB_ORIGIN: 'http://vetoros.example', COOKIE_SECURE: 'false' })).toThrow();
  });

  it('rejects malformed booleans and dependency protocols', () => {
    expect(() => parseServerEnv({ ...required, COOKIE_SECURE: 'yes' })).toThrow();
    expect(() => parseServerEnv({ ...required, DATABASE_URL: 'https://db.example/vetoros' })).toThrow();
    expect(() => parseServerEnv({ ...required, REDIS_URL: 'https://redis.example' })).toThrow();
  });
});
