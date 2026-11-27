package boxoffice.order;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

@ConfigurationProperties(prefix = "boxoffice.order")
public record OrderProperties(
        @DefaultValue("outbox") NotifyMode notifyMode,
        @DefaultValue("http://notification:8086") String notificationUrl,
        @DefaultValue("order-events") String topic,
        @DefaultValue("200") long relayIntervalMs) {

    public enum NotifyMode { SYNC, OUTBOX }
}
