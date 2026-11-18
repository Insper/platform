// Primary port — defined BY the application core.
// Expresses what the authentication use case can do, in domain language.
public interface AuthService {
    TokenOut login(String email, String password);
    void register(RegisterIn in);
    void logout(String token);
}
