// Lab 4: how many logins per second can auth take? BCrypt is slow on purpose.
//   k6 run -e RATE=20 load/login.js
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost';
const RATE = Number(__ENV.RATE || 20);
const json = { headers: { 'Content-Type': 'application/json' } };

export const options = {
  scenarios: {
    logins: {
      executor: 'constant-arrival-rate', rate: RATE, timeUnit: '1s', duration: '30s',
      preAllocatedVUs: 20, maxVUs: 300,
    },
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  thresholds: { http_req_failed: ['rate<0.01'], 'http_req_duration{name:login}': ['p(99)<1000'] },
};

export function setup() {
  const email = `login-${Date.now()}@boxoffice.dev`;
  http.post(`${BASE_URL}/auth/register`, JSON.stringify({ name: 'Login Fan', email, password: 'secret-123' }), json);
  return { email };
}

export default function (data) {
  const res = http.post(`${BASE_URL}/auth/login`,
    JSON.stringify({ email: data.email, password: 'secret-123' }), { ...json, tags: { name: 'login' } });
  check(res, { 'login is 200': (r) => r.status === 200 });
}
