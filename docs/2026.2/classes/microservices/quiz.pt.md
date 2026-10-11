
Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Domain-Driven Design

**Q1.** Qual é o principal propósito de um **Bounded Context** no DDD?

- A. Ele limita o número de entidades que um único serviço pode gerenciar
- B. Ele define a fronteira dentro da qual um modelo de domínio é válido — o mesmo termo pode significar coisas diferentes em contextos diferentes
- C. Ele impõe um tamanho máximo para os agregados dentro do domínio
- D. Ele especifica qual esquema de banco de dados um serviço pode acessar

??? success "Resposta"
    **B — Define a fronteira em que um modelo de domínio é válido.**

    Um `Customer` no contexto de Vendas (limite de crédito, região) é um modelo completamente diferente do `Customer` em Faturamento (CPF/CNPJ, endereço de cobrança). Os bounded contexts permitem que cada time use o termo de forma diferente, sem criar uma classe inchada que não atende bem a nenhum deles. Em microsserviços, um bounded context normalmente corresponde a um serviço.

---

**Q2.** Qual bloco de construção do DDD é o **único ponto de entrada** para todas as modificações nos objetos dentro dele?

- A. Domain Service
- B. Repository
- C. Value Object
- D. Aggregate Root

??? success "Resposta"
    **D — Aggregate Root.**

    O Aggregate Root (raiz do agregado) é o único objeto do qual o código externo guarda uma referência. Todas as mudanças de estado nas entidades filhas e nos objetos de valor dentro do agregado precisam passar pela raiz, que garante as invariantes. Por exemplo, `Order.addItem()` verifica a regra de "no máximo 50 itens" antes de permitir que um novo `OrderItem` seja adicionado.

---

**Q3.** O que distingue uma **Entidade** de um **Objeto de Valor**?

- A. Entidades são imutáveis; Objetos de Valor mudam de estado ao longo do tempo
- B. Uma Entidade tem uma identidade persistente, que sobrevive a mudanças de atributos; um Objeto de Valor é definido inteiramente pelos seus atributos e não tem identidade
- C. Entidades existem apenas em memória; Objetos de Valor são persistidos no banco de dados
- D. Entidades são compartilhadas entre bounded contexts; Objetos de Valor são locais a um contexto

??? success "Resposta"
    **B — A Entidade tem identidade; o Objeto de Valor é definido pelos seus atributos.**

    Dois objetos `Order` com o mesmo ID são o mesmo pedido, mesmo que o status seja diferente (entidade). Dois objetos `Money(10.00, BRL)` são idênticos e intercambiáveis porque têm os mesmos atributos (objeto de valor). Objetos de valor devem ser imutáveis — as operações retornam novas instâncias.

---

**Q4.** No Event Storming, o que os **Eventos de Domínio** (post-its laranja) representam?

- A. Comandos que os usuários enviam ao sistema para disparar mudanças de estado
- B. Chamadas a APIs externas que o sistema faz para serviços de terceiros
- C. Coisas que aconteceram no domínio, expressas no passado, usadas para disparar reações em outros bounded contexts
- D. Regras de negócio que garantem invariantes dentro de um agregado

??? success "Resposta"
    **C — Coisas que aconteceram, no passado.**

    `OrderPlaced`, `PaymentCharged`, `ItemShipped` — eventos de domínio descrevem fatos. São registros imutáveis que outros bounded contexts (Estoque, Notificações, Analytics) assinam e aos quais reagem de forma independente. Isso desacopla os contextos sem exigir chamadas diretas entre eles.

---

**Q5.** De acordo com o mapeamento de DDD para microsserviços, qual é o **ponto de partida** natural para a fronteira de um microsserviço?

- A. Uma tabela do banco de dados — cada tabela vira um microsserviço
- B. Um caso de uso — cada história de usuário corresponde a um serviço
- C. Um time — a Lei de Conway determina que um time = um serviço
- D. Um Bounded Context — a linguagem ubíqua e o modelo são internamente consistentes dentro dessa fronteira

??? success "Resposta"
    **D — Um Bounded Context.**

    O bounded context define uma divisão conceitual em que o modelo é autoconsistente e o time é dono da linguagem ubíqua. Começar por ali (em vez de por tabela ou por caso de uso) produz serviços que podem evoluir de forma independente. Ainda assim, um bounded context é um ponto de partida — restrições operacionais ou de time podem levar a juntar ou dividir serviços.

---

**Q6.** Na Order API, um item de pedido guarda apenas o `id` do produto (mais a quantidade e o total), e não um objeto `Product` completo. Qual regra do DDD isso segue?

- A. Objetos de valor devem ser imutáveis
- B. Agregados referenciam outros agregados apenas pela identidade
- C. Toda entidade precisa do seu próprio repositório
- D. Eventos de domínio devem ser escritos no passado

??? success "Resposta"
    **B — Referenciar outros agregados pela identidade.**

    `Order` e `Product` são agregados diferentes, em bounded contexts (e serviços) diferentes. Guardar apenas o id do produto significa que o agregado do pedido nunca consegue modificar um produto, e os dois podem ser armazenados em bancos de dados diferentes. Isso também combina com o modelo do contexto de Pedidos: o item guarda o preço *pago*, então uma mudança posterior de preço no catálogo não altera os pedidos passados.

---

**Q7.** O serviço de câmbio consome uma API de cotações de terceiros cujo formato JSON ele não controla. Qual padrão do mapa de contexto impede que esse formato se espalhe pelo código do serviço de câmbio?

- A. Shared Kernel
- B. Conformist
- C. Anti-Corruption Layer
- D. Published Language

??? success "Resposta"
    **C — Anti-Corruption Layer.**

    Uma ACL (camada anticorrupção) é uma camada de tradução na fronteira: ela chama o provedor e converte o modelo do provedor para o modelo do próprio serviço (por exemplo, um objeto de valor `Rate`). Se o provedor mudar ou for substituído, só a ACL muda. Um *conformist* adotaria o modelo do provedor como está; um *shared kernel* é código compartilhado por dois times que cooperam, o que é impossível com um terceiro.

---

## Arquitetura de microsserviços

**Q8.** Qual é o principal papel de um **API Gateway** em uma arquitetura de microsserviços?

- A. Ele armazena a configuração compartilhada de todos os microsserviços
- B. Ele atua como um message broker entre os serviços, usando eventos assíncronos
- C. Ele é o único ponto de entrada externo — cuidando de roteamento, autenticação, rate limiting e terminação SSL em nome de todos os serviços
- D. Ele gerencia o ciclo de vida dos containers e reinicia os serviços que falharam

??? success "Resposta"
    **C — Único ponto de entrada externo.**

    O gateway é o único serviço exposto à internet. Os serviços internos nunca recebem tráfego externo diretamente. Ao centralizar as preocupações transversais (autenticação, rate limiting, SSL, logs), o gateway permite que os microsserviços de negócio se concentrem inteiramente na sua lógica de domínio.

---

**Q9.** Por que cada microsserviço é dono do **seu próprio banco de dados** (padrão database-per-service)?

- A. Reduz o custo de infraestrutura, usando bancos de dados menores e mais baratos
- B. É exigido pela especificação OpenAPI
- C. Garante que os serviços possam evoluir o seu esquema de forma independente, sem acoplamento aos modelos de dados de outros serviços
- D. Impede que os serviços leiam os dados uns dos outros, melhorando a segurança

??? success "Resposta"
    **C — Evolução independente do esquema.**

    Um banco de dados compartilhado cria um acoplamento oculto: mudar uma tabela que pertence ao Serviço A pode quebrar o Serviço B, que também a lê. Com database-per-service, o esquema de cada serviço é um detalhe privado da sua implementação. Os serviços se comunicam por APIs, nunca por tabelas compartilhadas.

---

**Q10.** Qual é o principal trade-off entre a comunicação **síncrona (HTTP)** e a **assíncrona (mensageria)** entre serviços?

- A. A síncrona é mais segura; a assíncrona é menos segura
- B. A síncrona dá resultados imediatos, mas cria acoplamento temporal; a assíncrona desacopla os serviços, mas o produtor não recebe um resultado imediato
- C. A assíncrona é sempre melhor — a síncrona nunca deveria ser usada em microsserviços
- D. A síncrona usa mais CPU; a assíncrona usa mais memória

??? success "Resposta"
    **B — Síncrona = resultado imediato, acoplamento temporal; assíncrona = desacoplada, sem resultado imediato.**

    Se o serviço de Pedidos chama o serviço de Estoque de forma síncrona e o Estoque está fora do ar, Pedidos também fica quebrado. Com mensageria assíncrona, Pedidos publica um evento `OrderPlaced` e segue em frente; o Estoque o processa quando se recuperar. Use comunicação síncrona quando quem chama precisa do resultado imediatamente (por exemplo, validação de autenticação); use assíncrona quando a consistência estrita não é necessária (por exemplo, enviar o e-mail de confirmação).

---

**Q11.** Que problema a **Descoberta de Serviços** (*Service Discovery*) resolve em um ambiente dinâmico de microsserviços?

- A. Impede que dois serviços sejam implantados com o mesmo nome
- B. Permite que os serviços encontrem dinamicamente a localização de rede atual uns dos outros, já que os endereços IP mudam à medida que as instâncias escalam para cima ou para baixo
- C. Monitora os health checks e reinicia os serviços não saudáveis
- D. Roteia o tráfego externo para o microsserviço correto com base no caminho da URL

??? success "Resposta"
    **B — Encontrar a localização de rede atual de instâncias dinâmicas.**

    Em um ambiente containerizado, instâncias são criadas e destruídas o tempo todo, e os seus endereços IP mudam a cada reinício. Um registro de serviços (Consul, Eureka, DNS do Kubernetes) mantém a localização atual de todas as instâncias. Os serviços se registram ao iniciar e se descadastram ao desligar, e quem chama consulta o registro para encontrá-los.

---

**Q12.** Na arquitetura de referência do curso, quem é responsável por **validar os tokens JWT** em cada requisição?

- A. Cada microsserviço de negócio valida o token de forma independente em toda requisição
- B. O provedor de identidade revalida o token em toda requisição, por meio de um callback
- C. O Gateway delega a validação ao Auth Service e repassa a identidade de quem chamou no header `id-account`; os microsserviços de negócio confiam nesse header sem revalidar
- D. O balanceador de carga valida os tokens antes de repassar as requisições ao gateway

??? success "Resposta"
    **C — O Gateway delega ao Auth Service; os serviços de negócio confiam no header `id-account`.**

    O `AuthorizationFilter` do gateway intercepta toda requisição para uma rota protegida, lê o JWT do cookie, chama `POST /auth/solve` no Auth Service e repassa a identidade resolvida no header `id-account` para o serviço de destino. Os microsserviços de negócio confiam nesse header sem chamar o Auth Service por conta própria, o que mantém cada serviço focado no seu domínio. Isso só é seguro porque os serviços não são acessíveis de fora: um serviço exposto diretamente poderia receber um `id-account` forjado.

---

**Q13.** Uma requisição de checkout passa de forma síncrona por três serviços, cada um disponível 99,9% do tempo. Aproximadamente qual é a disponibilidade do checkout como um todo?

- A. 99,9% — a cadeia é tão disponível quanto cada serviço
- B. 99,97% — a redundância entre três serviços aumenta a disponibilidade
- C. 99,7% — as disponibilidades se multiplicam (0,999³), praticamente triplicando a indisponibilidade
- D. 97% — cada salto remove um ponto percentual

??? success "Resposta"
    **C — cerca de 99,7%.**

    Em uma cadeia síncrona, a requisição só tem sucesso se *todos* os serviços estiverem no ar, então as disponibilidades se multiplicam: 0,999 × 0,999 × 0,999 ≈ 0,997. A indisponibilidade cresce de cerca de 8,8 horas por ano para cerca de 26 horas. É por isso que cadeias síncronas longas são evitadas, e que o trabalho que não precisa de resposta imediata é movido para eventos.

---

**Q14.** Qual situação é um sintoma de um **monólito distribuído**?

- A. O serviço de câmbio é escrito em Python e os demais em Java
- B. Os serviços de produtos e de pedidos precisam sempre ser implantados no mesmo dia, porque o serviço de pedidos lê as tabelas de produtos diretamente
- C. O serviço de pedidos publica `OrderCreated` no Kafka e não sabe quem o consome
- D. O gateway roda três réplicas atrás do Nginx

??? success "Resposta"
    **B — Deploys coordenados causados por tabelas compartilhadas.**

    Um monólito distribuído tem os custos de rede dos microsserviços sem a sua independência: os serviços compartilham dados ou são tão acoplados que precisam ser lançados juntos. A é *governança descentralizada*, C é um desacoplamento assíncrono saudável e D é a escalabilidade horizontal do ponto de entrada.
