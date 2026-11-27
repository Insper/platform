-- Demo data: 10 cities x 5 venues, and 200,000 events (one per hour from March 2027).
-- generate_series makes the seed deterministic and fast (a few seconds).
INSERT INTO catalog.venues (name, city, capacity)
SELECT v.kind || ' ' || c.city,
       c.city,
       CASE v.kind WHEN 'Stadium' THEN 60000 WHEN 'Arena' THEN 15000 WHEN 'Hall' THEN 4000
                   WHEN 'Theater' THEN 1200 ELSE 300 END
FROM (VALUES (1, 'São Paulo'), (2, 'Rio de Janeiro'), (3, 'Belo Horizonte'), (4, 'Porto Alegre'),
             (5, 'Curitiba'), (6, 'Salvador'), (7, 'Recife'), (8, 'Fortaleza'), (9, 'Brasília'),
             (10, 'Manaus')) AS c(n, city)
CROSS JOIN (VALUES (1, 'Stadium'), (2, 'Arena'), (3, 'Hall'), (4, 'Theater'), (5, 'Club')) AS v(n, kind)
ORDER BY c.n, v.n;

-- event 1 is the flash-sale show of the course: 60,000 seats at Stadium São Paulo (venue 1)
INSERT INTO catalog.events (title, category, venue_id, starts_at, price_from)
VALUES ('BoxOffice Fest — Stadium Night', 'FESTIVAL', 1, TIMESTAMPTZ '2027-06-12 20:00:00-03', 250.00);

INSERT INTO catalog.events (title, category, venue_id, starts_at, price_from)
SELECT (ARRAY['Concert', 'Match', 'Festival', 'Play'])[1 + g % 4] || ' #' || g,
       (ARRAY['CONCERT', 'SPORTS', 'FESTIVAL', 'THEATER'])[1 + g % 4],
       1 + (g * 7) % 50,
       TIMESTAMPTZ '2027-03-01 20:00:00-03' + g * INTERVAL '1 hour',
       50 + (g % 20) * 25
FROM generate_series(2, 200000) AS g;

ANALYZE catalog.venues;
ANALYZE catalog.events;
