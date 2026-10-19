package boxoffice.notification;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

@ConfigurationProperties(prefix = "boxoffice.notification")
public record NotificationProperties(
        @DefaultValue("50ms") Duration emailLatency,
        @DefaultValue("true") boolean idempotent) {
}
