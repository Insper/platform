package boxoffice.inventory;

public record SectionAvailability(String section, long available, long held, long sold) {
}
