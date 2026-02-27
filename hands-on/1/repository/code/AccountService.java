
package store.account;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.List;
import java.util.stream.StreamSupport;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AccountService {

    private Logger looger = LoggerFactory.getLogger(AccountService.class);

    @Autowired
    private AccountRepository accountRepository;

    public Account create(Account account) {
        if (null == account.password()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                "Password is mandatory!"
            );
        }
        // clean special caracters
        account.password(account.password().trim());
        if (account.password().length() < 4) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                "Password is too short!"
            );
        }
        if (null == account.email()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                "Email is mandatory!"
            );
        }

        if (accountRepository.findByEmail(account.email()) != null)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                "Email already have been registered!"
            );

        account.sha256(hash(account.password()));

        return accountRepository.save(
            new AccountModel(account)
        ).to();
    }

    public List<Account> findAll() {
        return StreamSupport.stream(
            accountRepository.findAll().spliterator(), false)
            .map(AccountModel::to)
            .toList();
    }

    public Account findById(String id) {
        return accountRepository.findById(id).map(AccountModel::to).orElse(null);
    }

    public Account findByEmailAndPassword(String email, String password) {
        String sha256 = hash(password);
        return accountRepository.findByEmailAndSha256(email, sha256).map(AccountModel::to).orElse(null);
    }

    public void delete(String id) {
        accountRepository.delete(new AccountModel().id(id));
    }

    private String hash(String pass) {
        looger.debug("calculing the hash");
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] encodedHash = digest.digest(
                pass.getBytes(StandardCharsets.UTF_8)
            );
            return Base64.getEncoder().encodeToString(encodedHash);
        } catch (NoSuchAlgorithmException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, e.getMessage(), e);
        }
    }
    
}
