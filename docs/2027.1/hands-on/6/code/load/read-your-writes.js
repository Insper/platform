// Lab 6: hold a seat, then immediately look at the seat map (served by the replica).
// Does the fan see their own seat as HELD? With replication lag, sometimes not.
//   REPLICA_DELAY=1s docker compose up -d db-replica   (artificial lag)
//   bash scripts/reset-inventory.sh && k6 run load/read-your-writes.js
import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';
import { BASE_URL, loginFans, authHeaders } from './lib.js';

http.setResponseCallback(http.expectedStatuses(200, 201, 204, 409));

const stale = new Rate('stale_reads');

export const options = {
  vus: 10,
  iterations: 200,
  thresholds: { stale_reads: ['rate>=0'] },
};

export function setup() {
  const seats = http.get(`${BASE_URL}/inventory/events/2/seats?section=S01`).json();
  return { tokens: loginFans(10), seatIds: seats.map((s) => s.id) };
}

export default function (data) {
  const token = data.tokens[__VU % data.tokens.length];
  const seatId = data.seatIds[Math.floor(Math.random() * data.seatIds.length)];
  const hold = http.post(`${BASE_URL}/inventory/holds`, JSON.stringify({ eventId: 2, seatIds: [seatId] }), authHeaders(token));
  if (hold.status !== 201) {
    return;                                          // seat already taken: try another one
  }
  // read-after-write: the seat map comes from the replica
  const map = http.get(`${BASE_URL}/inventory/events/2/seats?section=S01`).json();
  const seat = map.find((s) => s.id === seatId);
  stale.add(seat.status !== 'HELD');
  check(seat, { 'my seat shows as HELD': (s) => s.status === 'HELD' });
  // and from the primary (GET /holds/{id} is not readOnly): always up to date
  const mine = http.get(`${BASE_URL}/inventory/holds/${hold.json('id')}`, authHeaders(token));
  check(mine, { 'my hold is visible on the primary': (r) => r.status === 200 });
  http.del(`${BASE_URL}/inventory/holds/${hold.json('id')}`, null, authHeaders(token));
}
