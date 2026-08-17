// Primary port implementation — also lives inside the application core.
// Depends only on secondary ports (AccountRepository, TokenRepository).
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
        Account account = accounts.findByEmail(email)
            .orElseThrow(() -> new InvalidCredentialsException("Account not found"));
        if (!account.matchesPassword(password))
            throw new InvalidCredentialsException("Wrong password");
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
