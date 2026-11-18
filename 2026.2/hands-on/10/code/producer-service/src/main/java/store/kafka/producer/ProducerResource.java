package store.kafka.producer;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;

@Controller
public class ProducerResource {

    @Autowired
    private ProducerService producerService;

    @GetMapping("/producer/{msg}")
    public ResponseEntity<Void> create(
        @PathVariable String msg
    ) {
        producerService.sendMessage(msg);
        return ResponseEntity.ok().build();
    }

    // a literal path wins over /producer/{msg}, so this never sends a message
    @GetMapping("/producer/health-check")
    public ResponseEntity<Void> healthCheck() {
        return ResponseEntity.ok().build();
    }

}
