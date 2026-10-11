
Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Domain-Driven Design

**Q1.** Qual é o propósito principal de um **Contexto Delimitado** (Bounded Context) no DDD?

- A. Limitar o número de entidades que um único serviço pode gerenciar
- B. Definir a fronteira dentro da qual um modelo de domínio é válido — o mesmo termo pode significar coisas diferentes em contextos diferentes
- C. Impor um tamanho máximo para os agregados dentro do domínio
- D. Especificar qual esquema de banco de dados um serviço pode acessar

??? success "Resposta"
    **B — Define a fronteira em que um modelo de domínio é válido.**

    Um `Customer` no contexto de Vendas (limite de crédito, região) é um modelo completamente diferente do `Customer` em Faturamento (CPF/CNPJ, endereço de cobrança). Os contextos delimitados permitem que cada time use o termo de forma diferente, sem criar uma classe inchada que não atende bem a nenhum deles. Em microsserviços, um contexto delimitado normalmente corresponde a um serviço.

---

**Q2.** Qual bloco de construção do DDD é o **único ponto de entrada** para todas as modificações nos objetos que ele contém?

- A. Serviço de domínio
- B. Repositório
- C. Objeto de valor
- D. Raiz do agregado

??? success "Resposta"
    **D — Raiz do agregado.**

    A raiz do agregado é o único objeto para o qual o código externo mantém uma referência. Todas as mudanças de estado nas entidades filhas e nos objetos de valor dentro do agregado precisam passar pela raiz, que garante as invariantes. Por exemplo, `Order.addItem()` verifica a regra de "no máximo 50 itens" antes de permitir que um novo `OrderItem` seja adicionado.

---

**Q3.** O que distingue uma **Entidade** de um **Objeto de valor**?

- A. Entidades são imutáveis; objetos de valor mudam de estado ao longo do tempo
- B. Uma entidade tem uma identidade persistente que sobrevive a mudanças de atributos; um objeto de valor é definido inteiramente pelos seus atributos e não tem identidade
- C. Entidades existem apenas em memória; objetos de valor são persistidos no banco de dados
- D. Entidades são compartilhadas entre contextos delimitados; objetos de valor são locais a um contexto

??? success "Resposta"
    **B — A entidade tem identidade; o objeto de valor é definido pelos seus atributos.**

    Dois objetos `Order` com o mesmo ID são o mesmo pedido, ainda que seus status sejam diferentes (entidade). Dois objetos `Money(10.00, BRL)` são idênticos e intercambiáveis porque têm os mesmos atributos (objeto de valor). Objetos de valor devem ser imutáveis — as operações retornam novas instâncias.

---

**Q4.** No Event Storming, o que os **Eventos de domínio** (post-its laranja) representam?

- A. Comandos que os usuários enviam ao sistema para disparar mudanças de estado
- B. Chamadas a APIs externas que o sistema faz para serviços de terceiros
- C. Coisas que aconteceram no domínio, expressas no passado, usadas para disparar reações em outros contextos delimitados
- D. Regras de negócio que garantem as invariantes dentro de um agregado

??? success "Resposta"
    **C — Coisas que aconteceram, no passado.**

    `OrderPlaced`, `PaymentCharged`, `ItemShipped` — eventos de domínio descrevem fatos. São registros imutáveis que outros contextos delimitados (Estoque, Notificações, Analytics) assinam e aos quais reagem de forma independente. Isso desacopla os contextos sem exigir chamadas diretas entre eles.

---

**Q5.** De acordo com o mapeamento de DDD para microsserviços, qual é o **ponto de partida** natural para a fronteira de um microsserviço?

- A. Uma tabela do banco de dados — cada tabela vira um microsserviço
- B. Um caso de uso — cada história de usuário corresponde a um serviço
- C. Um time — a Lei de Conway determina que um time = um serviço
- D. Um contexto delimitado — a linguagem ubíqua e o modelo são internamente consistentes dentro dessa fronteira

??? success "Resposta"
    **D — Um contexto delimitado.**

    O contexto delimitado define um ponto de corte conceitual em que o modelo é autoconsistente e o time é dono da linguagem ubíqua. Começar por ele (e não por tabela ou caso de uso) produz serviços que podem evoluir de forma independente. No entanto, um contexto delimitado é um ponto de partida — restrições operacionais ou dos times podem levar a juntar ou dividir serviços.

---

## Arquitetura de microsserviços

**Q6.** Qual é o papel principal de um **API Gateway** em uma arquitetura de microsserviços?

- A. Armazenar a configuração compartilhada de todos os microsserviços
- B. Atuar como broker de mensagens entre os serviços usando eventos assíncronos
- C. Ser o ponto único de entrada externo — tratando roteamento, autenticação, limitação de taxa e terminação SSL em nome de todos os serviços
- D. Gerenciar o ciclo de vida dos containers e reiniciar os serviços que falharam

??? success "Resposta"
    **C — Ponto único de entrada externo.**

    O gateway é o único serviço exposto à internet. Os serviços internos nunca recebem tráfego externo diretamente. Ao centralizar as preocupações transversais (autenticação, limitação de taxa, SSL, logs), o gateway permite que os microsserviços de negócio se concentrem inteiramente na lógica do seu domínio.

---

**Q7.** Por que cada microsserviço é dono do **seu próprio banco de dados** (padrão database-per-service)?

- A. Reduz o custo de infraestrutura usando bancos de dados menores e mais baratos
- B. É exigido pela especificação OpenAPI
- C. Garante que os serviços possam evoluir seu esquema de forma independente, sem acoplamento aos modelos de dados de outros serviços
- D. Impede que os serviços leiam os dados uns dos outros, melhorando a segurança

??? success "Resposta"
    **C — Evolução independente do esquema.**

    Um banco de dados compartilhado cria um acoplamento oculto: alterar uma tabela que pertence ao Serviço A pode quebrar o Serviço B, que também a lê. Com database-per-service, o esquema de cada serviço é um detalhe privado de implementação. Os serviços se comunicam por meio de APIs, nunca por tabelas compartilhadas.

---

**Q8.** Qual é o principal trade-off entre a comunicação entre serviços **síncrona (HTTP)** e **assíncrona (mensageria)**?

- A. A síncrona é mais segura; a assíncrona é menos segura
- B. A síncrona dá resultados imediatos, mas cria acoplamento temporal; a assíncrona desacopla os serviços, mas quem chama não pode esperar por um resultado
- C. A assíncrona é sempre melhor — a síncrona nunca deveria ser usada em microsserviços
- D. A síncrona usa mais CPU; a assíncrona usa mais memória

??? success "Resposta"
    **B — Síncrona = resultado imediato, acoplamento temporal; assíncrona = desacoplada, sem resultado imediato.**

    Se o serviço de Pedidos chama o serviço de Estoque de forma síncrona e o Estoque está fora do ar, Pedidos também fica quebrado. Com mensageria assíncrona, Pedidos publica um evento `OrderPlaced` e segue em frente; o Estoque o processa quando se recuperar. Use comunicação síncrona quando quem chama precisa do resultado imediatamente (por exemplo, validação de autenticação); use assíncrona quando a consistência estrita não é necessária (por exemplo, enviar o e-mail de confirmação).

---

**Q9.** Que problema a **descoberta de serviços** resolve em um ambiente dinâmico de microsserviços?

- A. Impede que dois serviços sejam implantados com o mesmo nome
- B. Permite que os serviços encontrem dinamicamente a localização de rede atual uns dos outros, já que os endereços IP mudam à medida que as instâncias sobem ou descem
- C. Monitora health checks e reinicia os serviços não saudáveis
- D. Roteia o tráfego externo para o microsserviço correto com base no caminho da URL

??? success "Resposta"
    **B — Encontrar a localização de rede atual de instâncias dinâmicas.**

    Em um ambiente containerizado, instâncias são criadas e destruídas o tempo todo, e seus endereços IP mudam a cada reinício. Um registro de serviços (Consul, Eureka, DNS do Kubernetes) mantém a localização atual de todas as instâncias. Os serviços se registram ao iniciar e se descadastram ao encerrar, e quem chama consulta o registro para encontrá-los.

---

**Q10.** Na arquitetura de referência do curso, quem é responsável por **validar os tokens JWT** em cada requisição?

- A. Cada microsserviço de negócio valida o token de forma independente a cada requisição
- B. O provedor de identidade revalida o token a cada requisição por meio de um callback
- C. O gateway delega a validação ao Serviço de Auth; os microsserviços de negócio confiam nas claims do JWT encaminhado, sem revalidar
- D. O balanceador de carga valida os tokens antes de repassar as requisições ao gateway

??? success "Resposta"
    **C — O gateway delega ao Serviço de Auth; os serviços de negócio confiam nas claims encaminhadas.**

    O gateway intercepta cada requisição, chama o Serviço de Auth para validar o JWT e então encaminha a identidade resolvida (por exemplo, no cabeçalho `X-Account-Id`) ao serviço downstream. Os microsserviços de negócio confiam nesses cabeçalhos sem chamar o Serviço de Auth por conta própria, o que mantém cada serviço focado no seu domínio.
