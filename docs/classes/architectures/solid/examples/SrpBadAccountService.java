// VIOLATION: one class handles validation, persistence, email, and audit
// Every time any of these concerns changes, this class must be modified.
public class AccountService {

    private final DataSource dataSource;
    private final JavaMailSender mailSender;
    private final Logger logger = Logger.getLogger(AccountService.class.getName());

    public AccountService(DataSource dataSource, JavaMailSender mailSender) {
        this.dataSource = dataSource;
        this.mailSender = mailSender;
    }

    public void createAccount(String email, String password) {

        // 1. Validation — business concern
        if (email == null || !email.contains("@"))
            throw new IllegalArgumentException("Invalid email: " + email);
        if (password == null || password.length() < 8)
            throw new IllegalArgumentException("Password too short");

        // 2. Persistence — infrastructure concern
        try (Connection conn = dataSource.getConnection()) {
            PreparedStatement stmt = conn.prepareStatement(
                "INSERT INTO accounts (email, password_hash) VALUES (?, ?)");
            stmt.setString(1, email);
            stmt.setString(2, BCrypt.hashpw(password, BCrypt.gensalt()));
            stmt.execute();
        } catch (SQLException e) {
            throw new RuntimeException("Failed to persist account", e);
        }

        // 3. Email notification — messaging concern
        SimpleMailMessage msg = new SimpleMailMessage();
        msg.setTo(email);
        msg.setSubject("Welcome to the Platform!");
        msg.setText("Your account has been created. You can now log in.");
        mailSender.send(msg);

        // 4. Audit log — cross-cutting concern
        logger.info("Account created for email=" + email
            + " at=" + Instant.now());
    }
}
