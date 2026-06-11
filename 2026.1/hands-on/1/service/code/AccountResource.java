package store.account;

import java.util.List;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AccountResource implements AccountController {

    @Override
    public ResponseEntity<Void> create(AccountIn in) {
        // TODO Auto-generated method stub
        return null;
    }

    @Override
    public ResponseEntity<Void> delete(String id) {
        // TODO Auto-generated method stub
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<Void> healthCheck() {
        return ResponseEntity.ok().build();
    }

    @Override
    public ResponseEntity<List<AccountOut>> findAll() {
        // TODO Auto-generated method stub
        return null;
    }

    @Override
    public ResponseEntity<AccountOut> findById(String id) {
        // just an example
        AccountOut out = AccountOut.builder()
            .name("John")
            .email("JAlbert@xpto.gov")
            .id("1345")
            .build();
        return ResponseEntity.ok(
            out
        );
    }
    
}
