package store.account;

import java.util.List;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;

@FeignClient(
    name="account",
    url="http://account:8080"
)
public interface AccountController {

    @PostMapping("/accounts")
    public ResponseEntity<Void> create(
        @RequestBody AccountIn in
    );

    @DeleteMapping("/accounts/{id}")
    public ResponseEntity<Void> delete(
        @PathVariable String id
    );

    @GetMapping("/accounts/health-check")
    public ResponseEntity<Void> healthCheck();

    @GetMapping("/accounts")
    public ResponseEntity<List<AccountOut>> findAll();

    @GetMapping("/accounts/{id}")
    public ResponseEntity<AccountOut> findById(
        @PathVariable String id
    );

}
