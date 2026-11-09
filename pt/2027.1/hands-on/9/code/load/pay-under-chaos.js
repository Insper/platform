import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8084'; // order directly: isolate the service
const RUN = __ENV.RUN || `${Date.now()}`;
const DURATION = __ENV.DURATION || '2m';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const fastFail = new Rate('pay_fast_fail'); // share of payments answered 503 by the fallback

export const options = {
  scenarios: {
    pay: {
      executor: 'constant-arrival-rate',
      exec: 'pay',
      rate: Number(__ENV.PAY_RATE || 20),
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 50,
      maxVUs: 600,
    },
    browse: {
      executor: 'constant-arrival-rate',
      exec: 'browse',
      rate: 20,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 20,
      maxVUs: 300,
    },
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    'http_req_duration{name:pay}': ['p(95)<1500'],
    'http_req_duration{name:browse}': ['p(95)<200'], // the collateral damage
    'http_req_failed{name:browse}': ['rate<0.01'],
  },
};

export function setup() {
  const ids = [];
  for (let i = 0; i < 20; i++) {
    const res = http.post(`${BASE_URL}/orders`,
      JSON.stringify({ showId: 'show-9', holdId: `browse-${RUN}-${i}`, customerEmail: `b${i}@example.com`, amount: 100.0 }),
      { headers: JSON_HEADERS });
    ids.push(res.json('id'));
  }
  return { ids };
}

export function pay() {
  const n = exec.scenario.iterationInTest;
  const placed = http.post(`${BASE_URL}/orders`,
    JSON.stringify({ showId: 'show-9', holdId: `pay-${RUN}-${n}`, customerEmail: `fan${n}@example.com`, amount: 350.0 }),
    { headers: JSON_HEADERS, tags: { name: 'place' } });
  if (placed.status !== 201) {
    return;
  }
  const res = http.post(`${BASE_URL}/orders/${placed.json('id')}/pay`, null, { tags: { name: 'pay' } });
  fastFail.add(res.status === 503);
  check(res, { 'paid and confirmed': (r) => r.status === 200 && r.json('status') === 'CONFIRMED' });
}

export function browse(data) {
  const id = data.ids[exec.scenario.iterationInTest % data.ids.length];
  const res = http.get(`${BASE_URL}/orders/${id}`, { tags: { name: 'browse' } });
  check(res, { 'order read': (r) => r.status === 200 });
}
