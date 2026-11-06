package store.account;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.experimental.Accessors;

@Entity
@Table(name = "accounts")
@Setter @Accessors(chain = true, fluent = true)
@NoArgsConstructor @AllArgsConstructor
public class AccountModel {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id")
    private String id;

    @Column(name = "name")
    private String name;

    @Column(name = "email")
    private String email;

    @Column(name = "hash_password")
    private String hashPassword;

    public AccountModel(Account a) {
        this.id = a.id();
        this.name = a.name();
        this.email = a.email();
        this.hashPassword = a.hashPassword();
    }

    public Account to() {
        return Account.builder()
            .id(this.id)
            .name(this.name)
            .email(this.email)
            .hashPassword(this.hashPassword)
            .build();
    }
    
}
