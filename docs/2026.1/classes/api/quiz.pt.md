
Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Design de APIs REST

**Q1.** Qual método HTTP é **idempotente, mas não seguro**?

- A. `GET` — seguro e idempotente
- B. `POST` — nem seguro nem idempotente
- C. `PUT` — chamá-lo várias vezes com o mesmo corpo produz o mesmo resultado, mas ele modifica o estado do servidor
- D. `DELETE` — seguro porque apenas remove dados

??? success "Resposta"
    **C — `PUT`.**

    *Seguro* significa que a requisição não modifica o estado do servidor. *Idempotente* significa que chamá-la várias vezes tem o mesmo efeito que chamá-la uma vez. `PUT /orders/42` com o mesmo corpo pode ser repetido com segurança — o resultado é o mesmo estado do pedido, não importa quantas vezes seja chamado. `POST /orders` criaria um novo pedido a cada chamada (não é idempotente).

---

**Q2.** Um cliente recebe `401 Unauthorized`. O que isso indica especificamente?

- A. O usuário está autenticado, mas não tem o papel ou a permissão necessários
- B. Nenhum token de autenticação válido foi fornecido, ou o token é inválido ou expirou
- C. O recurso solicitado não existe no servidor
- D. O servidor encontrou um erro inesperado ao processar a requisição

??? success "Resposta"
    **B — Nenhum token de autenticação válido.**

    `401` significa "você não está autenticado" — o servidor não sabe quem você é. `403 Forbidden` significa "eu sei quem você é, mas você não tem permissão para fazer isso". Confundir os dois é um erro comum: um JWT ausente deve retornar 401, e não 403.

---

**Q3.** Quais desenhos de URI seguem as convenções REST?

- A. `POST /createOrder` e `GET /getOrderById?id=42`
- B. `GET /orders` e `GET /orders/42`
- C. `GET /order-list` e `DELETE /removeOrder/42`
- D. `POST /orders/create` e `PUT /orders/update/42`

??? success "Resposta"
    **B — `GET /orders` e `GET /orders/42`.**

    URIs REST identificam *recursos* (substantivos), não operações (verbos). Use substantivos no plural para coleções (`/orders`), aninhe para expressar hierarquia (`/orders/42`) e expresse a operação pelo método HTTP (GET, POST, PUT, DELETE) — nunca no caminho.

---

**Q4.** Qual é o código de status HTTP correto quando um `POST` **cria com sucesso** um novo recurso?

- A. `200 OK` — sucesso é sempre 200
- B. `201 Created`, acompanhado de um cabeçalho `Location` apontando para a URI do novo recurso
- C. `202 Accepted` — a criação é enfileirada para processamento assíncrono
- D. `204 No Content` — usado quando o servidor não tem nada a retornar

??? success "Resposta"
    **B — `201 Created` com o cabeçalho `Location`.**

    `200` é para leituras e atualizações bem-sucedidas. `201` sinaliza que um novo recurso foi criado e informa ao cliente onde encontrá-lo, via `Location: /orders/42`. Isso permite que o cliente navegue imediatamente até o novo recurso ou o armazene em cache, sem um GET separado.

---

**Q5.** Por que a **paginação por cursor** é preferível à paginação por offset em grandes volumes de dados?

- A. Cursores são menores do que números de página, reduzindo o payload da requisição
- B. A paginação por offset não é suportada pela especificação HTTP
- C. A paginação por offset exige que o banco de dados pule linhas, o que é custoso em escala e causa deslocamento quando itens são inseridos ou removidos; a paginação por cursor lê para frente a partir de um ponteiro estável
- D. A paginação por cursor permite que o cliente salte diretamente para qualquer página

??? success "Resposta"
    **C — O offset é custoso e sujeito a deslocamento; o cursor lê a partir de um ponteiro estável.**

    `OFFSET 10000 LIMIT 20` obriga o banco de dados a contar e pular 10.000 linhas — lento em tabelas grandes. Se um novo item for inserido na página 3 enquanto o cliente lê a página 4, as linhas se deslocam e o cliente vê duplicatas ou pula itens. Um cursor (por exemplo, `after=eyJpZCI6NDJ9`) codifica o último registro visto e lê para frente exatamente a partir desse ponto, imune a inserções.

---

**Q6.** Qual nível do **Modelo de Maturidade de Richardson** descreve o uso correto dos verbos HTTP e dos códigos de status?

- A. Nível 0 — Swamp of POX (um único endpoint para todas as operações)
- B. Nível 1 — Recursos (URIs separadas por recurso)
- C. Nível 2 — Verbos HTTP (métodos corretos + códigos de status)
- D. Nível 3 — HATEOAS (as respostas incluem links para as próximas ações)

??? success "Resposta"
    **C — Nível 2.**

    O nível 2 acrescenta o uso semântico dos métodos HTTP (`GET` para ler, `POST` para criar, `DELETE` para remover) e códigos de status adequados (`201 Created`, `404 Not Found`, `409 Conflict`). A maioria das APIs REST de produção opera no nível 2. O nível 3 (HATEOAS) acrescenta links de hipermídia e é raro na prática.

---

## OpenAPI e Swagger

**Q7.** O que a biblioteca **springdoc-openapi** gera automaticamente na inicialização?

- A. Uma exportação em PDF de todas as assinaturas de métodos dos controllers
- B. Uma coleção do Postman para testes manuais da API
- C. Um documento OpenAPI, por introspecção dos controllers e das classes de modelo, e um Swagger UI servido em `/swagger-ui.html`
- D. Esqueletos de testes unitários para cada endpoint declarado no código

??? success "Resposta"
    **C — Documento OpenAPI + Swagger UI em `/swagger-ui.html`.**

    O springdoc-openapi lê `@RestController`, `@GetMapping`, `@RequestBody`, `@Schema` e anotações semelhantes na inicialização da aplicação, gera um documento OpenAPI 3 aderente ao padrão em `/v3/api-docs` e serve um Swagger UI interativo — tudo sem escrever YAML manualmente.

---

**Q8.** Onde o Swagger UI deve ser **desabilitado**, e por quê?

- A. Em desenvolvimento — os desenvolvedores devem usar `curl` em vez dele
- B. Em homologação — o ambiente de homologação precisa espelhar exatamente a produção
- C. Em produção — ele expõe toda a superfície de ataque da API a qualquer pessoa que o acesse
- D. Apenas em microsserviços — monólitos podem expor o Swagger UI em produção com segurança

??? success "Resposta"
    **C — Em produção.**

    O Swagger UI oferece um mapa interativo de cada endpoint, parâmetro e esquema de segurança. Um atacante pode usá-lo para enumerar vetores de ataque sem ler o código-fonte. Desabilite-o com `springdoc.swagger-ui.enabled: false` e `springdoc.api-docs.enabled: false` no `application-prod.yml`.

---

**Q9.** Qual é o propósito de `@Schema` em um campo de record Java em um projeto com springdoc-openapi?

- A. Marca o campo como obrigatório para a desserialização do JSON
- B. Mapeia o nome do campo para uma chave JSON diferente na saída serializada
- C. Acrescenta uma descrição legível e um valor de exemplo que aparecem no documento OpenAPI gerado e no Swagger UI
- D. Instrui o validador a rejeitar valores nulos nesse campo

??? success "Resposta"
    **C — Acrescenta descrição e exemplo ao documento OpenAPI.**

    Sem `@Schema`, o springdoc conhece apenas o nome e o tipo do campo. `@Schema(description = "Price in BRL", example = "299.90")` torna a documentação gerada autoexplicativa — os consumidores sabem o que o campo significa e como é um valor válido, sem ler o código-fonte.

---

**Q10.** Para permitir que o Swagger UI envie **requisições autenticadas** com um token JWT Bearer, o que precisa ser configurado?

- A. Adicionar `@Secured` a cada método de controller e incluir o token no corpo da requisição
- B. Habilitar o fallback de autenticação basic do Spring Security no `application.yaml`
- C. Adicionar um `SecurityScheme` do tipo `HTTP`/`bearer` ao bean `OpenAPI` e então usar o botão **Authorize** do Swagger UI para fornecer o token
- D. Configurar `springdoc.swagger-ui.oauth.client-id` com a URL do emissor do JWT

??? success "Resposta"
    **C — `SecurityScheme` do tipo HTTP/bearer + botão Authorize.**

    Adicionar o esquema de segurança ao bean `OpenAPI` faz o springdoc renderizar um botão **Authorize** no Swagger UI. O usuário cola um JWT ali, e todas as requisições seguintes incluem `Authorization: Bearer <token>`. Sem essa configuração, o Swagger UI envia requisições não autenticadas a todos os endpoints protegidos.
