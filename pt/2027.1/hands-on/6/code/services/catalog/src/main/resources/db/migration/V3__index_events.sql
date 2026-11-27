-- Lab 6: indexes for the listing "upcoming events in a city, soonest first".
-- Walk events in starts_at order and stop after one page, instead of sorting 20,000 rows:
CREATE INDEX events_starts_at_idx ON catalog.events (starts_at, id);
-- Count/filter the events of a city's venues without reading the whole table:
CREATE INDEX events_venue_starts_at_idx ON catalog.events (venue_id, starts_at);
CREATE INDEX venues_city_idx ON catalog.venues (city);
