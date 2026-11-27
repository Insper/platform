-- every webhook event processed once: Stripe may deliver the same event more than once
CREATE TABLE stripe_events (
    id          VARCHAR(100) PRIMARY KEY,           -- evt_…
    type        VARCHAR(100) NOT NULL,
    received_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- the provider's PaymentIntent id is how a webhook finds its payment
CREATE UNIQUE INDEX payments_provider_ref ON payments (provider_ref);
