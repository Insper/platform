// Lab 0: how fast is *your* machine? The target is a plain Nginx container.
//   docker run -d --rm --name hello -p 8888:80 nginx:1.30-alpine
//   k6 run -e VUS=10 load/hello.js
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8888';

export const options = {
  vus: Number(__ENV.VUS || 10),          // closed model: N users, no think time
  duration: __ENV.DURATION || '20s',
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    http_req_failed: ['rate<0.01'],      // fewer than 1% errors
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/`);
  check(res, { 'status is 200': (r) => r.status === 200 });
}
