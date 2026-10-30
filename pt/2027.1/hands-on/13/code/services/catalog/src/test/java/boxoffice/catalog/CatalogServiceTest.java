package boxoffice.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * Hand-written unit tests of CatalogService: plain JUnit + Mockito, no Spring context, no database.
 * Deliberately incomplete -- lab 13 measures how much an AI-generated test class adds to them.
 */
class CatalogServiceTest {

    private EventRepository events;
    private VenueRepository venues;
    private CatalogService service;

    @BeforeEach
    void setUp() {
        events = mock(EventRepository.class);
        venues = mock(VenueRepository.class);
        service = new CatalogService(events, venues);
    }

    @Test
    void deletingAnExistingEventDeletesIt() {
        when(events.existsById(7L)).thenReturn(true);

        service.deleteEvent(7L);

        verify(events).deleteById(7L);
    }

    @Test
    void deletingAMissingEventIs404AndDeletesNothing() {
        when(events.existsById(7L)).thenReturn(false);

        assertThatThrownBy(() -> service.deleteEvent(7L))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(e -> ((ResponseStatusException) e).getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);
        verify(events, never()).deleteById(7L);
    }

    @Test
    void findVenueReturnsItsFields() {
        when(venues.findById(3L)).thenReturn(Optional.of(new Venue("Allianz Parque", "São Paulo", 43000)));

        var venue = service.findVenue(3L);

        assertThat(venue.name()).isEqualTo("Allianz Parque");
        assertThat(venue.city()).isEqualTo("São Paulo");
        assertThat(venue.capacity()).isEqualTo(43000);
    }
}
