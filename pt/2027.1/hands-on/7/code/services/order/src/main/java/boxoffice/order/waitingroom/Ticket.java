package boxoffice.order.waitingroom;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record Ticket(String ticketId, String status, Long position, Long etaSeconds, Long expiresInSeconds) {

    static Ticket waiting(String id, long position, long eta) {
        return new Ticket(id, "WAITING", position, eta, null);
    }

    static Ticket admitted(String id, Long expiresIn) {
        return new Ticket(id, "ADMITTED", null, null, expiresIn);
    }

    static Ticket unknown(String id) {
        return new Ticket(id, "UNKNOWN", null, null, null);
    }
}
