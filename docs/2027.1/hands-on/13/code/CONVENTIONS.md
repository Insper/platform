# BoxOffice conventions

Read by humans and by the AI reviewer. Keep it short: every line costs tokens on every review.

## Architecture rules (blocker if violated)
- One PostgreSQL schema per service (`catalog`, `inventory`, `orders`, `payment`, ...).
  A service reads and writes ONLY its own schema. Another service's data is reached
  through its HTTP API or its events, never with SQL.
- Seat state (holds, sales) is owned by `inventory`. Any change to a seat goes through
  inventory, inside a transaction that locks the row (`SELECT ... FOR UPDATE`) or uses
  optimistic locking. Double booking is the worst bug this system can have.
- `order` publishes events through the transactional outbox, never directly to Kafka
  inside a database transaction.
- Every outbound HTTP call (service-to-service or to the payment provider) has a connect
  and a read timeout, and calls to `payment` are idempotent (Idempotency-Key header).
- Services trust identity only from the `X-User-*` headers set by the gateway.

## Code
- Java 21, Spring Boot 4.1, Spring Cloud 2025.1; DTOs are `record`s; no Lombok.
- Money is `long` cents or `BigDecimal`, never `double`.
- SQL uses bind parameters; never build SQL by string concatenation.
- No secrets in code or in application.yaml: read them from environment variables.
- Errors are RFC 9457 problem+json; `POST` that creates returns 201 with `Location`.
- Flyway migrations are append-only: never edit a migration that was merged.

## Tests
- Business rules in `inventory`, `order` and `payment` need unit tests for the error paths.
- No `Thread.sleep` in tests; inject a `Clock` for time.
