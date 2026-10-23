package boxoffice.notification;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** The synchronous "before" path, used by order in NOTIFY_MODE=sync. */
@RestController
public class NotificationController {

    private final NotificationService notifications;

    public NotificationController(NotificationService notifications) {
        this.notifications = notifications;
    }

    @PostMapping("/notifications")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void send(@RequestBody OrderEvent event) {
        notifications.handle(event);
    }
}
