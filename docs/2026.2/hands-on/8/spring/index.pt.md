O Spring Boot se integra ao Redis por meio de duas abstrações complementares: o **Spring Cache** (cache declarativo, baseado em anotações) e o **Spring Data Redis** (o `RedisTemplate`, de baixo nível, para operações personalizadas). Na maioria dos casos, o Spring Cache é suficiente.

## 1 Dependências

Adicione o seguinte ao `pom.xml` de cada microsserviço que vai usar o cache:

``` { .xml .copy .select }
<!-- Redis client and Spring Data Redis -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-redis</artifactId>
</dependency>

<!-- Spring Cache abstraction -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-cache</artifactId>
</dependency>
```

- `spring-boot-starter-data-redis` traz o Lettuce, o cliente Redis não bloqueante usado por padrão pelo Spring Boot.
- `spring-boot-starter-cache` fornece as anotações `@Cacheable`, `@CachePut` e `@CacheEvict`.

## 2 Configuração

Configure a conexão com o Redis e o comportamento do cache no `application.yaml`:

``` { .yaml .copy .select title="application.yaml" }
spring:
  data:
    redis:
      host: ${REDIS_HOST:localhost}
      port: ${REDIS_PORT:6379}
  cache:
    type: redis
    redis:
      time-to-live: 300000    # 5 minutes in milliseconds
      cache-null-values: false
```

| Propriedade | Valor | Significado |
|---|---|---|
| `host` / `port` | variáveis de ambiente | Resolvidos a partir do ambiente do Docker Compose em tempo de execução |
| `type: redis` | — | Força o Spring Cache a usar o Redis; desativa o `ConcurrentMapCache` padrão, em memória (um por JVM, sem TTL) |
| `time-to-live` | 300 000 ms | As chaves expiram automaticamente após 5 minutos — evita dados desatualizados indefinidamente |
| `cache-null-values` | false | Não guarda resultados `null` em cache; permite consultar de novo quando um registro ainda não existe |

## 3 Habilitar o cache

Adicione `@EnableCaching` à classe principal da aplicação (ou a qualquer classe `@Configuration`):

``` { .java .copy .select }
@SpringBootApplication
@EnableCaching
public class AccountApplication {
    public static void main(String[] args) {
        SpringApplication.run(AccountApplication.class, args);
    }
}
```

## 4 Anotações de cache

Coloque as anotações nos **métodos da camada de serviço**, não nos controllers nem nos repositories.

### `@Cacheable` — cache de leitura (read-through)

Consulta o cache antes de executar o método. Se existir uma entrada para a chave, o corpo do método é **pulado** e o valor em cache é retornado diretamente.

``` { .java .copy .select }
@Cacheable(value = "accounts", key = "#id")
public AccountOut findById(String id) {
    return accountRepository.findById(id)
        .map(AccountOut::from)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
}
```

Na **primeira chamada** com `id = "42"`: o método é executado, consulta o banco de dados e armazena o resultado no Redis sob a chave `accounts::42`.

Nas **chamadas seguintes** com o mesmo id: o corpo do método não é executado. O Spring recupera `accounts::42` do Redis e o retorna imediatamente.

### `@CachePut` — cache de escrita (write-through)

**Sempre** executa o corpo do método e atualiza o cache com o valor de retorno. Usado para manter o cache consistente após uma atualização.

``` { .java .copy .select }
@CachePut(value = "accounts", key = "#id")
public AccountOut update(String id, AccountIn dto) {
    Account account = accountRepository.findById(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    account.update(dto);
    return AccountOut.from(accountRepository.save(account));
}
```

### `@CacheEvict` — invalidar

Remove a entrada do cache para a chave informada. Usado em operações de exclusão, para que as leituras seguintes vão ao banco de dados.

``` { .java .copy .select }
@CacheEvict(value = "accounts", key = "#id")
public void delete(String id) {
    accountRepository.deleteById(id);
}
```

Para remover **todas as entradas** de um cache (por exemplo, em atualizações em massa):

``` { .java .copy .select }
@CacheEvict(value = "accounts", allEntries = true)
public void deleteAll() {
    accountRepository.deleteAll();
}
```

## 5 Serialização

Por padrão, o Spring Data Redis usa a serialização Java, que produz chaves e valores binários ilegíveis. Configure a serialização JSON para que o conteúdo do cache possa ser inspecionado com o `redis-cli`:

``` { .java .copy .select }
@Configuration
public class RedisConfig {

    @Bean
    public RedisCacheConfiguration cacheConfiguration(ObjectMapper objectMapper) {
        return RedisCacheConfiguration.defaultCacheConfig()
            .serializeValuesWith(
                RedisSerializationContext.SerializationPair.fromSerializer(
                    new GenericJackson2JsonRedisSerializer(objectMapper)
                )
            )
            .entryTtl(Duration.ofMinutes(5))
            .disableCachingNullValues();
    }
}
```

Com essa configuração, executar `redis-cli GET "accounts::42"` retorna uma string JSON legível em vez de lixo binário.

!!! warning "As classes em cache devem ser serializáveis"
    Todas as classes armazenadas no cache (`AccountOut` etc.) devem ser serializáveis em JSON. Garanta que tenham um construtor sem argumentos (exigido pelo Jackson) e que todos os campos sejam públicos ou tenham métodos getter. Adicione `@JsonIgnoreProperties(ignoreUnknown = true)` por segurança, para quando a classe evoluir.

## Resumo

| Anotação | Quando usar | Comportamento do cache |
|---|---|---|
| `@Cacheable` | Operações de leitura (GET) | Retorna o valor em cache; executa só em caso de miss |
| `@CachePut` | Operações de escrita (PUT/PATCH) | Sempre executa; atualiza o cache com o resultado |
| `@CacheEvict` | Operações de exclusão (DELETE) | Executa; remove a chave do cache |

As três anotações sobre uma conta, como o Redis as vê (o `MONITOR` da página [Executar](../run/index.md) mostra os mesmos comandos):

``` mermaid-sim
sequenceDiagram
    participant C as Cliente
    participant S as AccountService (proxy)
    participant R as Redis
    participant DB as PostgreSQL
    C->>S: GET /accounts/42 (@Cacheable)
    S->>R: GET accounts::42
    R-->>S: (nil): um miss
    S->>DB: findById roda
    S->>R: SET accounts::42, TTL 300 s
    C->>S: GET /accounts/42 (@Cacheable)
    S->>R: GET accounts::42
    R-->>S: o JSON: um hit, o corpo do método é pulado
    C->>S: PUT /accounts/42 (@CachePut)
    S->>DB: update roda
    S->>R: SET accounts::42 com o valor novo
    C->>S: DELETE /accounts/42 (@CacheEvict)
    S->>DB: delete roda
    S->>R: DEL accounts::42
```

!!! warning "Armadilhas comuns"
    - Esquecer `@EnableCaching`: as anotações não fazem nada. Com `type: simple` (ou sem o starter do Redis), cada réplica guarda o próprio `ConcurrentMapCache` — nenhum cache compartilhado.
    - Valores binários no `redis-cli`: falta o serializador JSON (`RedisConfig`).
    - Um cache pode servir **dados desatualizados**: `@CachePut` / `@CacheEvict` nas escritas e um TTL o mantêm eventualmente consistente. Uma mudança feita pelas costas do serviço (direto no banco) fica invisível até o TTL acabar.
