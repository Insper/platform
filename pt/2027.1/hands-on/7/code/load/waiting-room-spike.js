import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8084';
const SHOW = __ENV.SHOW || 'show-42';
const RUN = __ENV.RUN || `${Date.now()}`;
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const waitTime = new Trend('wr_wait_seconds');
const etaError = new Trend('wr_eta_error_seconds');
const admitted = new Counter('wr_admitted');
const gaveUp = new Counter('wr_gave_up');

export const options = {
  scenarios: {
    fans: {
      executor: 'ramping-arrival-rate',
      exec: 'fan',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: 200,
      maxVUs: 1500,
      stages: [
        { target: 20, duration: '5s' },  // the on-sale opens
        { target: 20, duration: '30s' }, // 20 new fans per second
        { target: 0, duration: '5s' },
      ],
      gracefulStop: '120s', // let the last fans in the queue finish
    },
    bots: {
      executor: 'constant-arrival-rate',
      exec: 'bot',
      rate: 5,
      timeUnit: '1s',
      duration: '40s',
      preAllocatedVUs: 5,
    },
  },
  thresholds: {
    'http_req_duration{name:order}': ['p(95)<300'],
    'checks{name:order}': ['rate>0.99'],
    'checks{name:bot}': ['rate==1'],
  },
};

export function setup() {
  http.post(`${BASE_URL}/orders/waiting-room/${SHOW}/open`);
}

export function fan() {
  const t0 = Date.now();
  let ticket = http.post(`${BASE_URL}/orders/waiting-room/${SHOW}/join`, null, { tags: { name: 'join' } }).json();
  const promisedEta = ticket.etaSeconds;
  for (let i = 0; i < 300 && ticket.status === 'WAITING'; i++) {
    sleep(1);
    ticket = http
      .get(`${BASE_URL}/orders/waiting-room/${SHOW}/tickets/${ticket.ticketId}`, { tags: { name: 'poll' } })
      .json();
  }
  if (ticket.status !== 'ADMITTED') {
    gaveUp.add(1);
    return;
  }
  const waited = (Date.now() - t0) / 1000;
  waitTime.add(waited);
  etaError.add(waited - promisedEta);
  admitted.add(1);

  const n = exec.scenario.iterationInTest;
  const res = http.post(
    `${BASE_URL}/orders`,
    JSON.stringify({ showId: SHOW, holdId: `wr-${RUN}-${n}`, customerEmail: `fan${n}@example.com`, amount: 350.0 }),
    { headers: { ...JSON_HEADERS, 'X-Admission-Ticket': ticket.ticketId }, tags: { name: 'order' } },
  );
  check(res, { 'admitted fan orders': (r) => r.status === 201 }, { name: 'order' });
}

export function bot() {
  const n = exec.scenario.iterationInTest;
  const res = http.post(
    `${BASE_URL}/orders`,
    JSON.stringify({ showId: SHOW, holdId: `bot-${RUN}-${n}`, customerEmail: `bot${n}@example.com`, amount: 350.0 }),
    { headers: JSON_HEADERS, tags: { name: 'bot' }, responseCallback: http.expectedStatuses(403) },
  );
  check(res, { 'queue jumper refused': (r) => r.status === 403 }, { name: 'bot' });
}

export function teardown() {
  http.post(`${BASE_URL}/orders/waiting-room/${SHOW}/close`);
}
