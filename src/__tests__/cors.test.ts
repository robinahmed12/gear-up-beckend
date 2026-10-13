import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';

describe('CORS', () => {
  it('reflects an allowlisted origin and allows credentials', async () => {
    const res = await request(app).get('/').set('Origin', 'http://localhost:3000');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not reflect a disallowed origin', async () => {
    const res = await request(app).get('/').set('Origin', 'http://evil.example.com');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('never responds with a wildcard origin', async () => {
    const res = await request(app).get('/').set('Origin', 'http://localhost:5173');

    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });
});
