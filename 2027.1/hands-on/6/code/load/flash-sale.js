// Lab 6: the 10:00 flash sale. 200 fans fight for the first 100 seats of section S01
// of event 1. Each fan tries to hold 2 seats; some change their mind and release.
// Run it once per locking strategy (INVENTORY_LOCKING) and compare.
//   bash scripts/reset-inventory.sh && k6 run load/flash-sale.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE_URL, loginFans, authHeaders } from './lib.js';

// a 409 (seat taken) is an expected answer in a flash sale, not a failure
http.setResponseCallback(http.expectedStatuses(200, 201, 204, 409));

const held = new Counter('holds_created');
const conflicts = new Counter('holds_conflict');

export const options = {
  scenarios: {
    fans: { executor: 'constant-vus', vus: Number(__ENV.VUS || 200), duration: __ENV.DURATION || '30s' },
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    'http_req_duration{name:hold}': ['p(95)<1000'],
    http_req_failed: ['rate<0.01'],
    holds_created: ['count>0'],
    holds_conflict: ['count>=0'],
  },
};

export function setup() {
  const tokens = loginFans(50);
  const seats = http.get(`${BASE_URL}/inventory/events/1/seats?section=S01`).json();
  return { tokens, seatIds: seats.slice(0, 100).map((s) => s.id) };   // rows 1-2: the best seats
}

export default function (data) {
  const token = data.tokens[__VU % data.tokens.length];
  const i = Math.floor(Math.random() * (data.seatIds.length - 1));
  const body = JSON.stringify({ eventId: 1, seatIds: [data.seatIds[i], data.seatIds[i + 1]] });

  const res = http.post(`${BASE_URL}/inventory/holds`, body, { ...authHeaders(token), tags: { name: 'hold' } });
  check(res, { 'hold answered 201 or 409': (r) => r.status === 201 || r.status === 409 });
  if (res.status === 201) {
    held.add(1);
    sleep(0.5);
    if (Math.random() < 0.7) {                       // 70% give up: the seats go back on sale
      http.del(`${BASE_URL}/inventory/holds/${res.json('id')}`, null, { ...authHeaders(token), tags: { name: 'release' } });
    }
  } else if (res.status === 409) {
    conflicts.add(1);
    sleep(0.2);
  }
}

// after the test: the invariant. Anything other than 0 is a double booking.
export function teardown(data) {
  const audit = http.get(`${BASE_URL}/inventory/audit/double-bookings`, authHeaders(data.tokens[0]));
  console.log(`AUDIT double-booked seats: ${audit.json('doubleBookedSeats')}`);
}
