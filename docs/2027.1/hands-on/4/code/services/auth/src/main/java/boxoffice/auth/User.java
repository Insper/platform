package boxoffice.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "users", schema = "auth")
public class User {

    @Id
    private UUID id;

    @Column(nullable = false, unique = true)
    private String email;

    @Column(nullable = false)
    private String name;

    @Column(name = "password_hash", nullable = false)
    private String passwordHash;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Role role;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    protected User() {
        // required by JPA
    }

    public User(String email, String name, String passwordHash, Role role) {
        this.id = UUID.randomUUID();
        this.email = email;
        this.name = name;
        this.passwordHash = passwordHash;
        this.role = role;
        this.createdAt = OffsetDateTime.now();
    }

    public UUID getId() { return id; }
    public String getEmail() { return email; }
    public String getName() { return name; }
    public String getPasswordHash() { return passwordHash; }
    public Role getRole() { return role; }
}
