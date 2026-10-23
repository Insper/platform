package boxoffice.inventory;

import com.zaxxer.hikari.HikariDataSource;
import javax.sql.DataSource;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.datasource.LazyConnectionDataSourceProxy;

/**
 * Two connection pools — primary and replica — behind one DataSource.
 * A transaction marked @Transactional(readOnly = true) gets a replica connection;
 * every other transaction gets a primary connection. The choice happens when the
 * transaction runs its first statement (that is what "lazy" means here).
 */
@Configuration
public class DataSourceConfig {

    @Bean
    @ConfigurationProperties("inventory.datasource.primary")
    HikariDataSource primaryDataSource() {
        return new HikariDataSource();
    }

    @Bean
    @ConfigurationProperties("inventory.datasource.replica")
    HikariDataSource replicaDataSource() {
        return new HikariDataSource();
    }

    @Bean
    @Primary
    DataSource dataSource(HikariDataSource primaryDataSource, HikariDataSource replicaDataSource) {
        var routing = new LazyConnectionDataSourceProxy(primaryDataSource);
        routing.setReadOnlyDataSource(replicaDataSource);     // Spring Framework 6.2+
        return routing;
    }
}
