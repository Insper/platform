package boxoffice.catalog;

import java.util.List;
import org.springframework.data.domain.Page;

/** A stable JSON shape for paged results (Spring's Page is not meant to be serialized). */
public record PageOut<T>(List<T> items, int page, int size, long totalItems, int totalPages) {

    static <T> PageOut<T> of(Page<T> p) {
        return new PageOut<>(p.getContent(), p.getNumber(), p.getSize(), p.getTotalElements(), p.getTotalPages());
    }
}
