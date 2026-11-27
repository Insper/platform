package boxoffice.order.outbox;

import boxoffice.order.OrderProperties;
import io.opentelemetry.api.trace.propagation.W3CTraceContextPropagator;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.Scope;
import io.opentelemetry.context.propagation.TextMapGetter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.SendResult;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class OutboxRelay {

    private static final Logger log = LoggerFactory.getLogger(OutboxRelay.class);

    record Pending(UUID id, UUID aggregateId, String eventType, String payload, String traceparent) {
    }

    /** Reads the "traceparent" key from a Pending row. */
    private static final TextMapGetter<Pending> ROW = new TextMapGetter<>() {
        @Override
        public Iterable<String> keys(Pending p) {
            return List.of("traceparent");
        }

        @Override
        public String get(Pending p, String key) {
            return p == null || !"traceparent".equals(key) ? null : p.traceparent();
        }
    };

    private final JdbcClient jdbc;
    private final JdbcTemplate jdbcTemplate;
    private final KafkaTemplate<String, String> kafka;
    private final String topic;

    public OutboxRelay(JdbcClient jdbc, JdbcTemplate jdbcTemplate,
                       KafkaTemplate<String, String> kafka, OrderProperties props) {
        this.jdbc = jdbc;
        this.jdbcTemplate = jdbcTemplate;
        this.kafka = kafka;
        this.topic = props.topic();
    }

    @Scheduled(fixedDelayString = "${boxoffice.order.relay-interval-ms:200}")
    @Transactional
    public void relay() throws Exception {
        // SKIP LOCKED: several order replicas can relay in parallel without taking the same rows
        List<Pending> batch = jdbc.sql("""
                SELECT id, aggregate_id, event_type, payload::text AS payload, traceparent
                FROM outbox
                WHERE published_at IS NULL
                ORDER BY created_at
                LIMIT 100
                FOR UPDATE SKIP LOCKED
                """)
                .query(Pending.class)
                .list();
        if (batch.isEmpty()) {
            return;
        }

        List<CompletableFuture<SendResult<String, String>>> acks = new ArrayList<>();
        for (Pending p : batch) {
            ProducerRecord<String, String> record =
                    new ProducerRecord<>(topic, p.aggregateId().toString(), p.payload());
            record.headers().add("eventId", p.id().toString().getBytes(StandardCharsets.UTF_8));
            record.headers().add("eventType", p.eventType().getBytes(StandardCharsets.UTF_8));
            // continue the trace of the request that created the event
            Context origin = W3CTraceContextPropagator.getInstance().extract(Context.root(), p, ROW);
            try (Scope ignored = origin.makeCurrent()) {
                acks.add(kafka.send(record)); // the agent's producer span is a child of the request
            }
        }
        // wait for every ack; on failure the transaction rolls back and the rows are retried
        CompletableFuture.allOf(acks.toArray(new CompletableFuture<?>[0])).get(10, TimeUnit.SECONDS);

        jdbcTemplate.batchUpdate("UPDATE outbox SET published_at = clock_timestamp() WHERE id = ?",
                batch.stream().map(p -> new Object[] {p.id()}).toList());
        log.info("relayed {} event(s) to {}", batch.size(), topic);
    }

    @Scheduled(cron = "0 0 * * * *")
    @Transactional
    public void purge() {
        int n = jdbcTemplate.update(
                "DELETE FROM outbox WHERE published_at < now() - interval '1 day'");
        log.info("purged {} published outbox row(s)", n);
    }
}
