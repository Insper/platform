// Lab 2: stress test. Climb a staircase of arrival rates past the knee, then come back
// down: does the service recover by itself when the load drops?
//   k6 run -e PEAK=600 load/stress.js
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8082';
const PEAK = Number(__ENV.PEAK || 600);             // highest arrival rate (req/s)
const LIST_SHARE = Number(__ENV.LIST_SHARE || 0.2);
const CITIES = ['São Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Porto Alegre', 'Curitiba',
  'Salvador', 'Recife', 'Fortaleza', 'Brasília', 'Manaus'];

const step = (fraction, duration) => ({ target: Math.round(PEAK * fraction), duration });

export const options = {
  scenarios: {
    staircase: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 2000,
      stages: [
        step(0.25, '30s'), step(0.25, '30s'),   // warm-up and 1/4 of the peak
        step(0.50, '30s'), step(0.50, '30s'),
        step(0.75, '30s'), step(0.75, '30s'),
        step(1.00, '30s'), step(1.00, '1m'),    // peak, held longer
        step(0.25, '15s'), step(0.25, '1m'),    // back down: recovery?
      ],
    },
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    http_req_failed: ['rate<0.05'],
    // a breakpoint test would abort here: { threshold: 'p(99)<2000', abortOnFail: true }
    http_req_duration: ['p(99)<2000'],
  },
};

export default function () {
  if (Math.random() < LIST_SHARE) {
    const city = CITIES[Math.floor(Math.random() * CITIES.length)];
    const res = http.get(`${BASE_URL}/catalog/events?city=${encodeURIComponent(city)}`,
      { tags: { name: 'list' }, timeout: '10s' });
    check(res, { 'list is 200': (r) => r.status === 200 });
  } else {
    const id = 1 + Math.floor(Math.random() * 200000);
    const res = http.get(`${BASE_URL}/catalog/events/${id}`, { tags: { name: 'detail' }, timeout: '10s' });
    check(res, { 'detail is 200': (r) => r.status === 200 });
  }
}
