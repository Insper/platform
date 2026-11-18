package store.notification;

import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class NotificationResource {

    // the notification has no route in the gateway: this is for the orchestrator
    // (compose healthcheck, Kubernetes probe), called inside the network
    @GetMapping("/notification/health-check")
    public ResponseEntity<Void> healthCheck() {
        return ResponseEntity.ok().build();
    }

}
