import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost'; // the Ingress
const PEAK = Number(__ENV.PEAK || 300);

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate', // open model: arrivals keep coming even if pods are slow
      startRate: 20,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: 1000,
      stages: [
        { target: PEAK, duration: '3m' }, // ramp up: watch the HPA react
        { target: PEAK, duration: '4m' }, // hold: does the latency come back down?
        { target: 20, duration: '1m' },   // ramp down
        { target: 20, duration: '3m' },   // quiet: watch the scale-down stabilization
      ],
    },
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

export default function () {
  const id = 1 + Math.floor(Math.random() * 200000);
  const res = http.get(`${BASE_URL}/catalog/events/${id}`, { tags: { name: 'GET /catalog/events/{id}' } });
  check(res, { 'status 200': (r) => r.status === 200 });
}
