// Primary port implementation — also lives inside the application core.
// Depends on secondary ports (AccountRepository, TokenRepository) and on JwtService.
// In a stricter design JwtService would also be a port (e.g. TokenIssuer) with a JJWT adapter.
public class AuthServiceImpl implements AuthService {

    private final AccountRepository accounts;  // secondary port
    private final TokenRepository tokens;      // secondary port
    private final JwtService jwt;

    public AuthServiceImpl(AccountRepository accounts,
                           TokenRepository tokens,
                           JwtService jwt) {
        this.accounts = accounts;
        this.tokens   = tokens;
        this.jwt      = jwt;
    }

    @Override
    public TokenOut login(String email, String password) {
        // Same error for "unknown email" and "wrong password": telling them apart
        // would let an attacker discover which emails are registered.
        Account account = accounts.findByEmail(email)
            .filter(a -> a.matchesPassword(password))
            .orElseThrow(() -> new InvalidCredentialsException("Invalid credentials"));
        String token = jwt.generate(account);
        tokens.store(token, account.id());
        return new TokenOut(token);
    }

    @Override
    public void register(RegisterIn in) {
        if (accounts.findByEmail(in.email()).isPresent())
            throw new DomainException("Email already registered");
        accounts.save(Account.of(in));
    }

    @Override
    public void logout(String token) {
        tokens.revoke(token);
    }
}
