import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../backend/src/app.js';

describe('API Security and Hardening (Phase 7 / T7.3)', () => {
  const TEST_SECRET = 'banana-test-per-launch-secret-xyz123';
  let server;
  let testPort;

  function sendHttpRequest({ path = '/api/health-check', headers = {} }) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: testPort,
        path,
        method: 'GET',
        headers
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch (_) {}
          resolve({ status: res.statusCode, body: json, raw: data });
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  before(async () => {
    const app = createApp({
      apiSecret: TEST_SECRET,
      validateHost: (host) => {
        return host === `127.0.0.1:${testPort}` || host === `localhost:${testPort}`;
      }
    });

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        testPort = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('rejects API request without x-banana-auth header (401 Unauthorized)', async () => {
    const res = await sendHttpRequest({
      headers: {
        Host: `127.0.0.1:${testPort}`
      }
    });
    assert.equal(res.status, 401);
    assert.match(res.body.error, /Unauthorized/);
  });

  test('rejects API request with wrong x-banana-auth header (401 Unauthorized)', async () => {
    const res = await sendHttpRequest({
      headers: {
        'x-banana-auth': 'wrong-secret-token',
        Host: `127.0.0.1:${testPort}`
      }
    });
    assert.equal(res.status, 401);
    assert.match(res.body.error, /Unauthorized/);
  });

  test('accepts API request with valid x-banana-auth header (200 OK)', async () => {
    const res = await sendHttpRequest({
      headers: {
        'x-banana-auth': TEST_SECRET,
        Host: `127.0.0.1:${testPort}`
      }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'healthy');
  });

  test('blocks DNS rebinding attack with invalid Host header (403 Forbidden)', async () => {
    const res = await sendHttpRequest({
      headers: {
        'x-banana-auth': TEST_SECRET,
        Host: `attacker-evil-site.com:${testPort}`
      }
    });
    assert.equal(res.status, 403);
    assert.match(res.body.error, /Forbidden: Invalid Host header/);
  });

  test('allows requests with valid localhost Host header', async () => {
    const res = await sendHttpRequest({
      headers: {
        'x-banana-auth': TEST_SECRET,
        Host: `localhost:${testPort}`
      }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'healthy');
  });
});
