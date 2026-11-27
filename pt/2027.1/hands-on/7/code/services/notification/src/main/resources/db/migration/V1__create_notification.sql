-- one row per event already handled: the idempotency memory of this consumer
CREATE TABLE processed_events (
    event_id     UUID        PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- one row per e-mail actually sent (no unique constraint: we want to SEE duplicates)
CREATE TABLE notifications (
    id          BIGSERIAL    PRIMARY KEY,
    event_id    UUID         NOT NULL,
    order_id    UUID         NOT NULL,
    email       VARCHAR(320) NOT NULL,
    kind        VARCHAR(50)  NOT NULL,
    occurred_at TIMESTAMPTZ  NOT NULL,
    sent_at     TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp()
);

-- poison messages, kept for inspection and replay
CREATE TABLE dead_letters (
    id          BIGSERIAL   PRIMARY KEY,
    topic       TEXT        NOT NULL,
    partition   INT         NOT NULL,
    record_offset BIGINT    NOT NULL,
    record_key  TEXT,
    payload     TEXT,
    reason      TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
