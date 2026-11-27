package boxoffice.catalog;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * Starts the real service against a real PostgreSQL 17 and a real Redis, in throwaway containers:
 * Flyway migrations, JPA mappings, the cache, JSON and the error format are tested together.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureTestRestTemplate
@Testcontainers
class CatalogApiTest {

    @Container
    @ServiceConnection // Spring Boot points the datasource at this container
    static PostgreSQLContainer db = new PostgreSQLContainer("postgres:17");

    @Container
    @ServiceConnection(name = "redis") // ... and the Redis client at this one
    static GenericContainer<?> redis = new GenericContainer<>("redis:8-alpine").withExposedPorts(6379);

    @Autowired
    TestRestTemplate http;

    @Test
    void returnsTheFlashSaleEvent() {
        ResponseEntity<EventOut> res = http.getForEntity("/catalog/events/1", EventOut.class);

        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(res.getBody()).isNotNull();
        assertThat(res.getBody().title()).isEqualTo("BoxOffice Fest — Stadium Night");
    }

    @Test
    void unknownEventIsAProblem404() {
        ResponseEntity<String> res = http.getForEntity("/catalog/events/999999999", String.class);

        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(res.getHeaders().getContentType()).isEqualTo(MediaType.APPLICATION_PROBLEM_JSON);
    }

    @Test
    void invalidEventIsRejected() {
        ResponseEntity<String> res = http.postForEntity("/catalog/events",
                new EventIn("", null, null, null, null), String.class);

        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }
}
