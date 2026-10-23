import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8084';
const RUN = __ENV.RUN || `${Date.now()}`;

export const options = {
  scenarios: {
    orders: {
      executor: 'constant-arrival-rate', // open model: arrivals do not wait for responses
      rate: Number(__ENV.RATE || 50),
      timeUnit: '1s',
      duration: __ENV.DURATION || '60s',
      preAllocatedVUs: 50,
      maxVUs: 500,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<200'],
  },
};

export default function () {
  const n = exec.scenario.iterationInTest;
  const body = JSON.stringify({
    showId: 'show-7', // no waiting room open for this show
    holdId: `hold-${RUN}-${n}`, // unique per request: every request is a new order
    customerEmail: `fan${n}@example.com`,
    amount: 350.0,
  });
  const res = http.post(`${BASE_URL}/orders`, body, {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, { 'order created': (r) => r.status === 201 });
}
