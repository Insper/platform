package boxoffice.order.payment;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** Fast, explicit failure: the fan sees "try again in a moment", not a 60-second spinner. */
@ResponseStatus(HttpStatus.SERVICE_UNAVAILABLE)
public class PaymentUnavailableException extends RuntimeException {

    public PaymentUnavailableException(Throwable cause) {
        super("payment temporarily unavailable: " + cause.getClass().getSimpleName(), cause);
    }
}
