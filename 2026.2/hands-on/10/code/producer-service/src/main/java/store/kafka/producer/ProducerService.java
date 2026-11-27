package store.kafka.producer;

import java.util.Map;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

import tools.jackson.databind.ObjectMapper;

@Service
public class ProducerService {

    private static Logger logger = LoggerFactory.getLogger(ProducerService.class);

    @Autowired
    private KafkaTemplate<String, String> kafkaTemplate;

    private final ObjectMapper objectMapper = new ObjectMapper();

    public void sendMessage(String msg) {
        final String id = UUID.randomUUID().toString();
        Map<String, String> map = Map.of(
            "id", String.valueOf(id),
            "message", msg
        );
        logger.debug("queue {}", map);
        kafkaTemplate.send("store-producer-example", objectMapper.writeValueAsString(map));
    }

}
