// Lab 2: load test with an OPEN workload model. k6 starts RATE new requests per second,
// whether or not the previous ones have finished, like real fans arriving at a website.
//   k6 run -e RATE=100 -e DURATION=1m load/load.js
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8082';
const RATE = Number(__ENV.RATE || 50);              // requests (iterations) per second
const DURATION = __ENV.DURATION || '1m';
const LIST_SHARE = Number(__ENV.LIST_SHARE || 0.2); // 20% listings, 80% event details
const CITIES = ['São Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Porto Alegre', 'Curitiba',
  'Salvador', 'Recife', 'Fortaleza', 'Brasília', 'Manaus'];

export const options = {
  scenarios: {
    open: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: Math.max(20, RATE),   // VUs ready to start requests
      maxVUs: Math.max(200, RATE * 10),      // k6 may add more if requests get slow
    },
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:detail}': ['p(99)<500'],
    'http_req_duration{name:list}': ['p(99)<1000'],
  },
};

export default function () {
  if (Math.random() < LIST_SHARE) {
    const city = CITIES[Math.floor(Math.random() * CITIES.length)];
    const page = Math.floor(Math.random() * 5);
    const res = http.get(`${BASE_URL}/catalog/events?city=${encodeURIComponent(city)}&page=${page}`,
      { tags: { name: 'list' } });
    check(res, { 'list is 200': (r) => r.status === 200 });
  } else {
    const id = 1 + Math.floor(Math.random() * 200000);
    const res = http.get(`${BASE_URL}/catalog/events/${id}`, { tags: { name: 'detail' } });
    check(res, { 'detail is 200': (r) => r.status === 200 });
  }
}
