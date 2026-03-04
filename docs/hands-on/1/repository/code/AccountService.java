package store.account;

import java.util.List;
import java.util.stream.StreamSupport;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class AccountService {

    @Autowired
    private AccountRepository accountRepository;

    public List<Account> findByAll() {
        return StreamSupport.stream(
            accountRepository.findAll().spliterator(),
            false
        ).map(AccountModel::to)
        .toList();
    }
    
}
