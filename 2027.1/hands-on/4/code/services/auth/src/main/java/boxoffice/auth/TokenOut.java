package boxoffice.auth;

/** OAuth-style token response. */
public record TokenOut(String accessToken, String tokenType, long expiresIn) {
}
