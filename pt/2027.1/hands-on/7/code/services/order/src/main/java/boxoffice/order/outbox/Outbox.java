package boxoffice.order.outbox;

import tools.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Component
public class Outbox {

    private final JdbcClient jdbc;
    private final ObjectMapper mapper;

    public Outbox(JdbcClient jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    /** MANDATORY: fails fast if someone calls it outside the business transaction. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void append(UUID eventId, String aggregateType, UUID aggregateId, String eventType, Object payload) {
        String json = mapper.writeValueAsString(payload); // Jackson 3: exceptions are unchecked
        jdbc.sql("""
                INSERT INTO outbox (id, aggregate_type, aggregate_id, event_type, payload)
                VALUES (?, ?, ?, ?, ?::jsonb)
                """)
                .params(eventId, aggregateType, aggregateId, eventType, json)
                .update();
    }
}
