package store.kafka.consumer;

import java.util.HashMap;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

@Service
public class ConsumerService {

    private static Logger logger = LoggerFactory.getLogger(ConsumerService.class);

    private final ObjectMapper objectMapper = new ObjectMapper();

    @KafkaListener(topics = "store-producer-example", groupId = "store")
    public void consumerMsg(String message) {
        Map<String, String> map = objectMapper.readValue(message, new TypeReference<HashMap<String, String>>() {});
        logger.debug("enqueue {}", map);
    }

}
