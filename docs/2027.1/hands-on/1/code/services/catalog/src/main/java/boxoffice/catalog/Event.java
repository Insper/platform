package boxoffice.catalog;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.OffsetDateTime;

@Entity
@Table(name = "events", schema = "catalog")
public class Event {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String title;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Category category;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "venue_id")
    private Venue venue;

    @Column(name = "starts_at", nullable = false)
    private OffsetDateTime startsAt;

    @Column(name = "price_from", nullable = false)
    private BigDecimal priceFrom;

    protected Event() {
        // required by JPA
    }

    public Event(String title, Category category, Venue venue, OffsetDateTime startsAt, BigDecimal priceFrom) {
        update(title, category, venue, startsAt, priceFrom);
    }

    public void update(String title, Category category, Venue venue, OffsetDateTime startsAt, BigDecimal priceFrom) {
        this.title = title;
        this.category = category;
        this.venue = venue;
        this.startsAt = startsAt;
        this.priceFrom = priceFrom;
    }

    public Long getId() { return id; }
    public String getTitle() { return title; }
    public Category getCategory() { return category; }
    public Venue getVenue() { return venue; }
    public OffsetDateTime getStartsAt() { return startsAt; }
    public BigDecimal getPriceFrom() { return priceFrom; }
}
