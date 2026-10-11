Reconstrua e suba a stack completa com o Redis:

``` { .bash .copy .select }
docker compose up -d --build
```

Verifique se o container `redis` está rodando junto com todos os outros serviços:

``` { .bash .copy .select }
docker compose ps -a
```

A saída esperada inclui:

```
NAME                STATUS     PORTS
store-redis-1       running    0.0.0.0:6379->6379/tcp
store-lb-1          running    0.0.0.0:8080->80/tcp
store-gateway-1     running
store-gateway-2     running
store-gateway-3     running
store-account-1     running
store-account-2     running
store-auth-1        running
store-db-1          running    0.0.0.0:5432->5432/tcp
```

## Verificar o comportamento do cache

### Primeira requisição — cache miss

Envie uma requisição para buscar uma conta:

``` { .bash .copy .select }
curl -s http://localhost:8080/accounts/42 | jq
```

A primeira chamada vai ao banco de dados. Abra uma sessão do Redis CLI e inspecione a chave que foi gravada:

``` { .bash .copy .select }
docker compose exec redis redis-cli
```

``` { .bash .copy .select }
KEYS accounts::*
```

Esperado:

```
1) "accounts::42"
```

Leia o valor em cache:

``` { .bash .copy .select }
GET "accounts::42"
```

Esperado — uma string JSON:

```json
{"id":"42","name":"Ada Lovelace","email":"ada@example.com"}
```

### Segunda requisição — cache hit

Envie a mesma requisição novamente:

``` { .bash .copy .select }
curl -s http://localhost:8080/accounts/42 | jq
```

Confira os logs do serviço — desta vez o banco de dados **não** deve ser consultado:

``` { .bash .copy .select }
docker compose logs account --tail 20
```

Se o cache estiver funcionando, você verá uma linha de log para a primeira requisição, mas **nenhuma** para a segunda.

## Medir a diferença de latência

Use a saída de tempos embutida do `curl` para comparar os tempos de resposta:

``` { .bash .copy .select }
curl -o /dev/null -s -w "Cache miss: %{time_total}s\n" http://localhost:8080/accounts/42
```

``` { .bash .copy .select }
curl -o /dev/null -s -w "Cache hit:  %{time_total}s\n" http://localhost:8080/accounts/42
```

Um resultado típico:

```
Cache miss: 0.058s
Cache hit:  0.004s
```

O cache hit é de 10 a 15× mais rápido, porque o Redis responde em < 1 ms e a resposta passa apenas pelo gateway — sem ida e volta ao banco de dados.

## Inspecionar a expiração do TTL

Veja quanto tempo falta para uma chave em cache expirar:

``` { .bash .copy .select }
TTL "accounts::42"
```

Quando o TTL chega a 0, o Redis remove a chave automaticamente. A próxima requisição será um cache miss e o banco de dados será consultado de novo — mantendo o cache eventualmente consistente com o banco.

## Monitorar a taxa de acertos do cache

Observe a atividade do cache em tempo real com o comando `MONITOR`, embutido no Redis (use com cuidado em produção — ele registra todos os comandos):

``` { .bash .copy .select }
docker compose exec redis redis-cli MONITOR
```

Envie várias requisições e acompanhe a passagem dos comandos `GET` (hit ou nil) e `SET` (miss + armazenamento).

Para estatísticas agregadas, use `INFO stats`:

``` { .bash .copy .select }
docker compose exec redis redis-cli INFO stats | grep -E "keyspace_(hits|misses)"
```

```
keyspace_hits:8
keyspace_misses:1
```

Uma taxa de acertos saudável fica acima de 90% em workloads com muitas leituras. Se a taxa de misses estiver alta, considere aumentar o TTL ou pré-aquecer o cache na inicialização.

---

Pronto! O Redis agora atua como uma camada de cache compartilhada e persistente entre todas as réplicas dos microsserviços. A carga no banco de dados cai na proporção da taxa de acertos do cache, e todas as réplicas do gateway compartilham o mesmo estado de cache, não importa qual instância atenda cada requisição.
