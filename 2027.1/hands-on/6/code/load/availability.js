// Lab 6: read traffic on the seat map during the sale. These GETs are readOnly
// transactions, so they run on the replica (or on the primary, if you point
// DB_REPLICA_HOST at it to compare).
//   k6 run -e RATE=200 load/availability.js
import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL } from './lib.js';

const RATE = Number(__ENV.RATE || 200);

export const options = {
  scenarios: {
    readers: {
      executor: 'constant-arrival-rate', rate: RATE, timeUnit: '1s', duration: __ENV.DURATION || '1m',
      preAllocatedVUs: Math.max(20, RATE), maxVUs: Math.max(200, RATE * 10),
    },
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:availability}': ['p(99)<1000'],
    'http_req_duration{name:section}': ['p(99)<1000'],
  },
};

export default function () {
  if (Math.random() < 0.5) {
    const res = http.get(`${BASE_URL}/inventory/events/1/availability`, { tags: { name: 'availability' } });
    check(res, { 'availability is 200': (r) => r.status === 200 });
  } else {
    const section = `S${String(1 + Math.floor(Math.random() * 30)).padStart(2, '0')}`;
    const res = http.get(`${BASE_URL}/inventory/events/1/seats?section=${section}`, { tags: { name: 'section' } });
    check(res, { 'section is 200': (r) => r.status === 200 });
  }
}
