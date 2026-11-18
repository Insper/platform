package store.order;

import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

import tools.jackson.databind.ObjectMapper;

@Service
public class OrderEventPublisher {

    private static Logger logger = LoggerFactory.getLogger(OrderEventPublisher.class);

    @Autowired
    private KafkaTemplate<String, String> kafkaTemplate;

    private final ObjectMapper objectMapper = new ObjectMapper();

    // call it after the order is saved: never announce an order that does not exist
    public void orderCreated(String id, String idAccount, Double total) {
        Map<String, String> event = Map.of(
            "id", id,
            "idAccount", idAccount,
            "total", String.valueOf(total)
        );
        logger.debug("order-events {}", event);
        // the key is the order id: every event of an order goes to the same partition, in order
        kafkaTemplate.send("order-events", id, objectMapper.writeValueAsString(event));
    }

}
