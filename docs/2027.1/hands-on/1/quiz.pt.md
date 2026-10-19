Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

**Q1.** Por que o `catalog` devolve records `EventOut` em vez da entidade JPA `Event`?

- A. Records são serializados mais rápido que classes
- B. O contrato da API fica independente da tabela: colunas novas não vazam, e associações lazy nunca são serializadas fora de uma transação
- C. O Spring MVC não consegue serializar entidades
- D. Entidades não podem ter um campo `id`

??? success "Resposta"
    **B — Desacoplar o contrato do armazenamento.**

    Uma entidade é um mapeamento de tabela; um DTO é uma promessa aos clientes. Se forem o mesmo objeto, toda mudança de schema é uma mudança de API, e um `venue` lazy tocado pelo Jackson depois do fim da transação lança `LazyInitializationException`.

---

**Q2.** Listar 20 eventos sem `join fetch e.venue` executa quantas consultas SQL (ignorando a contagem)?

- A. 1
- B. 2
- C. 20
- D. 21

??? success "Resposta"
    **D — 21: o problema N+1.**

    Uma consulta carrega os 20 eventos; depois cada `event.getVenue()` dispara mais uma. Com `join fetch` vira um único `JOIN`. Sob carga, 21 idas e voltas por requisição multiplicam o tempo em que cada requisição segura uma conexão do pool.

---

**Q3.** Um colega edita `V2__seed_catalog.sql`, que já rodou na máquina de todos, para corrigir um erro de digitação. O que acontece na próxima inicialização?

- A. O Flyway aplica a nova versão da V2 automaticamente
- B. O Flyway detecta um checksum diferente e o serviço não inicia
- C. Nada: o Flyway ignora arquivos que já rodaram
- D. O Hibernate corrige os dados com `ddl-auto`

??? success "Resposta"
    **B — Checksum diferente, a inicialização falha.**

    O Flyway guarda um checksum de toda migration aplicada. Migrations aplicadas são história e não podem mudar; uma correção vai em uma nova migration (`V3__fix_typo.sql`). É isso que faz todo ambiente convergir para o mesmo schema.

---

**Q4.** O que faz `spring.jpa.hibernate.ddl-auto: validate`?

- A. Cria as tabelas que faltam
- B. Apaga e recria o schema a cada inicialização
- C. Verifica que as entidades batem com as tabelas existentes e falha se não baterem, sem alterar nada
- D. Valida o JSON das requisições recebidas

??? success "Resposta"
    **C — Verificar, nunca alterar.**

    O schema tem um único dono: o Flyway. O Hibernate só verifica que o mapeamento está consistente, o que pega uma migration faltando na inicialização em vez de na primeira consulta em produção.

---

**Q5.** Um cliente chama `GET /catalog/events?size=5000`. O que o serviço responde, e por que isso é uma decisão de projeto?

- A. 200 com 5.000 eventos — o cliente pediu
- B. 400, porque `size` tem `@Max(50)`: toda coleção deve ser limitada, ou uma requisição pode carregar a tabela inteira
- C. 404, porque a página 5.000 não existe
- D. 500, porque o Hibernate não carrega mais de 50 linhas

??? success "Resposta"
    **B — 400: coleções limitadas.**

    Um tamanho de página sem limite é um vetor de negação de serviço que você mesmo entrega. O limite faz parte do contrato, imposto na borda do serviço, antes de qualquer consulta rodar.

---

**Q6.** No smoke test, a listagem (`?city=`) é ~5–10× mais lenta que o detalhe (`/{id}`). Qual é o motivo principal?

- A. A serialização em JSON de 20 itens
- B. A listagem junta duas tabelas, filtra, ordena e conta milhares de linhas sem índice; o detalhe é uma busca por chave primária
- C. A listagem usa HTTP/1.0
- D. O nome da cidade tem acento

??? success "Resposta"
    **B — Trabalho feito no banco.**

    O detalhe toca uma linha pelo índice da chave primária. A listagem varre os eventos de uma cidade inteira duas vezes (página + `count(*)`) e os ordena. O lab 6 mostra o `EXPLAIN` e resolve com um índice; o lab 5 esconde o custo com um cache.

---

**Q7.** Por que o container do `catalog` tem `deploy.resources.limits.cpus: "1.0"`?

- A. O Spring Boot não consegue usar mais de um núcleo
- B. Para fazer de cada réplica um "servidor" pequeno e de tamanho fixo, de modo que as medições sejam comparáveis e acrescentar réplicas (lab 3) tenha um efeito visível
- C. O Docker exige limite de CPU para imagens Java
- D. Para deixar o build mais rápido

??? success "Resposta"
    **B — Uma unidade fixa de capacidade.**

    Sem limite, um container pode usar todos os núcleos do seu notebook, e escalar horizontalmente não mostraria ganho. Servidores e pods reais também têm tamanhos fixos; planejamento de capacidade é "quantas unidades deste tamanho?".

---

**Q8.** Por que usar um Dockerfile multi-stage?

- A. É o único jeito de gerar imagens Java
- B. A imagem final tem só o JRE e o jar: menor, mais rápida de baixar e sem ferramentas de build que aumentam a superfície de ataque
- C. Imagens multi-stage iniciam mais rápido porque pulam o JIT
- D. Faz a imagem rodar como root

??? success "Resposta"
    **B — Imagem de execução pequena, ferramentas de build ficam para trás.**

    O estágio de build (JDK + Maven, centenas de MB) é descartado. Imagens menores significam deploys e autoescala (lab 10) mais rápidos, e menos pacotes para corrigir.

---

**Q9.** O `catalog` inicia antes de o PostgreSQL estar pronto e quebra no Flyway. Qual configuração do Compose resolve?

- A. `restart: always` no `db`
- B. `depends_on: db: condition: service_healthy` com um `healthcheck` (`pg_isready`) no `db`
- C. `links: - db`
- D. Aumentar o limite de memória do `catalog`

??? success "Resposta"
    **B — Esperar a saúde, não o início.**

    Um `depends_on` simples só espera o container *iniciar*; o PostgreSQL precisa de mais alguns segundos para aceitar conexões. O healthcheck transforma "iniciado" em "pronto". No Kubernetes (lab 10) a mesma ideia vira readiness probes.

---

**Q10.** O smoke test mostra p50 = 5 ms e p99 = 40 ms para o detalhe com **um** usuário. Qual explicação é a mais plausível?

- A. A rede entre o k6 e o container perde pacotes
- B. Pausas ocasionais que não dependem da carga: compilação JIT, coleta de lixo, abertura de conexões do pool, páginas frias do banco
- C. O banco está sobrecarregado
- D. O k6 mede o p99 de forma errada

??? success "Resposta"
    **B — Latência de cauda existe mesmo sem carga.**

    Com um usuário não há fila, então a cauda vem do próprio runtime. Por isso testes de carga têm um período de aquecimento e por isso você sempre olha percentis, não só a mediana.
