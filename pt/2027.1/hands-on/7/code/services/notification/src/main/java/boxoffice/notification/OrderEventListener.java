package boxoffice.notification;

import tools.jackson.databind.ObjectMapper;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
public class OrderEventListener {

    private final ObjectMapper mapper;
    private final NotificationService notifications;

    public OrderEventListener(ObjectMapper mapper, NotificationService notifications) {
        this.mapper = mapper;
        this.notifications = notifications;
    }

    @KafkaListener(topics = "order-events", groupId = "notification")
    public void onOrderEvent(ConsumerRecord<String, String> record) {
        OrderEvent event = mapper.readValue(record.value(), OrderEvent.class);
        if (event.eventId() == null || event.eventType() == null) {
            throw new IllegalArgumentException("not a BoxOffice event: " + record.value());
        }
        if (!"OrderPlaced".equals(event.eventType())) {
            return; // other event types are not for this consumer (yet)
        }
        notifications.handle(event);
    }
}
