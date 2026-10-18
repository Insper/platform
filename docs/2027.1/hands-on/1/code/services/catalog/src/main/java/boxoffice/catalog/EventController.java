package boxoffice.catalog;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/catalog/events")
public class EventController {

    private final CatalogService service;

    public EventController(CatalogService service) {
        this.service = service;
    }

    @GetMapping
    public PageOut<EventOut> list(
            @RequestParam(required = false) String city,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(50) int size) {
        return service.upcomingEvents(city, page, size);
    }

    @GetMapping("/{id}")
    public EventOut get(@PathVariable Long id) {
        return service.findEvent(id);
    }

    @PostMapping
    public ResponseEntity<EventOut> create(@Valid @RequestBody EventIn in) {
        var out = service.createEvent(in);
        return ResponseEntity.created(URI.create("/catalog/events/" + out.id())).body(out);
    }

    @PutMapping("/{id}")
    public EventOut update(@PathVariable Long id, @Valid @RequestBody EventIn in) {
        return service.updateEvent(id, in);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id) {
        service.deleteEvent(id);
    }
}
