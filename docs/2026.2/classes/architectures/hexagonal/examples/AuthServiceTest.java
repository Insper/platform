// Pure unit test — no Spring context, no database, no HTTP server.
// The in-memory adapter replaces JPA; the core is tested in isolation.
class AuthServiceTest {

    private final InMemoryAccountRepository accounts = new InMemoryAccountRepository();
    private final InMemoryTokenRepository   tokens   = new InMemoryTokenRepository();
    private final JwtService                jwt      = new JwtService("test-secret");
    private final AuthService               service  =
        new AuthServiceImpl(accounts, tokens, jwt);

    @Test
    void loginSucceeds_whenCredentialsMatch() {
        accounts.save(Account.of(new RegisterIn("Ada", "ada@example.com", "securepass")));

        TokenOut result = service.login("ada@example.com", "securepass");

        assertThat(result.token()).isNotBlank();
    }

    @Test
    void loginFails_whenPasswordIsWrong() {
        accounts.save(Account.of(new RegisterIn("Ada", "ada@example.com", "securepass")));

        assertThatThrownBy(() -> service.login("ada@example.com", "wrongpassword"))
            .isInstanceOf(InvalidCredentialsException.class);
    }

    @Test
    void register_failsWhenEmailAlreadyExists() {
        var in = new RegisterIn("Ada", "ada@example.com", "securepass");
        service.register(in);

        assertThatThrownBy(() -> service.register(in))
            .isInstanceOf(DomainException.class)
            .hasMessageContaining("already registered");
    }
}
