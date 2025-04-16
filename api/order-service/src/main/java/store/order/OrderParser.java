package store.order;

import store.product.ProductOut;

public class OrderParser {

    public static Order to(OrderIn in) {
        return in == null ? null :
            Order.builder()
                .items(in.items() == null ? null : in.items().stream().map(OrderParser::to).toList())
                .build();
    }

    public static OrderOut to(Order a) {
        return a == null ? null :
            OrderOut.builder()
                .id(a.id())
                .date(a.date())
                .total(a.total())
                .items(a.items()  == null ? null : a.items().stream().map(OrderParser::to).toList())
                .build();
    }


    public static ItemOut to(Item a) {
        return a == null ? null :
            ItemOut.builder()
                .id(a.id())
                .quantity(a.quantity())
                .total(a.total())
                .product(a.product())
                .build();
    }

    public static Item to(ItemIn a) {
        return a == null ? null :
            Item.builder()
                .id(a.id())
                .quantity(a.quantity())
                .product(ProductOut.builder().id(a.id_product()).build())
                .build();
    }
    
}
