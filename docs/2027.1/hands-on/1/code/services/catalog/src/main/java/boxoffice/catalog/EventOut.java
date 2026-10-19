package boxoffice.catalog;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

/** What the API returns: never the JPA entity itself. */
public record EventOut(
        Long id,
        String title,
        Category category,
        OffsetDateTime startsAt,
        BigDecimal priceFrom,
        VenueOut venue) {

    static EventOut of(Event e) {
        return new EventOut(e.getId(), e.getTitle(), e.getCategory(), e.getStartsAt(),
                e.getPriceFrom(), VenueOut.of(e.getVenue()));
    }
}
