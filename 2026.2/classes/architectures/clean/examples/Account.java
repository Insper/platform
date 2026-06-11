// Entities layer — pure domain object, zero framework annotations.
// Changes only when business rules about accounts change.
public class Account {

    private final String id;
    private String name;
    private final String email;
    private String passwordHash;

    private Account(String id, String name, String email, String passwordHash) {
        this.id           = id;
        this.name         = name;
        this.email        = email;
        this.passwordHash = passwordHash;
    }

    public static Account of(AccountIn in) {
        if (in.email() == null || !in.email().contains("@"))
            throw new DomainException("Invalid email: " + in.email());
        if (in.password() == null || in.password().length() < 8)
            throw new DomainException("Password must be at least 8 characters");
        return new Account(
            UUID.randomUUID().toString(),
            in.name(),
            in.email(),
            PasswordHash.bcrypt(in.password())
        );
    }

    public boolean matchesPassword(String rawPassword) {
        return PasswordHash.verify(rawPassword, this.passwordHash);
    }

    public String id()           { return id; }
    public String name()         { return name; }
    public String email()        { return email; }
    public String passwordHash() { return passwordHash; }
}
