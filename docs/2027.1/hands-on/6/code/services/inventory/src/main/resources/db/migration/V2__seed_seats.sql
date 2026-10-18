-- Event 1 (the flash sale): 30 sections x 40 rows x 50 seats = 60,000 seats.
INSERT INTO inventory.seats (event_id, section, seat_row, seat_number, price)
SELECT 1, 'S' || lpad(s::text, 2, '0'), r, n, 250 + (s % 5) * 100
FROM generate_series(1, 30) AS s, generate_series(1, 40) AS r, generate_series(1, 50) AS n
ORDER BY s, r, n;

-- Events 2..100: 5 sections x 10 rows x 10 seats = 500 seats each.
INSERT INTO inventory.seats (event_id, section, seat_row, seat_number, price)
SELECT e, 'S' || lpad(s::text, 2, '0'), r, n, 80 + s * 20
FROM generate_series(2, 100) AS e, generate_series(1, 5) AS s,
     generate_series(1, 10) AS r, generate_series(1, 10) AS n
ORDER BY e, s, r, n;

ANALYZE inventory.seats;
