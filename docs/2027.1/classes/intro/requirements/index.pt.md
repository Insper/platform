
Dois engenheiros da BoxOffice recebem o mesmo pedido da equipe de produto: *"Precisamos de uma plataforma de ingressos rápida, escalável e confiável."* O primeiro começa a desenhar caixas. O segundo pergunta: *Quantos eventos por mês? Quantos fãs no pico de uma abertura de vendas? O que significa "rápido" — para navegar ou para pagar? Podemos algum dia vender o mesmo lugar duas vezes? O que acontece se o provedor de pagamentos cair?* Três meses depois, o primeiro engenheiro tem uma bela arquitetura para o problema errado. O segundo tem um diagrama menos impressionante, que sobrevive às 10:00 de sexta-feira.

Requisitos são a entrada de todo design. Um design só pode ser julgado em relação a eles: "esta é uma boa arquitetura?" é uma pergunta sem resposta; "esta arquitetura mantém o p99 do checkout abaixo de 1,5 s com 60.000 lugares e 2 milhões de fãs, sem venda duplicada, por menos de R$ 40 mil por mês?" é uma pergunta que você pode testar.

---

## Dois tipos de requisito { #two-kinds-of-requirements }

| | Requisitos funcionais | Requisitos não funcionais |
|---|---|---|
| **Descrevem** | *o que* o sistema faz — funcionalidades, comportamentos | *quão bem* ele faz — qualidades e restrições |
| **Forma típica** | "Um fã pode reservar até 6 lugares por 10 minutos" | "Reservas de lugares terminam em menos de 300 ms (p99) com 5.000 reservas/s" |
| **Respondidos por** | casos de uso, APIs, modelo de dados | arquitetura: componentes, replicação, cache, filas |
| **Se faltarem** | o sistema faz a coisa errada | o sistema faz a coisa certa — para 10 usuários, num dia bom |
| **Também chamados** | funcionalidades, requisitos comportamentais | atributos de qualidade, "-idades", RNFs |

Os requisitos funcionais decidem **quais APIs e dados** existem. Os não funcionais decidem **qual arquitetura** os entrega. Em design de sistemas, o lado não funcional comanda quase todas as decisões: a mesma funcionalidade "vender um ingresso" pode ser uma única tabela do PostgreSQL para um teatro de 200 lugares, ou uma sala de espera, um inventário particionado e um event stream para um estádio.

---

## Requisitos funcionais { #functional-requirements }

Comece pelos **atores** (quem usa o sistema) e seus **objetivos**. Para a BoxOffice:

| Ator | Objetivos |
|---|---|
| **Fã** | navegar e buscar eventos; ver o mapa de lugares; reservar lugares; pagar; receber o ingresso; transferir ou cancelar |
| **Organizador** | criar um evento; configurar setores e preços do local; agendar a abertura das vendas; acompanhar as vendas ao vivo |
| **Equipe do local** | validar ingressos no portão (QR code), mesmo com rede ruim |
| **Suporte** | responder às dúvidas dos fãs (com ajuda do assistente de IA); emitir reembolsos |
| **Sistemas externos** | o provedor de pagamentos confirma ou recusa cobranças; provedores de e-mail/push entregam mensagens |

Depois, transforme os objetivos numa lista curta e priorizada. Na prática — e numa entrevista — você não consegue projetar tudo, então escolhe o **caminho principal** e diz explicitamente o que fica fora do escopo:

!!! example "BoxOffice — requisitos funcionais (primeira versão)"

    **No escopo (caminho principal)**

    1. Fãs **navegam e buscam** eventos por cidade, data, artista e categoria.
    2. Fãs veem o **mapa de lugares** com a disponibilidade ao vivo de um evento.
    3. Fãs **reservam** até 6 lugares; uma reserva (*hold*) expira após 10 minutos se não for paga.
    4. Fãs **pagam** por meio de um provedor de pagamentos externo; uma reserva paga vira um **pedido** com **ingressos**.
    5. Fãs **recebem** os ingressos por e-mail e no app.
    6. Organizadores **criam eventos** e **agendam aberturas de venda**.

    **Fora do escopo (por enquanto)**: marketplace de revenda, preço dinâmico, programa de fidelidade, modo offline de validação no portão, o assistente de IA (acrescentado na aula 13).

Uma boa forma de verificar se um requisito funcional está completo é esboçar sua API. Se você não consegue escrever a requisição e a resposta, o requisito ainda está vago:

```http
GET  /events?city=sao-paulo&from=2027-03-01&q=rock      → 200 [ {eventId, name, venue, date, minPrice} ]
GET  /events/{eventId}/seats                            → 200 { sections: [...], available: [...] }
POST /events/{eventId}/holds   { seatIds: [...] }       → 201 { holdId, expiresAt }   | 409 seat taken
POST /orders                   { holdId, paymentToken } → 201 { orderId, status }     | 402 declined
GET  /orders/{orderId}                                  → 200 { status, tickets: [...] }
```

Você vai detalhar APIs e modelos de dados na [aula 5](../../compute/index.md) e na [aula 6](../../databases/index.md); nesta etapa o objetivo é apenas tornar o escopo concreto.

---

## Requisitos não funcionais: os atributos de qualidade { #non-functional-requirements-the-quality-attributes }

Requisitos não funcionais descrevem **qualidades** do sistema. A literatura de arquitetura de software os chama de **atributos de qualidade**[^1] (a ISO/IEC 25010 padroniza uma longa lista deles[^2]). Para design de sistemas, oito carregam a maior parte do peso:

| Atributo de qualidade | Pergunta que responde | Como medir | Meta da BoxOffice (premissa) | Componentes da paleta que ajudam |
|---|---|---|---|---|
| **Escalabilidade** | Dá conta de mais carga acrescentando recursos? | throughput máximo sustentável dentro da meta de latência | 2 M de fãs chegando em 1 min numa abertura de vendas; 1.500 req/s no catálogo num dia normal | Load Balancer, réplicas de App Server, Cache, CDN, Queue, partições NoSQL |
| **Disponibilidade** | Está no ar quando os usuários precisam? | % de requisições bem-sucedidas numa janela | 99,95% para o checkout em janela móvel de 28 dias | réplicas, Health Check, multi-AZ, failover por DNS |
| **Latência** | Quanto tempo o usuário espera? | percentis (p50, p99) do tempo de resposta | catálogo p99 < 200 ms; reserva p99 < 300 ms; checkout p99 < 1,5 s | Cache, CDN, trabalho assíncrono, índices |
| **Consistência** | Todos os leitores veem o mesmo dado, o mais recente? | anomalias permitidas (leituras desatualizadas, escritas duplicadas) | um lugar é vendido **no máximo uma vez**; o catálogo pode ter 60 s de atraso | transações SQL, líder único, consenso |
| **Durabilidade** | Um dado confirmado pode se perder? | eventos de perda de dados; RPO | zero pedidos confirmados perdidos; RPO = 0 para pedidos | replicação, backups, Object Store |
| **Custo** | Quanto custa para rodar? | dinheiro por mês; custo por unidade de negócio | < R$ 0,10 de infraestrutura por ingresso vendido | dimensionamento correto, autoscaling, Serverless, descarga na CDN |
| **Segurança** | Está protegido contra uso indevido e ataques? | ameaças mitigadas; achados de auditoria | nenhum dado de cartão armazenado (escopo PCI minimizado); robôs bloqueados | WAF, Auth Service, API Gateway, VPC, Safety Mesh |
| **Operabilidade** | A equipe consegue rodar, mudar e consertar? | MTTR, frequência de deploys, qualidade dos alertas | deploy diário sem indisponibilidade; MTTR < 30 min | Metrics, Logs, Tracing, Alerting, CI/CD |

O restante desta seção dá a cada atributo um significado preciso — "escalável" e "disponível" são usados de forma vaga no dia a dia, e palavras vagas geram requisitos ruins.

### Escalabilidade { #scalability }

**Escalabilidade** é a capacidade de lidar com **mais carga** acrescentando recursos, mantendo um desempenho aceitável. Não é uma propriedade sim/não: "é escalável?" não tem sentido até você dizer **qual parâmetro de carga** cresce e **quanto**[^3]. Na BoxOffice, os parâmetros de carga diferem de uma parte do sistema para outra:

- *catalog*: visualizações de página por segundo (dominado por leituras, altamente cacheável);
- *inventory*: reservas de lugares por segundo **num único evento** (dominado por escritas, todas nas mesmas linhas quentes);
- *notification*: e-mails por minuto depois de uma abertura de vendas (em rajadas, podem atrasar).

Cada um escala com uma técnica diferente: cache e CDN para o primeiro, particionamento e sala de espera para o segundo, fila e workers para o terceiro. Existem duas direções, e você usará as duas:

- **Escala vertical** (*scale up*): uma máquina maior. Simples, sem mudar o código, mas limitada pela maior máquina que você consegue comprar, e ainda um ponto único de falha.
- **Escala horizontal** (*scale out*): mais máquinas. Praticamente ilimitada para componentes sem estado, mas exige um load balancer, servidores sem estado e — para os dados — particionamento e replicação.

### Disponibilidade { #availability }

**Disponibilidade** é a fração do tempo (ou das requisições) em que o sistema atende os usuários corretamente. Ela é expressa em "noves" e **sempre numa janela**: 99,9% em janela móvel de 28 dias permite cerca de 40 minutos de indisponibilidade; 99,99% permite cerca de 4 minutos. Cada nove a mais custa muito mais que o anterior — a [aula 2](../../estimation/availability-math/index.md) dá a matemática, e a [aula 10](../../reliability/index.md), a engenharia.

A disponibilidade também não é uniforme: a BoxOffice convive com o widget de recomendações fora do ar por uma hora, mas não com o checkout fora do ar durante uma abertura de vendas.

### Latência (e throughput) { #latency-and-throughput }

**Latência** (tempo de resposta) é quanto tempo uma requisição leva, vista pelo cliente. **Throughput** é quantas requisições por segundo o sistema conclui. Os dois estão ligados — perto da saturação, a latência explode ([aula 2](../../estimation/queueing/index.md)) —, então uma meta de latência só faz sentido **para um dado throughput**.

Sempre expresse a latência como um **percentil**, não como uma média: "p99 < 300 ms" significa que 99% das requisições terminam em menos de 300 ms. Médias escondem as requisições lentas de que os usuários se lembram ([percentis e latência de cauda](../../estimation/percentiles/index.md)). Pesquisas clássicas de usabilidade dão âncoras úteis para metas *voltadas ao usuário*: cerca de **0,1 s** parece instantâneo, cerca de **1 s** mantém o fluxo de pensamento do usuário e, além de cerca de **10 s**, os usuários perdem a atenção[^4].

### Consistência { #consistency }

**Consistência** (no sentido de design de sistemas) diz respeito ao **que os leitores veem depois de uma escrita**. Com **consistência forte**, uma vez que uma escrita é confirmada, toda leitura seguinte a enxerga — o sistema se comporta como se houvesse uma única cópia do dado. Com **consistência eventual**, as réplicas podem discordar por um tempo, mas convergem se as escritas pararem.

A ideia-chave é que **nem todo dado precisa da mesma consistência**:

| Dado da BoxOffice | Consistência necessária | Por quê |
|---|---|---|
| Estado do lugar (livre / reservado / vendido) | **forte** | dois fãs nunca podem comprar o mesmo lugar |
| Status do pedido e do pagamento | forte (por pedido) | um fã precisa ver "pago" depois de pagar |
| Descrição do evento, preços mostrados nas listagens | eventual (segundos a um minuto) | uma descrição um pouco desatualizada não prejudica ninguém; a reserva confere o preço de novo |
| "1.234 pessoas estão vendo este evento" | aproximada | é uma dica, não uma promessa |

Consistência forte custa latência e disponibilidade (você verá por quê com CAP e PACELC na [aula 3](../../distributed/index.md)), então você paga por ela **só onde o negócio precisa**.

### Durabilidade { #durability }

**Durabilidade** significa que um dado, uma vez confirmado, não se perde — mesmo se discos, máquinas ou um data centre inteiro falharem. Ela é obtida com replicação (várias cópias, de preferência em domínios de falha diferentes), logs de escrita antecipada (*write-ahead logs*), backups e restaurações testadas. O requisito normalmente é expresso como um **RPO** (*Recovery Point Objective* — quanto dado recente você pode perder num desastre): para os pedidos da BoxOffice, RPO = 0; para eventos de analytics, alguns minutos são aceitáveis.

Não confunda durabilidade com disponibilidade: um banco pode estar **fora do ar** (indisponível) sem **perder** nada (durável) e, ao contrário, um cache pode estar no ar sem guardar nada de forma durável.

### Custo { #cost }

Todo componente tem um preço: máquinas, serviços gerenciados, armazenamento, tráfego de saída da rede, taxas de terceiros e as pessoas para operá-lo. Custo é um requisito de primeira classe — uma arquitetura que cumpre todas as outras metas a dez vezes o orçamento é uma arquitetura fracassada. Bons requisitos de custo são ligados ao negócio: **custo por ingresso vendido**, custo por usuário ativo ou um teto mensal. Repare também que o tráfego da BoxOffice é **em picos**: pagar o mês inteiro pela capacidade de uma abertura de vendas de 10 minutos é desperdício, e é por isso que autoscaling, filas e serverless importam (a [aula 11](../../cloud-native/index.md) trata de FinOps).

### Segurança { #security }

**Segurança** protege a **confidencialidade** (só as pessoas certas leem os dados), a **integridade** (só as pessoas certas os alteram) e a **disponibilidade** (atacantes não conseguem derrubá-los) — a tríade CIA. Na BoxOffice, ela se traduz em requisitos concretos: fãs se autenticam antes de comprar; um organizador só vê os próprios eventos; robôs não conseguem comprar 500 ingressos em um segundo; números de cartão **nunca** passam pelos servidores da BoxOffice (o provedor de pagamentos os tokeniza, o que deixa a BoxOffice fora da maior parte do escopo do PCI DSS[^5]); dados pessoais seguem a lei brasileira de proteção de dados, a LGPD (*Lei Geral de Proteção de Dados*)[^6].

### Operabilidade { #operability }

**Operabilidade** reúne as qualidades que tornam um sistema **operável por pessoas reais**: observabilidade (conseguimos dizer o que está errado?), facilidade de deploy (conseguimos publicar uma mudança com segurança, várias vezes por dia?), manutenibilidade (um engenheiro novo consegue entendê-lo e alterá-lo?) e recuperabilidade (com que rapidez restauramos o serviço — o MTTR, *Mean Time To Recovery*). É o atributo mais esquecido nos diagramas e mais culpado nos post-mortems.

---

## Tornando os requisitos não funcionais mensuráveis { #making-non-functional-requirements-measurable }

"O sistema deve ser rápido" não pode ser testado, então não pode ser projetado. Um modelo prático da arquitetura de software é o **cenário de atributo de qualidade**[^1], que força seis partes numa só frase:

``` diagram-sim
flowchart LR
    source["Fonte<br/>quem/o quê"] --> stimulus["Estímulo<br/>o que acontece"]
    stimulus --> artifact["Artefato<br/>qual parte, em qual<br/>ambiente"]
    artifact --> response["Resposta<br/>o que o sistema faz"]
    response --> measure["Medida da resposta<br/>o número"]
```

| Parte | Cenário da BoxOffice: a abertura de vendas |
|---|---|
| **Fonte** | 2 M de fãs, pela web e pelo app |
| **Estímulo** | chegam em até 60 s depois das 10:00 e pedem reservas de lugares |
| **Ambiente** | operação normal, venda relâmpago em andamento |
| **Artefato** | sala de espera + serviço `inventory` + banco de lugares |
| **Resposta** | todo fã ganha um lugar na fila; fãs admitidos podem reservar lugares; nenhum lugar é reservado duas vezes |
| **Medida da resposta** | página de admissão p99 < 500 ms; reserva p99 < 300 ms; 0 vendas duplicadas; taxa de erros < 0,1% |

Escrito como requisitos, um conjunto mensurável para a BoxOffice fica assim:

!!! example "BoxOffice — requisitos não funcionais (primeira versão, premissas)"

    - **Carga**: dia normal, 1.500 req/s no horário de pico; abertura de vendas, 2 M de fãs no primeiro minuto, 60 mil lugares.
    - **Latência**: catálogo p99 < 200 ms; mapa de lugares p99 < 300 ms; reserva p99 < 300 ms; checkout p99 < 1,5 s (o provedor de pagamentos consome a maior parte).
    - **Disponibilidade**: checkout e reservas 99,95% em janela móvel de 28 dias; catálogo 99,9%; recomendações no melhor esforço.
    - **Consistência**: lugares com consistência forte (nunca, jamais, venda duplicada); catálogo com até 60 s de atraso.
    - **Durabilidade**: zero perda de pedidos pagos (RPO = 0); analytics com RPO de 15 min.
    - **Segurança**: nenhum dado de cartão armazenado; compras por robôs bloqueadas na borda; conformidade com a LGPD.
    - **Custo**: < R$ 0,10 de infraestrutura por ingresso vendido; custo ocioso < R$ 15 mil/mês.
    - **Operabilidade**: deploys sem indisponibilidade; plantão alertado em até 5 min quando um SLO começa a queimar; MTTR < 30 min.

Cada linha é testável — com um teste de carga, um experimento de caos ou a fatura do mês — e cada linha vai guiar uma decisão de design nas próximas aulas.

!!! example "No código do BoxOffice: um requisito de latência escrito como teste (lab 1)"

    O primeiro serviço da BoxOffice já carrega seu requisito em código. O smoke test do [Hands-on 1](../../../hands-on/1/index.md) escreve "o catálogo é rápido" como **thresholds por endpoint** — p95 abaixo de 200 ms para os detalhes de um evento, abaixo de 500 ms para a listagem de uma cidade, nenhuma requisição com falha — e o k6 reprova a execução quando um deles é ultrapassado. Na execução de exemplo do laboratório, com um usuário, os detalhes responderam com p95 = 11 ms e a listagem com p95 = 42 ms. Um usuário prova pouco sobre 2 milhões; o lab 2 faz as mesmas perguntas sob carga, e o lab 11 transforma o mesmo tipo de threshold num orçamento de desempenho que bloqueia uma versão.

    ``` { .javascript title="load/smoke.js (the requirement)" }
    --8<-- "docs/2027.1/hands-on/1/code/load/smoke.js:10:20"
    ```

??? question "Pense antes: reescreva estes requisitos para que sejam mensuráveis"

    1. "A busca deve ser rápida."
    2. "O sistema nunca pode cair."
    3. "Os ingressos devem ser entregues rapidamente."

    **Respostas possíveis**

    1. "A busca retorna a primeira página de resultados com p99 < 250 ms a 800 consultas/s; os resultados podem ter até 5 minutos de atraso em relação ao catálogo." (Repare na parte de consistência: um índice de busca normalmente é atualizado de forma assíncrona.)
    2. "Reservas e checkout ficam disponíveis em 99,95% das requisições em janela móvel de 28 dias; durante a queda de uma região, o serviço é restaurado em outra região em até 15 minutos (RTO) sem perder pedidos pagos (RPO = 0)." *Nunca* não é um requisito; é um orçamento infinito.
    3. "95% dos ingressos chegam à caixa de entrada do fã em até 2 minutos após o pagamento, 99,9% em até 30 minutos; um e-mail atrasado nunca bloqueia o checkout." Isso diz a quem projeta que o e-mail pode passar por uma fila.

---

## Trade-offs entre atributos de qualidade { #trade-offs-between-quality-attributes }

Os atributos de qualidade puxam uns contra os outros. Reconhecer a tensão *antes* de escolher um componente é a essência do design de sistemas:

| Melhorar… | …normalmente custa | Exemplo da BoxOffice |
|---|---|---|
| Consistência | latência e disponibilidade | uma reserva espera pelo banco primário; se o primário estiver inacessível, as reservas falham em vez de arriscar uma venda duplicada |
| Latência (cache) | frescor (consistência) | a página do evento em cache mostra um preço com até 60 s de atraso |
| Disponibilidade (redundância) | custo e complexidade | uma segunda região dobra a infraestrutura e exige testes de failover |
| Durabilidade (replicação síncrona) | latência de escrita | cada pedido pago espera a confirmação de duas réplicas |
| Segurança (mais verificações) | latência e usabilidade | a inspeção do WAF e os desafios anti-robô acrescentam milissegundos e atrito |
| Escalabilidade (particionamento) | simplicidade, consultas entre partições | particionar os pedidos por fã torna "todos os pedidos de um evento" uma consulta scatter-gather |
| Custo (menos recursos) | folga para picos | rodar a 80% de utilização economiza dinheiro e destrói o p99 durante a abertura de vendas |

É por isso que a mesma empresa roda arquiteturas diferentes para partes diferentes do mesmo produto. O catálogo da BoxOffice é um sistema **inclinado a AP, com cache em tudo**; seu inventário é um sistema **inclinado a CP, com transação em tudo**; suas notificações são um sistema **assíncrono, que tenta de novo até entregar**.

---

## Restrições e premissas { #constraints-and-assumptions }

Os requisitos vêm acompanhados de **restrições** — decisões já tomadas por você — e de **premissas** — coisas que você assume como verdadeiras para seguir em frente:

- **Equipe e competências**: uma equipe de seis pessoas que conhece Java e PostgreSQL não deveria adotar cinco bancos de dados novos.
- **Prazo**: "abertura de vendas em 8 semanas" descarta reescrever tudo como microsserviços.
- **Orçamento**: um teto mensal, ou uma meta de custo por ingresso.
- **Regulação**: LGPD para dados pessoais; PCI DSS para pagamentos; regras fiscais para notas.
- **Sistemas existentes**: a API do provedor de pagamentos e seus limites de taxa; o ERP do organizador.
- **Premissas**: "os fãs por abertura de vendas seguem a distribuição do ano passado", "o provedor responde em 300–800 ms". Anote-as — quando uma premissa estiver errada, você saberá qual parte do design rever.

!!! tip "Na entrevista"

    Gaste os primeiros **3–5 minutos** com os requisitos e escreva-os no quadro em duas colunas:

    - **Funcionais**: 3–5 funcionalidades principais, cada uma numa frase ("reservar lugares", "pagar", "receber o ingresso"). Diga o que fica de fora: "vou deixar de lado revenda e preço dinâmico, a menos que você queira."
    - **Não funcionais**: escala (usuários, requisições/s, volume de dados), metas de latência, disponibilidade, necessidades de consistência e qualquer particularidade (picos, abuso, regulação).

    Boas perguntas de esclarecimento para quase qualquer problema: *Quem são os usuários e quantos são? Qual a proporção leitura/escrita? O que precisa ter consistência forte? Que latência o usuário tolera? A carga é constante ou em picos? O que está fora do escopo?* Se o entrevistador disser "você decide", declare uma premissa e siga em frente: "vou assumir 10 M de usuários diários e uma proporção leitura/escrita de 100:1."

!!! success "Boas práticas"

    - **Dê a cada meta de latência um percentil, um ponto de medição e uma janela** — "p99 do checkout < 1,5 s, medido no gateway, em 28 dias" pode virar alerta e relatório; uma meta sem janela não pode ser calculada.
    - **Transforme cada meta numa verificação automática** — um threshold do k6, um alerta de SLO, um orçamento que reprova o build; um requisito que ninguém confere se perde a cada versão. Na BoxOffice: os thresholds de `load/smoke.js` ([lab 1](../../../hands-on/1/index.md)), e o orçamento de desempenho do lab 11.
    - **Ponha uma consulta por trás de todo "nunca"** — "nenhum assento vendido duas vezes" vira uma auditoria que precisa devolver 0 depois de todo teste. Na BoxOffice: o endpoint de auditoria `double-bookings` do [Hands-on 6 — Reservas](../../../hands-on/6/holds/index.md).
    - **Versione os requisitos junto com o código** — um `requirements.md` alterado no mesmo pull request do design que ele justifica, para que os revisores vejam os dois.
    - **Dê a cada meta um responsável e uma data de revisão** — as metas da primeira versão são premissas; revise-as com os dados da primeira abertura de vendas real.

!!! warning "Armadilhas comuns"

    - **Adjetivos não mensuráveis**: "rápido", "escalável", "altamente disponível" sem números nem janelas.
    - **Uma meta para tudo**: exigir consistência forte ou cinco noves para o sistema inteiro, quando só um caminho precisa disso.
    - **Esquecer o pico**: projetar para a média diária quando o negócio vive de picos.
    - **Ignorar custo e operabilidade** até a primeira fatura ou o primeiro incidente às 3 da manhã.
    - **Inflar o escopo**: projetar dez funcionalidades superficialmente em vez de fazer bem o caminho principal.

---

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    FR["requisitos funcionais<br/>atores, caminho principal"] --> API["API e modelo de dados<br/>→ Compute, Bancos de dados"]
    NFR["atributos de qualidade"] --> QAS["cenário de atributo de qualidade<br/>uma meta mensurável"]
    QAS --> EST["números de carga<br/>→ Estimativa"]
    NFR --> SC["escalabilidade<br/>lb, cache, queue"]
    NFR --> LAT["percentis de latência<br/>→ Estimativa"]
    NFR --> AV["noves de disponibilidade<br/>→ Confiabilidade"]
    NFR --> CO["consistência por dado<br/>→ Sistemas distribuídos"]
    NFR --> SEC["segurança<br/>→ Rede e Segurança"]
    NFR --> OPS["operabilidade<br/>→ Observabilidade"]
    CO --> TO["trade-offs: inventário CP,<br/>catálogo AP"]
    LAT --> TO
```

**Componentes da paleta:** [`client`](../../../reference/components/client/index.md#client) · [`mobile`](../../../reference/components/client/index.md#mobile) (os pontos de entrada dos atores) · [`sql`](../../../reference/components/storage/index.md#sql) (consistência forte para assentos, durabilidade dos pedidos) · [`cache`](../../../reference/components/storage/index.md#cache) · [`cdn`](../../../reference/components/edge/index.md#cdn) (latência comprada com frescor) · [`lb`](../../../reference/components/edge/index.md#lb) (escalabilidade e disponibilidade por meio de réplicas) · [`waf`](../../../reference/components/edge/index.md#waf) · [`auth`](../../../reference/components/compute/index.md#auth) (segurança) · [`payment`](../../../reference/components/external/index.md#payment) (uma restrição externa: nenhum dado de cartão armazenado) · [`metrics`](../../../reference/components/observability/index.md#metrics) (operabilidade). **Cenários:** `monolith`, `flash-sale`. **Continua em:** [Estimativa — números](../../estimation/numbers/index.md), [Estimativa — percentis](../../estimation/percentiles/index.md), [Estimativa — matemática da disponibilidade](../../estimation/availability-math/index.md), [Distribuídos — CAP e PACELC](../../distributed/cap-pacelc/index.md), [Observabilidade — SLOs](../../observability/slo/index.md), [Exercício: design doc](../../../exercises/design-doc/index.md).

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - Requisitos **funcionais** definem *o quê* (APIs, dados); requisitos **não funcionais** definem *quão bem* — e comandam a arquitetura.
    - Oito atributos de qualidade carregam a maioria das decisões de design: **escalabilidade, disponibilidade, latência, consistência, durabilidade, custo, segurança, operabilidade**.
    - Torne cada requisito **mensurável**: um número, um percentil, uma janela, um nível de carga — o cenário de atributo de qualidade ajuda.
    - Partes diferentes do sistema precisam de qualidades **diferentes**: consistência forte para os lugares, frescor trocado por velocidade no catálogo.
    - Toda melhoria custa algo; dê nome ao **trade-off** antes de escolher o componente.

---

[^1]: BASS, L.; CLEMENTS, P.; KAZMAN, R. *Software Architecture in Practice*, 4th ed. Addison-Wesley, 2021. Part II (quality attributes and quality attribute scenarios).
[^2]: ISO/IEC 25010:2023. *Systems and software engineering — Systems and software Quality Requirements and Evaluation (SQuaRE) — Product quality model*.
[^3]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2nd ed. O'Reilly. Chapter 2 (defining nonfunctional requirements: describing load and performance).
[^4]: NIELSEN, J. *Usability Engineering*. Morgan Kaufmann, 1993. Chapter 5 (response time limits: 0.1 s, 1 s, 10 s).
[^5]: PCI SECURITY STANDARDS COUNCIL. *Payment Card Industry Data Security Standard (PCI DSS)*, v4.0.1, 2024.
[^6]: BRASIL. Lei nº 13.709, de 14 de agosto de 2018 — Lei Geral de Proteção de Dados Pessoais (LGPD).
