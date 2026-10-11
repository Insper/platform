
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

    *Seguro* significa que a requisição não modifica o estado do servidor. *Idempotente* significa que chamá-la várias vezes tem o mesmo efeito que chamá-la uma vez. `PUT /orders/42` com o mesmo corpo pode ser repetido livremente — o resultado é o mesmo estado do pedido, não importa quantas vezes seja chamado, mas a primeira chamada mudou o estado, então ele não é *seguro*. `POST /orders` criaria um novo pedido a cada chamada (não é idempotente).

---

**Q2.** Um cliente recebe `401 Unauthorized`. O que isso indica especificamente?

- A. O usuário está autenticado, mas não tem o papel ou a permissão necessária
- B. Nenhum token de autenticação válido foi enviado, ou o token é inválido ou expirou
- C. O recurso solicitado não existe no servidor
- D. O servidor encontrou um erro inesperado ao processar a requisição

??? success "Resposta"
    **B — Nenhum token de autenticação válido.**

    `401` significa "você não está autenticado" — o servidor não sabe quem você é. `403 Forbidden` significa "eu sei quem você é, mas você não tem permissão para fazer isso". Confundir os dois é um erro comum: um JWT ausente deve retornar 401, não 403.

---

**Q3.** Quais designs de URI seguem as convenções REST?

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
- C. `202 Accepted` — a criação foi enfileirada para processamento assíncrono
- D. `204 No Content` — usado quando o servidor não tem nada a retornar

??? success "Resposta"
    **B — `201 Created` com o cabeçalho `Location`.**

    `200` é para leituras e atualizações bem-sucedidas. `201` sinaliza que um novo recurso foi criado e informa ao cliente onde encontrá-lo, via `Location: /orders/42`. Isso permite que o cliente navegue imediatamente até o novo recurso ou o armazene em cache, sem um GET separado.

---

**Q5.** Por que a **paginação por cursor** é preferível à paginação por offset em grandes volumes de dados?

- A. Cursores são menores que números de página, o que reduz o payload da requisição
- B. A paginação por offset não é suportada pela especificação HTTP
- C. A paginação por offset obriga o banco de dados a pular linhas, o que é caro em escala e causa deslocamentos quando itens são inseridos ou removidos; a paginação por cursor lê para frente a partir de um ponteiro estável
- D. A paginação por cursor permite que o cliente salte diretamente para qualquer página

??? success "Resposta"
    **C — O offset é caro e sujeito a deslocamentos; o cursor lê a partir de um ponteiro estável.**

    `OFFSET 10000 LIMIT 20` obriga o banco de dados a contar e pular 10.000 linhas — lento em tabelas grandes. Se um novo item for inserido na página 3 enquanto o cliente lê a página 4, as linhas se deslocam e o cliente vê itens duplicados ou pula itens. Um cursor (por exemplo, `after=eyJpZCI6NDJ9`) codifica o último registro visto e lê para frente exatamente a partir desse ponto (`WHERE id > :last`), usando o índice e imune a inserções. A opção D está errada: saltar para uma página arbitrária é justamente o que os cursores *não* conseguem fazer.

---

**Q6.** Qual nível do **Modelo de Maturidade de Richardson** descreve o uso correto dos verbos HTTP e dos códigos de status?

- A. Nível 0 — Swamp of POX (um único endpoint para todas as operações)
- B. Nível 1 — Recursos (URIs separadas por recurso)
- C. Nível 2 — Verbos HTTP (métodos corretos + códigos de status)
- D. Nível 3 — HATEOAS (as respostas incluem links para as próximas ações)

??? success "Resposta"
    **C — Nível 2.**

    O nível 2 acrescenta o uso semântico dos métodos HTTP (`GET` para ler, `POST` para criar, `DELETE` para remover) e códigos de status adequados (`201 Created`, `404 Not Found`, `409 Conflict`). A maioria das APIs REST em produção opera no nível 2. O nível 3 (HATEOAS) acrescenta links de hipermídia e é raro na prática.

---

**Q7.** Um cliente chama `DELETE /products/42` e recebe `204`. A resposta a uma repetição da mesma requisição é `404 Not Found`. O `DELETE` continua idempotente?

- A. Não — requisições idempotentes precisam sempre retornar a mesma resposta
- B. Sim — idempotência diz respeito ao efeito no estado do servidor: depois de uma chamada ou de várias, o produto 42 não existe
- C. Não — o servidor deveria ter retornado `204` de novo para ser idempotente
- D. Só se o cliente enviar um cabeçalho `Idempotency-Key`

??? success "Resposta"
    **B — Idempotência diz respeito ao estado, não à resposta.**

    A RFC 9110 define os métodos idempotentes pelo *efeito pretendido no servidor*. O segundo `DELETE` não encontra nada para excluir, então `404` é uma resposta correta e o estado não muda. Um cliente que repete um `DELETE` deve tratar o `404` como sucesso.

---

**Q8.** Um aplicativo mobile envia `POST /orders`, a conexão cai e o aplicativo não sabe se o pedido foi criado. Qual design permite que ele repita a requisição **sem criar um pedido duplicado**?

- A. Trocar o endpoint para `GET /orders/create`, já que `GET` é idempotente
- B. Repetir imediatamente, quantas vezes forem necessárias, até chegar uma resposta
- C. Enviar um cabeçalho `Idempotency-Key` gerado pelo cliente; o servidor armazena as chaves processadas e devolve o resultado armazenado quando uma chave se repete
- D. Retornar `202 Accepted` em vez de `201 Created`

??? success "Resposta"
    **C — Chave de idempotência.**

    A chave identifica a operação *lógica*. A primeira requisição cria o pedido e registra a chave; a repetição encontra a chave e devolve o mesmo pedido em vez de criar outro. A opção A quebra a semântica do HTTP (`GET` não pode mudar o estado), a B cria duplicatas, e a D muda o código de status, mas não resolve o problema da duplicação.

---

**Q9.** O serviço de produtos é consumido pelo front-end web e pelo serviço de pedidos. Qual mudança é **incompatível** (breaking) e, portanto, exige uma nova versão da API?

- A. Adicionar um novo campo opcional `description` a `ProductIn`
- B. Adicionar um novo campo `category` a `ProductOut`
- C. Adicionar um novo endpoint `GET /products/search`
- D. Renomear o campo de resposta `price` para `unitPrice`

??? success "Resposta"
    **D — Renomear um campo da resposta.**

    Os clientes existentes continuam lendo `price` e agora não recebem nada. Adicionar endpoints, campos opcionais na requisição ou campos na resposta é retrocompatível, desde que os clientes sejam *leitores tolerantes* (tolerant readers), que ignoram campos desconhecidos. Uma mudança incompatível vai para uma nova versão (`/v2/products`), com um período de descontinuação para a `/v1`.

---

## OpenAPI & Swagger

**Q10.** O que a biblioteca **springdoc-openapi** gera automaticamente na inicialização?

- A. Uma exportação em PDF de todas as assinaturas de métodos dos controllers
- B. Uma coleção do Postman para testes manuais da API
- C. Um documento OpenAPI, por introspecção dos controllers e das classes de modelo, e um Swagger UI servido em `/swagger-ui.html`
- D. Esqueletos de testes unitários para cada endpoint declarado no código

??? success "Resposta"
    **C — Documento OpenAPI + Swagger UI em `/swagger-ui.html`.**

    O springdoc-openapi lê `@RestController`, `@GetMapping`, `@RequestBody`, `@Schema` e anotações semelhantes na inicialização da aplicação, gera um documento OpenAPI 3 conforme o padrão em `/v3/api-docs` e serve um Swagger UI interativo — tudo sem escrever YAML à mão.

---

**Q11.** Onde o Swagger UI deve ser **desabilitado**, e por quê?

- A. Em desenvolvimento — os desenvolvedores devem usar `curl`
- B. Em staging — o ambiente de staging precisa espelhar exatamente a produção
- C. Em produção — ele expõe toda a superfície de ataque da API a qualquer um que o acesse
- D. Apenas em microsserviços — monólitos podem expor o Swagger UI em produção com segurança

??? success "Resposta"
    **C — Em produção.**

    O Swagger UI oferece um mapa interativo de cada endpoint, parâmetro e esquema de segurança. Um atacante pode usá-lo para enumerar vetores de ataque sem ler o código-fonte. Desabilite-o com `springdoc.swagger-ui.enabled: false` e `springdoc.api-docs.enabled: false` no `application-prod.yml`.

---

**Q12.** Qual é a finalidade de `@Schema` em um campo de um record Java em um projeto com springdoc-openapi?

- A. Marca o campo como obrigatório para a desserialização do JSON
- B. Mapeia o nome do campo para uma chave JSON diferente na saída serializada
- C. Adiciona uma descrição legível e um valor de exemplo que aparecem no documento OpenAPI gerado e no Swagger UI
- D. Instrui o validador a rejeitar valores nulos nesse campo

??? success "Resposta"
    **C — Adiciona descrição e exemplo ao documento OpenAPI.**

    Sem `@Schema`, o springdoc só conhece o nome e o tipo do campo. `@Schema(description = "Unit price", example = "10.12")` torna a documentação gerada autoexplicativa — os consumidores sabem o que o campo significa e como é um valor válido, sem ler o código-fonte.

---

**Q13.** Para permitir que o Swagger UI envie **requisições autenticadas** com um token JWT Bearer, o que precisa ser configurado?

- A. Adicionar `@Secured` a cada método de controller e incluir o token no corpo da requisição
- B. Habilitar o fallback de basic auth do Spring Security no `application.yaml`
- C. Adicionar um `SecurityScheme` do tipo `HTTP`/`bearer` ao bean `OpenAPI` e, depois, usar o botão **Authorize** no Swagger UI para fornecer o token
- D. Configurar `springdoc.swagger-ui.oauth.client-id` com a URL do emissor do JWT

??? success "Resposta"
    **C — `SecurityScheme` do tipo HTTP/bearer + botão Authorize.**

    Adicionar o esquema de segurança ao bean `OpenAPI` faz o springdoc renderizar um botão **Authorize** no Swagger UI. O usuário cola um JWT ali, e todas as requisições seguintes incluem `Authorization: Bearer <token>`. Sem essa configuração, o Swagger UI envia requisições não autenticadas a todos os endpoints protegidos.

---

**Q14.** Em um documento OpenAPI 3, onde são definidos os modelos de dados reutilizáveis (como `ProductOut`), para que várias respostas possam referenciá-los com `$ref`?

- A. `info`
- B. `servers`
- C. `paths./products/{id}.get.parameters`
- D. `components.schemas`

??? success "Resposta"
    **D — `components.schemas`.**

    `paths` descreve os endpoints; cada resposta aponta para um modelo com `$ref: "#/components/schemas/ProductOut"`, de modo que o modelo é definido uma única vez. `info` guarda o título e a versão, `servers` as URLs base, e `parameters` as entradas de caminho, query, cabeçalho e cookie de uma operação. O springdoc constrói `components.schemas` a partir dos seus records de DTO.
