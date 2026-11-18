// Lab 4: what do the edge, the gateway and the token check cost? The same request,
// GET /catalog/events/{id}, at the same arrival rate along four paths:
//   service   straight to one catalog replica              (no edge, no gateway)
//   direct    to the gateway port                          (gateway → catalog)
//   open      through the edge                             (edge → gateway → catalog)
//   jwt       through the edge with a valid token          (the gateway also validates the JWT)
// Catalog replicas publish no port, so k6 runs inside the compose network (see the lab page):
//   docker run --rm -i --network boxoffice_default -v "$PWD":/w -w /w grafana/k6 run -e RATE=50 load/gateway.js
import http from 'k6/http';
import { check } from 'k6';

const EDGE = __ENV.BASE_URL || 'http://edge';
const GATEWAY = __ENV.GATEWAY_URL || 'http://gateway:8080';
const SERVICE = __ENV.SERVICE_URL || 'http://catalog-1:8082';
const RATE = Number(__ENV.RATE || 50);

const scenario = (exec) => ({
  executor: 'constant-arrival-rate', exec, rate: RATE, timeUnit: '1s', duration: '1m',
  preAllocatedVUs: 50, maxVUs: 500,
});

export const options = {
  scenarios: { service: scenario('service'), direct: scenario('direct'), open: scenario('open'), jwt: scenario('jwt') },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    'http_req_duration{scenario:service}': ['p(99)<500'],
    'http_req_duration{scenario:direct}': ['p(99)<500'],
    'http_req_duration{scenario:open}': ['p(99)<500'],
    'http_req_duration{scenario:jwt}': ['p(99)<500'],
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
const event = (base) => `${base}/catalog/events/${randomId()}`;

export function service() {
  check(http.get(event(SERVICE)), { 'service is 200': (r) => r.status === 200 });
}

export function direct() {
  check(http.get(event(GATEWAY)), { 'direct is 200': (r) => r.status === 200 });
}

export function open() {
  check(http.get(event(EDGE)), { 'open is 200': (r) => r.status === 200 });
}

// an open route, but a request that carries a token gets it validated (a bad one is rejected with 401)
export function jwt(data) {
  const res = http.get(event(EDGE), { headers: { Authorization: `Bearer ${data.token}` } });
  check(res, { 'jwt is 200': (r) => r.status === 200 });
}
