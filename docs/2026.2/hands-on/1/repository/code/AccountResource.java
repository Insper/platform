package store.account;

import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

@Controller
public class AccountResource implements AccountController {

    @Autowired
    private AccountService accountService;

    @Override
    public ResponseEntity<Void> create(AccountIn in) {
        final String id = accountService.create(
            AccountParser.to(in)
        ).id();
        return ResponseEntity.created(
            ServletUriComponentsBuilder
                .fromCurrentRequest()
                .path("/{id}")
                .buildAndExpand(id)
                .toUri()
        ).build();
    }

    @Override
    public ResponseEntity<List<AccountOut>> findAll() {
        return ResponseEntity
            .ok(AccountParser.to(accountService.findAll()));
    }

    @Override
    public ResponseEntity<Void> delete(String id) {
        accountService.delete(id);
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<Void> healthCheck() {
        return ResponseEntity
            .ok()
            .build();
    }

    @Override
    public ResponseEntity<AccountOut> findById(String id) {
        final Account a = accountService.findById(id);
        if (a == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        return ResponseEntity.ok(AccountParser.to(a));
    }
    
}
