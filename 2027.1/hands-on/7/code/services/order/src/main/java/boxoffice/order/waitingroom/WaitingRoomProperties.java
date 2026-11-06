package boxoffice.order.waitingroom;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

@ConfigurationProperties(prefix = "boxoffice.waiting-room")
public record WaitingRoomProperties(
        @DefaultValue("20") int admitPerSecond,
        @DefaultValue("5m") Duration admissionTtl) {
}
