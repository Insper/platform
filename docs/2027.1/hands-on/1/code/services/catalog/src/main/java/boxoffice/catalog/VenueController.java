package boxoffice.catalog;

import jakarta.validation.Valid;
import java.net.URI;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/catalog/venues")
public class VenueController {

    private final CatalogService service;

    public VenueController(CatalogService service) {
        this.service = service;
    }

    @GetMapping
    public List<VenueOut> list() {
        return service.allVenues();
    }

    @GetMapping("/{id}")
    public VenueOut get(@PathVariable Long id) {
        return service.findVenue(id);
    }

    @PostMapping
    public ResponseEntity<VenueOut> create(@Valid @RequestBody VenueIn in) {
        var out = service.createVenue(in);
        return ResponseEntity.created(URI.create("/catalog/venues/" + out.id())).body(out);
    }
}
