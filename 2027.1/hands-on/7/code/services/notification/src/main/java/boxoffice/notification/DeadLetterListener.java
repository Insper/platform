package boxoffice.notification;

import java.nio.charset.StandardCharsets;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.common.header.Header;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.KafkaHeaders;
import org.springframework.stereotype.Component;

@Component
public class DeadLetterListener {

    private static final Logger log = LoggerFactory.getLogger(DeadLetterListener.class);

    private final JdbcClient jdbc;

    public DeadLetterListener(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @KafkaListener(topics = "order-events-dlt", groupId = "notification-dlt")
    public void onDeadLetter(ConsumerRecord<String, String> record) {
        // the listener's exception is wrapped: the CAUSE class says what really failed
        Header cause = record.headers().lastHeader(KafkaHeaders.DLT_EXCEPTION_CAUSE_FQCN);
        String why = cause == null ? "?" : new String(cause.value(), StandardCharsets.UTF_8);
        log.warn("dead letter at {}-{}@{}: {}", record.topic(), record.partition(), record.offset(), why);
        jdbc.sql("""
                INSERT INTO dead_letters (topic, partition, record_offset, record_key, payload, reason)
                VALUES (?, ?, ?, ?, ?, ?)
                """)
                .params(record.topic(), record.partition(), record.offset(), record.key(), record.value(), why)
                .update();
    }
}
