-- W3C trace context of the request that wrote the event: 00-<trace id>-<span id>-<flags>
ALTER TABLE outbox ADD COLUMN traceparent VARCHAR(55);
