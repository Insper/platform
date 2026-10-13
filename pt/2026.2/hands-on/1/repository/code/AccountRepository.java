package store.account;

import java.util.List;

import org.springframework.data.repository.CrudRepository;

public interface AccountRepository extends CrudRepository<AccountModel, String> {

    List<AccountModel> findAll();
    
}
