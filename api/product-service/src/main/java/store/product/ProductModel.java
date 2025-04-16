package store.product;


import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.experimental.Accessors;

@Entity
@Table(name = "product")
@Setter @Accessors(fluent = true)
@NoArgsConstructor
public class ProductModel {

    @Id
    @Column(name = "id_product")
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(name = "tx_name")
    private String name;

    @Column(name = "tx_price")
    private Float price;

    @Column(name = "tx_unit")
    private String unit;


    public ProductModel(Product a) {
        this.id = a.id();
        this.name = a.name();
        this.price = a.price();
        this.unit = a.unit();

    }

    public Product to() {
        return Product.builder()
            .id(this.id)
            .name(this.name)
            .price(this.price)
            .unit(this.unit)
            .build();
        }

}
