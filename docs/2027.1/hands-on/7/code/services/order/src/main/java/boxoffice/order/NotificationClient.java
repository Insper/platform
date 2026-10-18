package boxoffice.order;

import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/** Only used in NOTIFY_MODE=sync: the "before" architecture. */
@Component
public class NotificationClient {

    private final RestClient http;

    public NotificationClient(RestClient.Builder builder, OrderProperties props) {
        this.http = builder.baseUrl(props.notificationUrl()).build();
    }

    public void send(OrderEvent event) {
        http.post().uri("/notifications").body(event).retrieve().toBodilessEntity();
    }
}
