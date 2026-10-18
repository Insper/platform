// Lab 5: a realistic read mix with POPULAR events. 80% of the detail requests go to the
// 2,000 hottest events (1% of the catalog), like a real box office the week of a big show.
//   k6 run -e RATE=300 load/cache.js
import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost';
const RATE = Number(__ENV.RATE || 300);
const DURATION = __ENV.DURATION || '1m';
const HOT_SHARE = Number(__ENV.HOT_SHARE || 0.8);
const CITIES = ['São Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Porto Alegre', 'Curitiba',
  'Salvador', 'Recife', 'Fortaleza', 'Brasília', 'Manaus'];

const cacheHit = new Rate('cache_hit');               // share of responses with X-Cache: HIT
const latencyHit = new Trend('latency_hit', true);    // latency of hits only
const latencyMiss = new Trend('latency_miss', true);  // latency of misses (and bypasses)

export const options = {
  scenarios: {
    open: {
      executor: 'constant-arrival-rate', rate: RATE, timeUnit: '1s', duration: DURATION,
      preAllocatedVUs: Math.max(20, RATE), maxVUs: Math.max(200, RATE * 10),
    },
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:detail}': ['p(99)<500'],
    'http_req_duration{name:list}': ['p(99)<1000'],
    cache_hit: ['rate>=0'],                              // printed in the summary
  },
};

function record(res) {
  const outcome = res.headers['X-Cache'];
  cacheHit.add(outcome === 'HIT');
  (outcome === 'HIT' ? latencyHit : latencyMiss).add(res.timings.duration);
}

export default function () {
  if (Math.random() < 0.2) {
    const city = CITIES[Math.floor(Math.random() * CITIES.length)];
    const page = Math.floor(Math.random() * 3);              // people rarely go past page 3
    const res = http.get(`${BASE_URL}/catalog/events?city=${encodeURIComponent(city)}&page=${page}`,
      { tags: { name: 'list' } });
    check(res, { 'list is 200': (r) => r.status === 200 });
    record(res);
  } else {
    const hot = Math.random() < HOT_SHARE;
    const id = 1 + Math.floor(Math.random() * (hot ? 2000 : 200000));
    const res = http.get(`${BASE_URL}/catalog/events/${id}`, { tags: { name: 'detail' } });
    check(res, { 'detail is 200': (r) => r.status === 200 });
    record(res);
  }
}
