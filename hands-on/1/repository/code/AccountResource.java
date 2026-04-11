package store.account;

import java.net.URI;
import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

@RestController
public class AccountResource implements AccountController {

    @Autowired
    private AccountService accountService;

    @Override
    public ResponseEntity<Void> create(AccountIn in) {
        final Account a = accountService.create(
            AccountParser.to(in)
        );
        // returns a JSON in the HATEAOS standard.
        return ResponseEntity.created(
            ServletUriComponentsBuilder
                .fromCurrentRequest()
                .path("/{id}")
                .buildAndExpand(a.id())
                .toUri()
        ).build();
    }

    @Override
    public ResponseEntity<Void> delete(String id) {
        accountService.delete(id);
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<Void> healthCheck() {
        return ResponseEntity.ok().build();
    }

    @Override
    public ResponseEntity<List<AccountOut>> findAll() {
        return ResponseEntity.ok(
            AccountParser.to(
                accountService.findByAll()
            )
        );
    }

    @Override
    public ResponseEntity<AccountOut> findById(String id) {
        Account out = accountService.findById(id);
        return out == null ?
            ResponseEntity.notFound().build() :
            ResponseEntity.ok(
                AccountParser.to(out) // transform from account to ou
            );
    }
    
}
