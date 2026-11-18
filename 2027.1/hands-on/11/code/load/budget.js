// Lab 11: performance budget of catalog, run by CI on every push and pull request.
// A crossed threshold makes k6 exit with code 99, which fails the "performance budget" job.
//   k6 run load/budget.js            (BASE_URL defaults to http://localhost:8082)
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8082';

export const options = {
  scenarios: {
    warmup: { // JIT, connection pools and cache: not measured
      executor: 'constant-arrival-rate',
      rate: 20,
      timeUnit: '1s',
      duration: '20s',
      preAllocatedVUs: 20,
    },
    budget: { // the measured part: an open-model load the service must sustain
      executor: 'constant-arrival-rate',
      startTime: '20s',
      rate: Number(__ENV.RATE || 50),
      timeUnit: '1s',
      duration: '40s',
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    'http_req_duration{scenario:budget}': ['p(95)<300', 'p(99)<800'],
    'http_req_failed{scenario:budget}': ['rate<0.01'],
    'checks{scenario:budget}': ['rate>0.99'],
  },
};

export default function () {
  const id = 1 + Math.floor(Math.random() * 200000);
  const res = http.get(`${BASE_URL}/catalog/events/${id}`, { tags: { name: 'GET /catalog/events/{id}' } });
  check(res, { 'status 200': (r) => r.status === 200 });
}
