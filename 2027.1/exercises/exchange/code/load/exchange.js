// Exercise 8: what does the exchange cache buy? GET /exchange/{from}/{to} through the edge, with a token.
// The exchange service publishes no port, so k6 runs inside the compose network:
//   docker run --rm -i --network boxoffice_default -v "$PWD":/w -w /w grafana/k6 run -e RATE=100 load/exchange.js
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const EDGE = __ENV.BASE_URL || 'http://edge';
const RATE = Number(__ENV.RATE || 100);
const DURATION = __ENV.DURATION || '2m';
const PAIRS = ['USD/BRL', 'EUR/BRL', 'USD/EUR', 'GBP/USD', 'JPY/BRL'];

// one count per response, tagged with the X-Cache header: hit, miss, stale (or none on an error)
const cache = new Counter('exchange_cache');

export const options = {
  scenarios: {
    rates: {
      executor: 'constant-arrival-rate', rate: RATE, timeUnit: '1s', duration: DURATION,
      preAllocatedVUs: 50, maxVUs: 500,
    },
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    // always true: they only make k6 print one line per tag in the summary
    'exchange_cache{result:hit}': ['count>=0'],
    'exchange_cache{result:miss}': ['count>=0'],
    'exchange_cache{result:stale}': ['count>=0'],
    'exchange_cache{result:none}': ['count>=0'],
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

export default function (data) {
  const pair = PAIRS[Math.floor(Math.random() * PAIRS.length)];
  const res = http.get(`${EDGE}/exchange/${pair}`, { headers: { Authorization: `Bearer ${data.token}` } });
  check(res, { 'rate is 200': (r) => r.status === 200 });
  cache.add(1, { result: res.headers['X-Cache'] || 'none' });
}
