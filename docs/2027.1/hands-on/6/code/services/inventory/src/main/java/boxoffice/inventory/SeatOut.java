package boxoffice.inventory;

import java.math.BigDecimal;

public record SeatOut(Long id, String section, int row, int number, BigDecimal price, String status) {
}
