// VIOLATION: every new customer type requires modifying this class.
// The class is open for modification but closed for extension.
public class DiscountService {

    public double calculate(Account account) {
        if ("VIP".equals(account.type())) {
            return account.orderTotal() * 0.20;
        } else if ("EMPLOYEE".equals(account.type())) {
            return account.orderTotal() * 0.30;
        } else if ("SEASONAL".equals(account.type())) {
            // Added later — had to reopen this class
            return account.orderTotal() * 0.15;
        } else {
            return account.orderTotal() * 0.05;
        }
        // Adding "PARTNER" requires another else-if and another class modification.
    }
}
