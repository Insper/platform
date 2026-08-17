// Interface Adapters layer — translates HTTP ↔ Use Case.
// The only Spring annotation in this file is @RestController.
// Business logic lives entirely in AccountService.
@RestController
@RequestMapping("/accounts")
public class AccountController implements AccountApi {

    private final AccountService service;

    public AccountController(AccountService service) {
        this.service = service;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public AccountOut create(@RequestBody @Valid AccountIn in) {
        return service.create(in);
    }

    @GetMapping("/{id}")
    public AccountOut findById(@PathVariable String id) {
        return service.findById(id);
    }

    @GetMapping
    public List<AccountOut> findAll() {
        return service.findAll();
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String id) {
        service.delete(id);
    }
}
