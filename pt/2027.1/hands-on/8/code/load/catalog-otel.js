import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost'; // the edge (lab 3)

export const options = {
  scenarios: {
    catalog: {
      executor: 'constant-arrival-rate', // open model: the arrival rate does not depend on latency
      rate: Number(__ENV.RATE || 200),
      timeUnit: '1s',
      duration: __ENV.DURATION || '2m',
      preAllocatedVUs: 50,
      maxVUs: 400,
    },
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const id = 1 + Math.floor(Math.random() * 200000);
  const res = http.get(`${BASE_URL}/catalog/events/${id}`, { tags: { name: 'GET /catalog/events/{id}' } });
  check(res, { 'status 200': (r) => r.status === 200 });
}
