// Extension point: implement this interface to add a new discount rule
// without touching DiscountService.
public interface DiscountPolicy {
    boolean appliesTo(Account account);
    double calculate(Account account);
}
