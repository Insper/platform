CREATE TABLE orders (
    id             UUID          PRIMARY KEY,
    show_id        VARCHAR(64)   NOT NULL,
    hold_id        VARCHAR(64)   NOT NULL UNIQUE,
    customer_email VARCHAR(320)  NOT NULL,
    amount         NUMERIC(10,2) NOT NULL,
    status         VARCHAR(20)   NOT NULL,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE outbox (
    id             UUID         PRIMARY KEY,
    aggregate_type VARCHAR(50)  NOT NULL,
    aggregate_id   UUID         NOT NULL,
    event_type     VARCHAR(50)  NOT NULL,
    payload        JSONB        NOT NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp(),
    published_at   TIMESTAMPTZ
);

-- the relay only ever looks at unpublished rows: keep that index tiny
CREATE INDEX outbox_unpublished ON outbox (created_at) WHERE published_at IS NULL;
