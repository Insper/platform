// Lab 1: smoke test. One user, 30 seconds: does every endpoint answer, and how fast
// when the service is NOT under load?   k6 run load/smoke.js
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8082';
const CITIES = ['São Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Porto Alegre', 'Curitiba',
  'Salvador', 'Recife', 'Fortaleza', 'Brasília', 'Manaus'];

export const options = {
  vus: 1,
  duration: '30s',
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    http_req_failed: ['rate==0'],
    // one threshold per endpoint makes k6 print one latency line per endpoint
    'http_req_duration{name:GET /catalog/events/{id}}': ['p(95)<200'],
    'http_req_duration{name:GET /catalog/events?city}': ['p(95)<500'],
  },
};

export default function () {
  const id = 1 + Math.floor(Math.random() * 200000);
  const detail = http.get(`${BASE_URL}/catalog/events/${id}`,
    { tags: { name: 'GET /catalog/events/{id}' } });
  check(detail, { 'detail is 200': (r) => r.status === 200 });

  const city = CITIES[Math.floor(Math.random() * CITIES.length)];
  const list = http.get(`${BASE_URL}/catalog/events?city=${encodeURIComponent(city)}&page=0&size=20`,
    { tags: { name: 'GET /catalog/events?city' } });
  check(list, {
    'list is 200': (r) => r.status === 200,
    'list has 20 items': (r) => r.json('items').length === 20,
  });

  sleep(0.5);   // think time: a real user does not click non-stop
}
