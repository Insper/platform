package boxoffice.catalog;

import java.time.OffsetDateTime;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface EventRepository extends JpaRepository<Event, Long> {

    // one query: the event and its venue (no lazy-loading surprise later)
    @Query("select e from Event e join fetch e.venue where e.id = :id")
    Optional<Event> findWithVenue(Long id);

    // upcoming events, soonest first; Page also runs the count query
    @Query(value = """
            select e from Event e join fetch e.venue
            where e.startsAt >= :from
            order by e.startsAt, e.id""",
           countQuery = "select count(e) from Event e where e.startsAt >= :from")
    Page<Event> findUpcoming(OffsetDateTime from, Pageable pageable);

    // the same, filtered by the venue's city
    @Query(value = """
            select e from Event e join fetch e.venue v
            where v.city = :city and e.startsAt >= :from
            order by e.startsAt, e.id""",
           countQuery = """
            select count(e) from Event e join e.venue v
            where v.city = :city and e.startsAt >= :from""")
    Page<Event> findUpcomingInCity(String city, OffsetDateTime from, Pageable pageable);
}
