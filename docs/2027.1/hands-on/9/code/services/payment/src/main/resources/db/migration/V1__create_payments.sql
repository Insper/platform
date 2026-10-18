CREATE TABLE payments (
    id              UUID          PRIMARY KEY,
    idempotency_key VARCHAR(100)  NOT NULL UNIQUE,  -- one charge per key, whatever the retries
    order_id        UUID          NOT NULL,
    amount          NUMERIC(10,2) NOT NULL,
    status          VARCHAR(20)   NOT NULL,          -- AUTHORIZED | DECLINED
    provider_ref    VARCHAR(100),
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);
