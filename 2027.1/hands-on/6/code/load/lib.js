// Shared helpers for the lab 6 scripts: create fans and log them in.
import http from 'k6/http';
import { check } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost';
const json = { headers: { 'Content-Type': 'application/json' } };

/** Registers `count` fans and returns one JWT per fan (runs in setup(); BCrypt makes it take a few seconds). */
export function loginFans(count) {
  const run = Date.now();
  const tokens = [];
  for (let i = 0; i < count; i++) {
    const email = `fan-${run}-${i}@boxoffice.dev`;
    http.post(`${BASE_URL}/auth/register`, JSON.stringify({ name: `Fan ${i}`, email, password: 'secret-123' }), json);
    const res = http.post(`${BASE_URL}/auth/login`, JSON.stringify({ email, password: 'secret-123' }), json);
    check(res, { 'login is 200': (r) => r.status === 200 });
    tokens.push(res.json('accessToken'));
  }
  return tokens;
}

export function authHeaders(token) {
  return { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };
}
