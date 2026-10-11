Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Cache em memória / Redis

**Q1.** O que é o padrão **cache-aside** e como ele difere do write-through?

- A. Cache-aside: a aplicação escreve apenas no cache; write-through: o banco de dados escreve no cache
- B. Cache-aside: a aplicação consulta primeiro o cache, consulta o banco em caso de miss e grava o resultado no cache; write-through: a camada de cache intercepta as escritas e grava no cache e no banco de forma atômica
- C. São equivalentes — os termos descrevem o mesmo padrão
- D. Cache-aside: apenas leituras vão para o cache; write-through: apenas escritas vão para o cache

??? success "Resposta"
    **B — Cache-aside: a aplicação gerencia o cache; write-through: a camada de cache intercepta as escritas.**

    No cache-aside (lazy loading), a aplicação consulta explicitamente o cache, busca no banco em caso de miss e preenche o cache. No write-through, o cache intercepta cada escrita e atualiza de forma síncrona tanto a si mesmo quanto o banco de dados — garantindo consistência forte, mas acrescentando latência às escritas. Este curso usa cache-aside via `@Cacheable`.

---

**Q2.** O que `@Cacheable` faz quando o cache **já contém** a chave solicitada?

- A. Atualiza o cache com o valor atual do banco de dados e o retorna
- B. Executa o corpo do método e compara o resultado com o valor em cache para garantir consistência
- C. Retorna imediatamente o valor em cache, pulando totalmente o corpo do método — o banco de dados não é consultado
- D. Estende o TTL da entrada em cache e depois executa o método normalmente

??? success "Resposta"
    **C — Retorna o valor em cache; o corpo do método é pulado.**

    Essa é toda a razão de ser do `@Cacheable`. O proxy AOP do Spring intercepta a chamada do método, procura a chave no Redis (por exemplo, `accounts::42`) e, se a encontrar, retorna diretamente o valor em cache. A implementação de `findById` — incluindo a consulta ao banco — nunca é executada. O ganho de desempenho é a diferença entre uma busca no Redis (<1 ms) e uma consulta no PostgreSQL (5–50 ms).

---

**Q3.** Por que configurar **serialização JSON** em vez da serialização Java padrão para os valores no Redis?

- A. A serialização JSON é mais rápida e usa menos memória que a serialização Java
- B. A serialização Java não é suportada pelo cliente Redis Lettuce
- C. O JSON produz chaves e valores legíveis por humanos, que podem ser inspecionados com `redis-cli`; o formato binário do Java é opaco e quebra quando a estrutura das classes muda entre deploys
- D. O Redis só aceita strings codificadas em UTF-8 e rejeita dados binários

??? success "Resposta"
    **C — Legível por humanos e estável entre versões.**

    A serialização Java produz blobs binários atrelados à definição exata da classe. Se você adicionar ou renomear um campo entre deploys, a desserialização falha com `InvalidClassException`. O JSON é legível por humanos (você pode inspecionar os valores com `redis-cli GET "accounts::42"`) e resiliente à adição de campos (o Jackson ignora campos desconhecidos com `@JsonIgnoreProperties`).

---

**Q4.** O que o TTL (time-to-live) proporciona às entradas em cache e o que aconteceria sem ele?

- A. O TTL limita o número de leituras por entrada; sem ele, chaves muito acessadas monopolizariam a memória
- B. O TTL expira as entradas automaticamente após um tempo configurado — sem ele, dados desatualizados se acumulariam indefinidamente, pois o banco muda mas o cache não
- C. O TTL controla a taxa de escrita; sem ele, as escritas no cache sobrecarregariam o Redis
- D. O TTL não afeta a corretude — é apenas uma dica de desempenho

??? success "Resposta"
    **B — Evita que dados desatualizados se acumulem indefinidamente.**

    Se o e-mail de uma conta for atualizado no PostgreSQL, mas o cache não tiver TTL, `accounts::42` retornaria o e-mail antigo para sempre (até um reinício do servidor). Com um TTL de 5 minutos, a entrada desatualizada expira e a próxima leitura consulta o banco novamente. O `@CachePut` no método de atualização também garante que o cache seja renovado imediatamente quando os dados mudam.

---

**Q5.** Por que o Redis é especialmente valioso quando o gateway roda com **3 réplicas** (como a partir do Hands-on 7)?

- A. O Redis atua como message broker entre as réplicas do gateway, sincronizando seus caches locais
- B. Cada réplica do gateway tem sua própria instância do Redis, reduzindo a carga sobre o banco compartilhado
- C. Todas as réplicas compartilham a mesma instância do Redis; uma entrada de cache gravada pela réplica 1 fica imediatamente disponível para as réplicas 2 e 3, eliminando consultas redundantes ao banco, independentemente de qual réplica atenda cada requisição
- D. O Redis armazena tokens JWT para cada réplica, permitindo o compartilhamento de sessões sem estado

??? success "Resposta"
    **C — Um cache externo compartilhado elimina a redundância entre réplicas.**

    Sem o Redis, cada réplica do gateway tem seu próprio cache no heap da JVM. Uma requisição roteada para a réplica 1 coloca a conta 42 em cache. A próxima requisição para a conta 42, roteada para a réplica 2, causa outra consulta ao banco — o cache da réplica 1 é invisível para a réplica 2. O Redis é externo a todas as réplicas; o resultado de uma consulta é armazenado em cache uma única vez e fica disponível instantaneamente para as três réplicas.
