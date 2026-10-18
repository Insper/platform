A maioria das decisões de arquitetura nas empresas de verdade não é tomada na frente de um quadro branco: ela é tomada em um **design doc** que os colegas leem, questionam e aprovam — e nas **ADRs** (Architecture Decision Records) que lembram a todos, um ano depois, *por que* as coisas são como são. Em uma entrevista, o mesmo raciocínio acontece em voz alta, em 45 minutos. Neste exercício você faz os dois: escreve um design doc completo com ADRs para um problema clássico de system design e depois o **defende oralmente**, incluindo uma mudança de requisitos que você não viu chegando.

!!! abstract "Objetivos de aprendizagem"

    Ao final deste exercício você será capaz de:

    - **Delimitar** um problema vago em requisitos funcionais e não funcionais com números.
    - **Projetar** um sistema de ponta a ponta — estimativas, API, modelo de dados, arquitetura de alto nível com componentes da paleta, aprofundamentos.
    - **Avaliar** alternativas e registrar decisões como ADRs, com suas consequências.
    - **Identificar** gargalos, modos de falha, questões de segurança e de operação, e custo.
    - **Defender** um design oralmente e **adaptá-lo** a um requisito novo na hora.

## Contexto

A estrutura de um bom design doc segue o [roteiro de entrevista](../../classes/intro/interview-framework/index.md) da Aula 1 — esclarecer → estimar → API e modelo de dados → design de alto nível → aprofundamentos → gargalos e trade-offs → fechamento — e o [guia de entrevista](../../support/interview/framework/index.md). Os [estudos de caso](../../classes/case-studies/index.md) da Aula 16 mostram exemplos completos resolvidos; o [catálogo de componentes](../../reference/components/index.md) dá o vocabulário (use os ids da paleta nos seus diagramas). Um design doc não é uma lista de tecnologias: cada componente precisa ser **justificado por um requisito ou um número**, e cada escolha importante precisa citar a **alternativa que você descartou**[^1].

## Tarefa

1. Você recebe **um problema** da [lista abaixo](#problems) por sorteio (no máximo dois alunos por problema).
2. Escreva um **design doc** seguindo o [template](#templates), na escala indicada no problema.
3. Registre **pelo menos três ADRs** para as decisões mais importantes.
4. Opcionalmente, faça um protótipo do design no [playground](../../../playground/index.md) (partindo de `blank`) e anexe o JSON exportado.
5. **Defenda** o design em uma [defesa oral](#oral-defence) de 15 minutos.

## Requisitos

- [ ] **(obrigatório)** Design doc com todas as seções do template (uma seção pode dizer "não se aplica — porque …").
- [ ] **(obrigatório)** Pelo menos **três ADRs**, cada uma com contexto, opções consideradas, decisão e consequências (positivas e negativas).
- [ ] **(obrigatório)** Defesa oral realizada (reprovar nela, ou não comparecer, leva o exercício a **I**).
- [ ] Requisitos: 3–6 funcionais, não funcionais **com números** (percentis de latência, disponibilidade, durabilidade, escala), lista explícita do que está fora do escopo.
- [ ] Estimativas: QPS (médio e de pico, leituras/escritas), armazenamento, banda, cache, número de servidores — com as fórmulas (como no [exercício de estimativas](../estimation/index.md)).
- [ ] API (endpoints ou mensagens, com requisição/resposta) e modelo de dados (entidades, chaves, armazenamento escolhido **e por quê**, chave de partição se houver).
- [ ] Diagrama de alto nível usando **ids de componentes da paleta** (`lb`, `apigw`, `app`, `cache`, `sql`, `kafka`, …) e o percurso dos dois fluxos de requisição mais importantes.
- [ ] Pelo menos **dois aprofundamentos** nas partes mais difíceis do problema.
- [ ] Gargalos com 10× de escala, modos de falha com detecção e mitigação, segurança, observabilidade (SLIs/SLOs/alertas) e custo em ordem de grandeza.
- [ ] Seção *Uso de IA* (veja a [política](../index.md#use-of-ai-tools)).

## Entregáveis

No site da sua documentação (tag `ex7`): uma página `design-doc` com o design doc e uma página (ou seção) por ADR, numeradas `ADR-001`, `ADR-002`, …; diagramas em Mermaid ou imagens com o seu código-fonte; JSON opcional do playground em `playground/design-doc.json`. Traga a página aberta para a defesa oral.

## Passo a passo

1. **Esclareça (≈ 10% do esforço).** Anote as perguntas que você faria a um entrevistador e responda-as você mesmo como premissas: quem são os usuários, quais os casos de uso centrais, que escala, o que importa mais — latência, consistência, custo?
2. **Estime.** Transforme a escala em QPS, armazenamento, banda e memória. Marque quais números **obrigam** uma decisão de design (por exemplo, "10 TB/dia de escritas → não cabe em um único primário SQL").
3. **API e modelo de dados.** Defina o contrato antes das caixas. Escolha o armazenamento de cada entidade pelo padrão de acesso, não por hábito.
4. **Design de alto nível.** Desenhe o design mais simples que atende aos requisitos funcionais e depois percorra as requisições principais através dele.
5. **Aprofundamentos.** Escolha as duas ou três partes em que o problema é realmente difícil (ordem, chaves quentes, fan-out, exactly-once, consistência, tempo real, custo das chamadas a LLM…) e vá fundo: alternativas, números, comportamento sob falhas.
6. **Gargalos e falhas.** O que quebra primeiro com 10×? O que acontece quando cada dependência está lenta ou fora do ar? Como você detecta isso?
7. **Escreva as ADRs** das decisões que você gostaria que alguém novo no time entendesse daqui a um ano.
8. **Fechamento.** Resuma o design em cinco linhas, liste as questões em aberto e os riscos que você aceita.
9. **Ensaie a defesa.** Explique o design em 5 minutos para um colega e deixe que ele mude um requisito.

!!! tip "Na entrevista"

    O mesmo documento, comprimido em 45 minutos, é uma entrevista de system design. Praticar a versão escrita antes deixa a versão falada mais rápida: você já conhece os seus números, os seus trade-offs e os seus pontos fracos.

## Problemas { #problems }

| # | Problema | Escopo | Desafio principal |
|:-:|-|-|-|
| 1 | Web crawler | Rastrear 1 B de páginas por mês, educadamente, e guardá-las para indexação | Fronteira de URLs, cortesia por host, deduplicação |
| 2 | Editor colaborativo de documentos | Coedição em tempo real de documentos de texto, até 50 editores por documento | Resolução de conflitos (OT ou CRDT), presença, histórico |
| 3 | Agendador distribuído de tarefas | Executar milhões de tarefas recorrentes e avulsas por dia com garantia at-least-once | Eleição de líder, exatamente uma execução por agendamento, retentativas |
| 4 | Plataforma de métricas e monitoramento | Ingerir métricas de 100 mil hosts, consultar dashboards, disparar alertas | Séries temporais com muita escrita, downsampling, cardinalidade |
| 5 | Ranking de jogo | Rankings global e de amigos para um jogo com 50 M de jogadores por dia | Top-K na velocidade das escritas, sorted sets, particionar um ranking |
| 6 | Reserva de hotéis | Buscar disponibilidade e reservar quartos em 1 M de hotéis | Consistência do inventário, overbooking, caminho de busca vs de reserva |
| 7 | Entrega de comida | Restaurantes, pedidos, atribuição de entregadores e rastreamento em um país | Marketplace de três lados, casamento geográfico, máquina de estados do pedido |
| 8 | Sincronização de arquivos (estilo Dropbox) | Sincronizar arquivos entre dispositivos para 50 M de usuários | Divisão em blocos, deduplicação, consistência dos metadados, conflitos |
| 9 | Agregador de cliques em anúncios | Contar cliques em anúncios quase em tempo real para cobrança e dashboards | Processamento de streams, contagem exactly-once, eventos atrasados |
| 10 | Plataforma de entrega de webhooks | Entregar eventos de um SaaS para milhões de endpoints de clientes | Retentativas com backoff, ordem, receptores lentos ou hostis |
| 11 | Serviço de proximidade | "Restaurantes perto de mim" para 200 M de usuários | Índice geoespacial (geohash, quadtree), muita leitura, atualizações |
| 12 | Juiz online de código | Alunos enviam código que é compilado, executado e avaliado | Sandbox, filas com rajadas antes dos prazos, justiça |
| 13 | Perguntas e respostas sobre documentos com LLM para uma universidade | Alunos fazem perguntas sobre documentos das disciplinas; as respostas citam as fontes | Pipeline de RAG, custo por pergunta, guardrails, atualização |

O professor faz o sorteio em aula (ou o publica no Blackboard). Dois alunos com o mesmo problema escrevem documentos **independentes** — eles serão comparados.

## Defesa oral { #oral-defence }

A defesa dura **15 minutos**, com o seu design doc na tela:

1. **5 minutos — apresentação.** Requisitos e números, o diagrama, os dois fluxos principais, a decisão de que você mais se orgulha.
2. **10 minutos — perguntas.** Incluindo **uma pegadinha**: uma mudança de requisito que você precisa tratar ao vivo, por exemplo:
    - o tráfego cresce **10×** (ou uma chave/um usuário fica 1.000× mais quente);
    - o sistema precisa rodar em uma **segunda região**, tolerando a queda de uma região;
    - uma **funcionalidade nova** (por exemplo, busca, notificações, um assistente de IA) precisa ser acrescentada;
    - o orçamento é cortado pela **metade**;
    - um componente que você escolheu **não é permitido** (por exemplo, sem Kafka, sem NoSQL).

Exemplos de perguntas:

- "Qual número das suas estimativas guia a maior decisão? E se ele estiver errado por um fator de 10?"
- "Mostre o que acontece quando `<dependência>` leva 5 segundos para responder."
- "Por que este armazenamento e não `<alternativa>`? O que faria você mudar de ideia?"
- "Onde dados podem ser perdidos ou duplicados? Como você sabe que isso não aconteceu?"
- "Sobre o que você alerta? Quem é acordado, e o que essa pessoa olha primeiro?"
- "Qual ADR você revisaria primeiro, e por quê?"

O que se avalia é o entendimento: você pode dizer "não considerei isso" e então raciocinar a respeito. Ler o documento em voz alta não é uma defesa.

## Templates

=== "English"

    ~~~markdown
    # Design doc — <system>

    **Author:** <name> · **Status:** draft | in review | final · **Date:** <yyyy-mm-dd> · **Reviewers:** <names>

    ## 1. Context and goals
    What problem, for whom, why now. Goals and non-goals.

    ## 2. Requirements
    ### Functional
    1. ...
    ### Non-functional
    | Attribute | Target |
    |-|-|
    | Latency | p99 < ... ms for ... |
    | Availability | ...% per month |
    | Durability | ... |
    | Scale | ... DAU, ... req/s peak |
    | Consistency | ... |
    ### Out of scope
    - ...

    ## 3. Estimates
    | Quantity | Formula | Result |
    |-|-|-|
    Numbers that force decisions: ...

    ## 4. API
    | Method | Path / message | Request | Response | Notes (idempotency, auth) |
    |-|-|-|-|-|

    ## 5. Data model
    | Entity | Key | Main fields | Store | Why this store | Partition key |
    |-|-|-|-|-|-|

    ## 6. High-level design
    ```mermaid
    flowchart LR
        client --> lb --> app --> cache
        app --> sql
    ```
    Walk-through of flow 1: ...
    Walk-through of flow 2: ...

    ## 7. Deep dives
    ### 7.1 <hard part>
    Options, numbers, decision (see ADR-00x), failure behaviour.
    ### 7.2 <hard part>

    ## 8. Scalability and bottlenecks
    What breaks first at 10×, and the plan.

    ## 9. Reliability and failure modes
    | Failure | Impact | Detection | Mitigation |
    |-|-|-|-|

    ## 10. Security and privacy
    Authentication, authorization, secrets, sensitive data, abuse.

    ## 11. Observability
    | SLI | SLO | How measured | Alert |
    |-|-|-|-|

    ## 12. Cost
    Order of magnitude per month and the main cost drivers.

    ## 13. Alternatives considered
    | Alternative | Why not |
    |-|-|

    ## 14. Risks and open questions

    ## 15. Decisions
    - ADR-001 — ...
    - ADR-002 — ...
    - ADR-003 — ...

    ## 16. AI usage

    ## 17. References
    ~~~

=== "Português"

    ~~~markdown
    # Design doc — <sistema>

    **Autor(a):** <nome> · **Status:** rascunho | em revisão | final · **Data:** <aaaa-mm-dd> · **Revisores:** <nomes>

    ## 1. Contexto e objetivos
    Qual problema, para quem, por que agora. Objetivos e não objetivos.

    ## 2. Requisitos
    ### Funcionais
    1. ...
    ### Não funcionais
    | Atributo | Meta |
    |-|-|
    | Latência | p99 < ... ms para ... |
    | Disponibilidade | ...% por mês |
    | Durabilidade | ... |
    | Escala | ... DAU, ... req/s no pico |
    | Consistência | ... |
    ### Fora do escopo
    - ...

    ## 3. Estimativas
    | Grandeza | Fórmula | Resultado |
    |-|-|-|
    Números que obrigam decisões: ...

    ## 4. API
    | Método | Caminho / mensagem | Requisição | Resposta | Observações (idempotência, autenticação) |
    |-|-|-|-|-|

    ## 5. Modelo de dados
    | Entidade | Chave | Campos principais | Armazenamento | Por que este armazenamento | Chave de partição |
    |-|-|-|-|-|-|

    ## 6. Design de alto nível
    ```mermaid
    flowchart LR
        client --> lb --> app --> cache
        app --> sql
    ```
    Percurso do fluxo 1: ...
    Percurso do fluxo 2: ...

    ## 7. Aprofundamentos
    ### 7.1 <parte difícil>
    Opções, números, decisão (veja ADR-00x), comportamento sob falhas.
    ### 7.2 <parte difícil>

    ## 8. Escalabilidade e gargalos
    O que quebra primeiro com 10×, e o plano.

    ## 9. Confiabilidade e modos de falha
    | Falha | Impacto | Detecção | Mitigação |
    |-|-|-|-|

    ## 10. Segurança e privacidade
    Autenticação, autorização, segredos, dados sensíveis, abuso.

    ## 11. Observabilidade
    | SLI | SLO | Como é medido | Alerta |
    |-|-|-|-|

    ## 12. Custo
    Ordem de grandeza por mês e os principais fatores de custo.

    ## 13. Alternativas consideradas
    | Alternativa | Por que não |
    |-|-|

    ## 14. Riscos e questões em aberto

    ## 15. Decisões
    - ADR-001 — ...
    - ADR-002 — ...
    - ADR-003 — ...

    ## 16. Uso de IA

    ## 17. Referências
    ~~~

### Template de ADR

Cada ADR é curta (uma página) e **imutável depois de aceita**: se a decisão mudar, escreva uma ADR nova que *substitui* a antiga[^2].

=== "English"

    ~~~markdown
    # ADR-00x — <decision in a few words>

    **Status:** proposed | accepted | superseded by ADR-00y · **Date:** <yyyy-mm-dd> · **Deciders:** <names>

    ## Context
    The situation and the forces at play (requirements, numbers, constraints).

    ## Decision drivers
    - <driver 1, e.g. p99 < 200 ms on reads>
    - <driver 2, e.g. team knows PostgreSQL>

    ## Considered options
    1. <option A>
    2. <option B>
    3. <option C>

    ## Decision
    We choose <option>, because <reasons tied to the drivers>.

    ## Consequences
    - Positive: ...
    - Negative: ... (and how we live with them)

    ## Confirmation
    How we will know the decision works (a test, a metric, a review date).

    ## Links
    Design doc section, related ADRs, references.
    ~~~

=== "Português"

    ~~~markdown
    # ADR-00x — <decisão em poucas palavras>

    **Status:** proposta | aceita | substituída pela ADR-00y · **Data:** <aaaa-mm-dd> · **Decisores:** <nomes>

    ## Contexto
    A situação e as forças em jogo (requisitos, números, restrições).

    ## Fatores de decisão
    - <fator 1, por exemplo p99 < 200 ms nas leituras>
    - <fator 2, por exemplo o time conhece PostgreSQL>

    ## Opções consideradas
    1. <opção A>
    2. <opção B>
    3. <opção C>

    ## Decisão
    Escolhemos <opção>, porque <motivos ligados aos fatores>.

    ## Consequências
    - Positivas: ...
    - Negativas: ... (e como convivemos com elas)

    ## Confirmação
    Como saberemos que a decisão funciona (um teste, uma métrica, uma data de revisão).

    ## Links
    Seção do design doc, ADRs relacionadas, referências.
    ~~~

## Rubrica

Níveis conforme definidos em [Como os exercícios são avaliados](../index.md#how-the-exercises-are-graded). O documento escrito e a defesa oral são avaliados juntos; a defesa pesa tanto quanto todos os critérios escritos somados.

| Critério | I | D | C | B | A |
|-|-|-|-|-|-|
| Requisitos e escopo | Ausentes | Vagos, sem números | Funcionais + não funcionais com números + fora do escopo | Priorizados; os requisitos difíceis identificados | Ambiguidades encontradas e resolvidas com premissas explícitas |
| Estimativas | Ausentes | Ordens de grandeza erradas | Completas, com fórmulas | Os números guiam as decisões explicitamente | Sensibilidade: qual estimativa muda o design se estiver errada |
| API e modelo de dados | Ausentes | Incompletos | Completos, armazenamento escolhido por entidade | Padrões de acesso justificam armazenamentos e chaves | Idempotência, paginação, versionamento tratados |
| Design de alto nível | Ausente | Caixas sem fluxos | Diagrama com ids da paleta + dois fluxos | Cada componente justificado por um requisito | O design mais simples que funciona, caminho de evolução mostrado |
| Aprofundamentos e trade-offs | — | Rasos | Dois aprofundamentos com opções | Números e comportamento sob falhas em cada um | Percepção além da solução clássica |
| Confiabilidade, segurança, operação, custo | — | Falta uma área | Todas cobertas | Tabela de falhas com detecção + SLOs com alertas | Custo e confiabilidade trocados explicitamente |
| ADRs **(obrigatório)** | Nenhuma | Menos de três, ou sem alternativas | Três ADRs com opções e consequências | Consequências negativas honestas, confirmação definida | ADRs com que um recém-chegado consegue agir |
| Escrita | Ilegível | Desorganizada | Clara e completa | Concisa, os diagramas sustentam o argumento | Pronta para revisão: poderia ser aprovada em uma empresa real |
| Defesa oral **(obrigatório)** | Não feita ou não consegue explicar o próprio design | Explica com dificuldade, pegadinha não tratada | Explica com clareza, pegadinha tratada em parte | Trata a pegadinha com números e trade-offs | Raciocina além do documento, reconhece e corrige uma fraqueza ao vivo |

## FAQ

??? question "Qual deve ser o tamanho do design doc?"

    Grande o suficiente para cobrir todas as seções, curto o suficiente para ser lido em 20–30 minutos: tipicamente 6–12 páginas com diagramas. Tabelas e diagramas valem mais que parágrafos.

??? question "Posso basear meu design em um artigo público ou em um capítulo de livro?"

    Sim — cite a fonte. Mas o documento precisa mostrar o **seu** raciocínio para os **seus** números, e dois alunos com o mesmo problema são comparados. Uma estrutura copiada com outras palavras é fácil de perceber na defesa.

??? question "Preciso implementar alguma coisa?"

    Não. Um protótipo no playground é opcional e bem-vindo. O que importa é um design que você consiga justificar e defender.

??? question "Que tecnologias devo citar?"

    Cite categorias primeiro (ids da paleta: `kafka`, `nosql`, `cache`) e produtos específicos só quando a escolha importa (por exemplo, PostgreSQL vs Cassandra para um log com muita escrita). Todo produto citado precisa de um motivo.

??? question "E se eu não souber responder à pegadinha?"

    Pense em voz alta: reformule a mudança, estime o efeito, encontre o que quebra primeiro, proponha uma correção e diga o custo dela. Uma resposta parcial estruturada vale muito mais que silêncio ou um chute.

??? question "Posso usar IA para escrever o documento?"

    Você pode usar IA para revisar, questionar ou melhorar o seu texto — e deve declarar o uso. A defesa confere que as decisões são suas: se o documento diz algo e você não consegue explicar, a nota é I.

[^1]: Alex Xu, *System Design Interview — An Insider's Guide*, vol. 1, cap. 3 "A framework for system design interviews", 2020.
[^2]: Michael Nygard, "Documenting Architecture Decisions", 2011, [cognitect.com](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions){target="_blank"}; template MADR, [adr.github.io/madr](https://adr.github.io/madr/){target="_blank"}.
