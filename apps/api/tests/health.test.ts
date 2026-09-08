import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const app = buildApp();
afterAll(() => app.close());
describe('GET /health', () => {
  it('returns application health', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('production HTTP boundaries', () => {
  it('adds request/security headers and reports dependency readiness', async () => {
    const healthy = buildApp({ readinessCheck: async () => undefined });
    const ready = await healthy.inject({ method: 'GET', url: '/ready', headers: { 'x-request-id': 'qa-request-id' } });
    expect(ready.statusCode).toBe(200);
    expect(ready.headers['x-request-id']).toBe('qa-request-id');
    expect(ready.headers['x-content-type-options']).toBe('nosniff');
    expect(ready.headers['x-frame-options']).toBe('DENY');
    await healthy.close();

    const unavailable = buildApp({ readinessCheck: async () => { throw new Error('secret connection details'); } });
    const response = await unavailable.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('secret connection details');
    await unavailable.close();
  });

  it('sanitizes unexpected 5xx responses and keeps a correlation id', async () => {
    const isolated = buildApp();
    isolated.get('/test-unhandled-error', async () => { throw new Error('sensitive internal detail'); });
    const response = await isolated.inject({ method: 'GET', url: '/test-unhandled-error' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: 'internal_server_error', requestId: expect.any(String) });
    expect(response.body).not.toContain('sensitive internal detail');
    await isolated.close();
  });
});
