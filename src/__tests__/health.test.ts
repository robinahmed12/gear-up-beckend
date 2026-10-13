import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';

describe('GET /api/health', () => {
  it('returns 200 with the standard success envelope', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, message: 'GearUp API is healthy' });
    expect(res.body.data.status).toBe('ok');
    expect(typeof res.body.data.uptime).toBe('number');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('echoes an inbound x-request-id header', async () => {
    const res = await request(app).get('/api/health').set('x-request-id', 'test-req-123');

    expect(res.headers['x-request-id']).toBe('test-req-123');
  });

  it('keeps the existing root endpoint working', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
