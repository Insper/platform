// Driving adapter — translates HTTP requests into primary port calls.
// Lives outside the hexagon. Depends on the AuthService interface (primary port).
@RestController
@RequestMapping("/auth")
public class AuthController {

    private final AuthService authService;  // primary port

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/login")
    public ResponseEntity<TokenOut> login(@RequestBody @Valid LoginIn in) {
        TokenOut token = authService.login(in.email(), in.password());
        return ResponseEntity.ok(token);
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public void register(@RequestBody @Valid RegisterIn in) {
        authService.register(in);
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(@RequestHeader("Authorization") String bearer) {
        authService.logout(bearer.replace("Bearer ", ""));
    }
}
