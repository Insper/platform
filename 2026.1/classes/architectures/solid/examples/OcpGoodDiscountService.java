// Closed for modification: this class never changes when a new policy is added.
// Open for extension: inject a new DiscountPolicy implementation.
public class DiscountService {

    private final List<DiscountPolicy> policies;

    public DiscountService(List<DiscountPolicy> policies) {
        this.policies = policies;
    }

    public double calculate(Account account) {
        return policies.stream()
            .filter(p -> p.appliesTo(account))
            .mapToDouble(p -> p.calculate(account))
            .sum();
    }
}

// Each policy is a new class — DiscountService is never touched again.
class VipDiscountPolicy implements DiscountPolicy {
    public boolean appliesTo(Account a) { return "VIP".equals(a.type()); }
    public double calculate(Account a)  { return a.orderTotal() * 0.20; }
}

class EmployeeDiscountPolicy implements DiscountPolicy {
    public boolean appliesTo(Account a) { return "EMPLOYEE".equals(a.type()); }
    public double calculate(Account a)  { return a.orderTotal() * 0.30; }
}
