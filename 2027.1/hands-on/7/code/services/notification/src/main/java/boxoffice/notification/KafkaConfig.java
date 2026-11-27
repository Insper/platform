package boxoffice.notification;

import tools.jackson.core.JacksonException;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.DeadLetterPublishingRecoverer;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.kafka.support.ExponentialBackOffWithMaxRetries;

@Configuration
public class KafkaConfig {

    /** Picked up by Spring Boot's listener container factory (one CommonErrorHandler bean). */
    @Bean
    DefaultErrorHandler errorHandler(KafkaTemplate<String, String> template) {
        // after the retries, publish to <topic>-dlt, same partition, with the exception in headers
        DeadLetterPublishingRecoverer recoverer = new DeadLetterPublishingRecoverer(template);

        ExponentialBackOffWithMaxRetries backOff = new ExponentialBackOffWithMaxRetries(3);
        backOff.setInitialInterval(500L);  // 0.5 s, 1 s, 2 s
        backOff.setMultiplier(2.0);
        backOff.setMaxInterval(5_000L);

        DefaultErrorHandler handler = new DefaultErrorHandler(recoverer, backOff);
        // permanent failures: retrying is pointless, go straight to the DLT
        handler.addNotRetryableExceptions(JacksonException.class, IllegalArgumentException.class);
        return handler;
    }
}
