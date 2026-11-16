package store.notification;

import java.util.HashMap;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

@Service
public class NotificationService {

    private static Logger logger = LoggerFactory.getLogger(NotificationService.class);

    private final ObjectMapper objectMapper = new ObjectMapper();

    @KafkaListener(topics = "order-events", groupId = "notification-group")
    public void orderCreated(String message) {
        Map<String, String> event = objectMapper.readValue(message, new TypeReference<HashMap<String, String>>() {});
        logger.info("sending confirmation email: order {} (account {}, total {})",
            event.get("id"), event.get("idAccount"), event.get("total"));
    }

}
