package boxoffice.notification;

import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;

@Component
public class EmailSender {

    private final JavaMailSender mail;
    private final NotificationProperties props;

    public EmailSender(JavaMailSender mail, NotificationProperties props) {
        this.mail = mail;
        this.props = props;
    }

    public void orderReceived(OrderEvent e) {
        if (e.customerEmail().startsWith("poison")) {
            // a permanent failure: retrying will never help
            throw new IllegalArgumentException("mailbox rejected: " + e.customerEmail());
        }
        simulateProviderLatency();
        SimpleMailMessage m = new SimpleMailMessage();
        m.setFrom("tickets@boxoffice.local");
        m.setTo(e.customerEmail());
        m.setSubject("BoxOffice: we received your order " + e.orderId());
        m.setText("Order " + e.orderId() + " for show " + e.showId() + " (R$ " + e.amount()
                + ") is waiting for payment.");
        mail.send(m);
    }

    /** A real e-mail API takes tens to hundreds of ms per call; Mailpit takes ~1 ms. */
    private void simulateProviderLatency() {
        try {
            Thread.sleep(props.emailLatency());
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(ex);
        }
    }
}
