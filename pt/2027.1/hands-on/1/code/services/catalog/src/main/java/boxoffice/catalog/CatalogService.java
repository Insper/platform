package boxoffice.catalog;

import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class CatalogService {

    private final EventRepository events;
    private final VenueRepository venues;

    public CatalogService(EventRepository events, VenueRepository venues) {
        this.events = events;
        this.venues = venues;
    }

    // ---- events -------------------------------------------------------------

    @Transactional(readOnly = true)
    public EventOut findEvent(Long id) {
        return events.findWithVenue(id)
                .map(EventOut::of)
                .orElseThrow(() -> notFound("event", id));
    }

    @Transactional(readOnly = true)
    public PageOut<EventOut> upcomingEvents(String city, int page, int size) {
        var pageable = PageRequest.of(page, size);
        var now = OffsetDateTime.now();
        var result = (city == null || city.isBlank())
                ? events.findUpcoming(now, pageable)
                : events.findUpcomingInCity(city, now, pageable);
        return PageOut.of(result.map(EventOut::of));
    }

    @Transactional
    public EventOut createEvent(EventIn in) {
        var event = new Event(in.title(), in.category(), venue(in.venueId()), in.startsAt(), in.priceFrom());
        return EventOut.of(events.save(event));
    }

    @Transactional
    public EventOut updateEvent(Long id, EventIn in) {
        var event = events.findById(id).orElseThrow(() -> notFound("event", id));
        event.update(in.title(), in.category(), venue(in.venueId()), in.startsAt(), in.priceFrom());
        return EventOut.of(event);   // dirty checking: JPA writes the UPDATE at commit
    }

    @Transactional
    public void deleteEvent(Long id) {
        if (!events.existsById(id)) {
            throw notFound("event", id);
        }
        events.deleteById(id);
    }

    // ---- venues -------------------------------------------------------------

    @Transactional(readOnly = true)
    public List<VenueOut> allVenues() {
        return venues.findAll().stream().map(VenueOut::of).toList();
    }

    @Transactional(readOnly = true)
    public VenueOut findVenue(Long id) {
        return venues.findById(id).map(VenueOut::of).orElseThrow(() -> notFound("venue", id));
    }

    @Transactional
    public VenueOut createVenue(VenueIn in) {
        return VenueOut.of(venues.save(new Venue(in.name(), in.city(), in.capacity())));
    }

    // ---- helpers ------------------------------------------------------------

    private Venue venue(Long id) {
        return venues.findById(id).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.BAD_REQUEST, "venue " + id + " does not exist"));
    }

    private static ResponseStatusException notFound(String what, Long id) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, what + " " + id + " not found");
    }
}
