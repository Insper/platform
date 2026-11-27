// Lab 5: cache stampede. 200 fans refresh the SAME expensive page non-stop.
// Every time its key expires, how many requests go to the database at once?
//   CACHE_TTL_LIST=3s docker compose up -d      (short TTL: many expirations per minute)
//   k6 run load/stampede.js
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost';
const misses = new Counter('cache_misses');          // each MISS = one heavy query in the DB

export const options = {
  vus: Number(__ENV.VUS || 200),
  duration: __ENV.DURATION || '1m',
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    cache_misses: ['count>=0'],                       // printed in the summary
    http_req_failed: ['rate<0.01'],
  },
};

const HOME = `${BASE_URL}/catalog/events?city=${encodeURIComponent('São Paulo')}&page=0`;

export default function () {
  const res = http.get(HOME, { tags: { name: 'home' } });
  check(res, { 'home is 200': (r) => r.status === 200 });
  if (res.headers['X-Cache'] !== 'HIT') {
    misses.add(1);
  }
}
