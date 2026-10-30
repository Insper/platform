// Lab 3: two API clients share the edge. "greedy" sends 50 req/s, "polite" 10 req/s;
// the edge allows 20 req/s per X-Api-Key (burst 40). Who gets 429?
//   k6 run load/ratelimit.js
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost';

export const options = {
  scenarios: {
    greedy: {
      executor: 'constant-arrival-rate', rate: 50, timeUnit: '1s', duration: '30s',
      preAllocatedVUs: 20, env: { API_KEY: 'partner-greedy' },
    },
    polite: {
      executor: 'constant-arrival-rate', rate: 10, timeUnit: '1s', duration: '30s',
      preAllocatedVUs: 10, env: { API_KEY: 'partner-polite' },
    },
  },
  thresholds: {
    // listed only so that k6 prints one line per scenario and status
    'http_reqs{scenario:greedy,status:200}': ['count>=0'],
    'http_reqs{scenario:greedy,status:429}': ['count>=0'],
    'http_reqs{scenario:polite,status:200}': ['count>=0'],
    'http_reqs{scenario:polite,status:429}': ['count>=0'],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/catalog/events/1`, { headers: { 'X-Api-Key': __ENV.API_KEY } });
  check(res, { 'answered 200 or 429': (r) => r.status === 200 || r.status === 429 });
}
