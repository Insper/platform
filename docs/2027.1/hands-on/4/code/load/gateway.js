// Lab 4: what does the gateway cost? Three request types at the same arrival rate:
//   open       GET /catalog/events/{id}  (no token)
//   protected  GET /auth/me              (JWT validated by the gateway)
//   direct     GET /catalog/events/{id}  straight to the gateway port, skipping the edge
//   k6 run -e RATE=50 load/gateway.js      (3 scenarios: 150 req/s in total)
import http from 'k6/http';
import { check } from 'k6';

const EDGE = __ENV.BASE_URL || 'http://localhost';
const GATEWAY = __ENV.GATEWAY_URL || 'http://localhost:8080';
const RATE = Number(__ENV.RATE || 50);

const scenario = (exec) => ({
  executor: 'constant-arrival-rate', exec, rate: RATE, timeUnit: '1s', duration: '1m',
  preAllocatedVUs: 50, maxVUs: 500,
});

export const options = {
  scenarios: { open: scenario('open'), protected: scenario('protectedRoute'), direct: scenario('direct') },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    'http_req_duration{scenario:open}': ['p(99)<500'],
    'http_req_duration{scenario:protected}': ['p(99)<500'],
    'http_req_duration{scenario:direct}': ['p(99)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

// runs once: register a fan and log in; every VU reuses the token
export function setup() {
  const email = `fan-${Date.now()}@boxoffice.dev`;
  const json = { headers: { 'Content-Type': 'application/json' } };
  http.post(`${EDGE}/auth/register`, JSON.stringify({ name: 'Load Fan', email, password: 'secret-123' }), json);
  const login = http.post(`${EDGE}/auth/login`, JSON.stringify({ email, password: 'secret-123' }), json);
  check(login, { 'login is 200': (r) => r.status === 200 });
  return { token: login.json('accessToken') };
}

const randomId = () => 1 + Math.floor(Math.random() * 200000);

export function open() {
  const res = http.get(`${EDGE}/catalog/events/${randomId()}`);
  check(res, { 'open is 200': (r) => r.status === 200 });
}

export function protectedRoute(data) {
  const res = http.get(`${EDGE}/auth/me`, { headers: { Authorization: `Bearer ${data.token}` } });
  check(res, { 'protected is 200': (r) => r.status === 200 });
}

export function direct() {
  const res = http.get(`${GATEWAY}/catalog/events/${randomId()}`);
  check(res, { 'direct is 200': (r) => r.status === 200 });
}
