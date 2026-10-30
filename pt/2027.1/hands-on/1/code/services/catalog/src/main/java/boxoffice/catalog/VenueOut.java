package boxoffice.catalog;

public record VenueOut(Long id, String name, String city, int capacity) {

    static VenueOut of(Venue v) {
        return new VenueOut(v.getId(), v.getName(), v.getCity(), v.getCapacity());
    }
}
