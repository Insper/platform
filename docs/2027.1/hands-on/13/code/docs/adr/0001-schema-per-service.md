# ADR 0001 — One database schema per service

- Status: accepted
- Date: 2027-02-15

## Context
All BoxOffice services share one PostgreSQL instance (`db`, database `boxoffice`). Nothing in
PostgreSQL stops `order` from reading or updating `inventory.seats` directly, and a shortcut like
that would couple the two services' release cycles and bypass inventory's locking rules.

## Decision
Each service owns one schema (`catalog`, `inventory`, `orders`, `payment`, `notification`, `auth`)
and its Flyway migrations. A service reads and writes ONLY its own schema. Data owned by another
service is reached through that service's HTTP API or its events.

## Consequences
- A query across services becomes an API call or a read model built from events (slower, explicit).
- Each schema can move to its own database later without changing other services.
- Reviewers (human and AI) treat SQL that names another service's schema as a blocker.
