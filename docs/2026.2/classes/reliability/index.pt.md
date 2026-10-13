Imagine a loja numa noite de Black Friday. O serviço de produtos está saudável, o banco de dados está saudável, mas o provedor de pagamentos passa a responder em 3 segundos em vez de 100 ms. Em menos de um minuto o gateway para de responder *tudo* — login, catálogo, carrinho — embora nada nessas rotas esteja quebrado. Ninguém escreveu um bug; o sistema simplesmente não tinha defesa contra uma dependência lenta. Esta aula trata de construir essas defesas e de decidir, com números, quanta falha é aceitável.

Confiabilidade é a probabilidade de um sistema executar a função exigida sem falhar, sob condições definidas, por um período de tempo especificado[^1]. Em sistemas distribuídos, essa definição vai além do hardware e passa a incluir falhas de software, partições de rede, dependências sobrecarregadas e deploys incorretos.

Um sistema confiável não é aquele que nunca falha. É aquele que **falha de forma controlada, se recupera rapidamente e limita o raio de impacto de qualquer falha isolada** sobre seus usuários. (O **raio de impacto** — *blast radius* — é o conjunto de usuários e componentes afetados por uma falha.)

!!! abstract "Objetivos de aprendizagem"

    Ao final desta aula, você deve ser capaz de:

    - **Calcular** a disponibilidade a partir de MTTF e MTTR, o tempo de indisponibilidade permitido por um número de "noves" e a disponibilidade ponta a ponta de serviços em série e em paralelo.
    - **Classificar** uma falha (transitória, permanente, intermitente, bizantina) e **explicar** como uma falha em cascata se espalha por meio de recursos esgotados.
    - **Definir** SLIs e SLOs para um serviço da loja e **calcular** seu error budget e sua burn rate.
    - **Escolher e configurar** padrões de resiliência — timeout, retry com backoff e jitter, circuit breaker, bulkhead, rate limiting, health checks — para uma chamada entre dois serviços.
    - **Projetar** um experimento de caos com uma hipótese de estado estável e um raio de impacto controlado.

## Roteiro

1. **Esta visão geral** — disponibilidade, os "noves", disponibilidade composta, modos de falha e falhas em cascata.
2. [SLI / SLO / SLA](sli-slo-sla/index.md) — como medir a confiabilidade, definir metas e transformar a diferença em um error budget.
3. [Padrões de Resiliência](patterns/index.md) — timeout, retry, circuit breaker, bulkhead, rate limiting e health checks, e como combiná-los em camadas.
4. [Engenharia do Caos](chaos/index.md) — injetar falhas de propósito para provar que os padrões funcionam.
5. [Quiz](quiz.md) — verifique seu entendimento.

## Slides

<div class="slides-embed">
  <iframe src="slides/reliability.html" title="Slides: confiabilidade" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/reliability.html){:target="_blank"}

---

## Disponibilidade

A expressão mais visível da confiabilidade é a **disponibilidade** — a fração do tempo em que um sistema está em estado funcional. Confiabilidade e disponibilidade são relacionadas, mas não idênticas: um serviço que cai por um segundo a cada minuto tem confiabilidade ruim (falha com frequência), mas ainda cerca de 98% de disponibilidade; um serviço que falha uma vez por ano, mas leva uma semana para ser reparado, é muito confiável e pouco disponível. A disponibilidade é derivada de duas grandezas mensuráveis:

| Termo | Nome completo | Significado |
|---|---|---|
| **MTTF** | Mean Time To Failure | Tempo médio de operação do sistema até ocorrer uma falha |
| **MTTR** | Mean Time To Repair (ou Recover) | Tempo médio para detectar, diagnosticar e restaurar o serviço após uma falha |
| **MTBF** | Mean Time Between Failures | MTTF + MTTR — o ciclo completo de falha e recuperação |

$$
\text{Availability} = \frac{MTTF}{MTTF + MTTR}
$$

!!! example "Exemplo resolvido — o serviço de pedidos"

    O serviço de pedidos cai em média uma vez a cada 30 dias (MTTF = 720 h). A cada vez, leva 2 horas até alguém perceber, encontrar a causa e reiniciá-lo (MTTR = 2 h).

    Disponibilidade = 720 / (720 + 2) ≈ **99,72%**.

    Duas formas de melhorar:

    - Reduzir as falhas pela metade (MTTF = 1440 h) → 1440 / 1442 ≈ 99,86%.
    - Deixar o Kubernetes reiniciar o pod automaticamente em 1 minuto (MTTR ≈ 0,017 h) → 720 / 720,017 ≈ **99,998%**.

    Recuperar mais rápido foi o ganho maior — e muito mais barato do que nunca falhar.

**Ideia-chave**: a confiabilidade melhora ou prevenindo falhas (↑ MTTF) ou recuperando mais rápido (↓ MTTR). A maioria dos investimentos de engenharia mira uma dessas duas alavancas. Resposta a incidentes, automação e runbooks atacam principalmente o MTTR. Projeto tolerante a falhas, testes e redundância atacam principalmente o MTTF.

### Os "noves" de disponibilidade

Metas de disponibilidade costumam ser expressas como um número de "noves". A tabela abaixo mostra quanto tempo de indisponibilidade cada meta permite, por janela (ano = 365,25 dias, mês = 1/12 de ano ≈ 30,44 dias):

| Disponibilidade | Por ano | Por mês | Por 28 dias | Por semana |
|---|---|---|---|---|
| 90% ("um nove") | 36,5 dias | 73,1 horas | 2,8 dias | 16,8 horas |
| 99% ("dois noves") | 3,65 dias | 7,31 horas | 6,72 horas | 1,68 hora |
| 99,9% ("três noves") | 8,77 horas | 43,8 minutos | 40,3 minutos | 10,1 minutos |
| 99,95% | 4,38 horas | 21,9 minutos | 20,2 minutos | 5,04 minutos |
| 99,99% ("quatro noves") | 52,6 minutos | 4,38 minutos | 4,03 minutos | 1,01 minuto |
| 99,999% ("cinco noves") | 5,26 minutos | 26,3 segundos | 24,2 segundos | 6,05 segundos |
| 99,9999% ("seis noves") | 31,6 segundos | 2,63 segundos | 2,42 segundos | 0,60 segundo |

Cada "nove" adicional é uma redução de 10× no tempo de indisponibilidade permitido. Passar de três para quatro noves não é uma melhoria incremental — exige uma postura operacional fundamentalmente diferente. Com cinco noves, o tempo de reação humano é lento demais; detecção e recuperação precisam ser totalmente automatizadas.

!!! warning "Sempre informe a janela"

    "99,9%" sozinho é ambíguo: permite 43,8 minutos em um mês de calendário, mas 40,3 minutos em uma janela de 28 dias. Sempre que citar um número de disponibilidade, cite também a janela sobre a qual ele é medido.

### Disponibilidade composta

Requisições reais atravessam vários componentes, então a disponibilidade que o usuário percebe depende de como os componentes estão combinados[^3].

=== "Em série (cadeia de dependências)"

    Quando uma requisição precisa que **todos** os componentes funcionem, suas disponibilidades se **multiplicam**. O gateway chama o serviço de pedidos, que chama o serviço de produtos, cada um com 99,9%:

    $$
    A_{chain} = 0.999 \times 0.999 \times 0.999 \approx 99.7\%
    $$

    A cadeia é pior do que qualquer componente individual. Cada dependência síncrona que você adiciona rebaixa o teto.

=== "Em paralelo (réplicas redundantes)"

    Quando **qualquer uma** de $n$ réplicas idênticas e independentes basta, o sistema só fica fora do ar se todas estiverem fora ao mesmo tempo:

    $$
    A_{parallel} = 1 - (1 - a)^n
    $$

    Duas réplicas do gateway com 99% cada atrás do Nginx ([Hands-on 7](../../hands-on/7/index.md)): $1 - 0.01^2 = 99.99\%$. A redundância transforma dois componentes medianos em um muito disponível — desde que suas falhas sejam realmente independentes (o mesmo bug, o mesmo host ou a mesma zona quebram essa premissa).

``` mermaid-sim
flowchart LR
    user([Usuário]) --> lb["Nginx"]
    lb --> g1["gateway #1<br/>99%"]
    lb --> g2["gateway #2<br/>99%"]
    g1 --> order["order<br/>99,9%"]
    g2 --> order
    order --> product["product<br/>99,9%"]
```

É por isso que existem a redundância (múltiplas instâncias) e os padrões de isolamento (circuit breakers): para quebrar a cadeia de propagação de falhas.

---

## Modos de falha

Sistemas distribuídos falham de formas que sistemas de uma única máquina não falham. **Falhas parciais** — em que alguns componentes funcionam e outros não — são muito mais comuns do que indisponibilidades totais e consideravelmente mais difíceis de tratar corretamente.

``` mermaid-sim
flowchart TD
    F[Falha] --> T["Transitória<br/>Temporária, se resolve sozinha<br/>ex.: oscilação breve de rede"]
    F --> P["Permanente<br/>Exige intervenção<br/>ex.: pane de disco, OOM kill"]
    F --> I["Intermitente<br/>Recorrência imprevisível<br/>ex.: vazamento de memória, pausa de GC"]
    P --> CS["Crash-stop<br/>O nó para e permanece parado"]
    P --> BZ["Bizantina<br/>O nó se comporta de forma arbitrária ou incorreta"]
```

| Classe de falha | Características | Estratégia de tratamento |
|---|---|---|
| **Transitória** | Resolve-se sozinha em segundos; é seguro fazer retry | Retry com backoff exponencial e jitter |
| **Permanente (crash-stop)** | O nó para de responder e nunca se recupera | Circuit breaker + failover para uma réplica saudável |
| **Intermitente** | Aparece e desaparece sem um gatilho claro | Histogramas de latência P99; alertas baseados em anomalias |
| **Bizantina** | O nó retorna dados incorretos sem cair | Protocolos de consenso; checksums; validação de entrada |

A falha mais comum na prática não é uma queda, mas uma resposta **lenta**: quem chama não consegue distinguir um nó lento de um nó morto (veja [Sistemas Distribuídos](../distributed_systems/index.md)), então continua esperando.

### Falhas em cascata

Uma única dependência lenta pode esgotar recursos de quem a chama — slots do pool de threads, entradas do pool de conexões, memória — e propagar esse esgotamento para cima, por todo o grafo de serviços. Esse é o padrão de falha mais perigoso em arquiteturas de microsserviços[^2].

``` mermaid-sim
sequenceDiagram
    participant U as Usuários
    participant O as Serviço de pedidos (200 threads)
    participant P as Serviço de pagamento
    U->>O: POST /orders (muitos por segundo)
    O->>P: cobrança (normalmente 100 ms)
    Note over P: degrada: 3 s por chamada
    Note over O: threads esperam 30× mais → todas as 200 ocupadas
    U->>O: GET /orders/42 (sem pagamento)
    O-->>U: 503 — nenhuma thread livre
    Note over U,O: rotas não relacionadas também falham
```

A aritmética é simples (lei de Little: requisições em andamento = taxa de chegada × tempo de cada uma). Com 60 pedidos por segundo e 100 ms por chamada de pagamento, cerca de 6 threads ficam ocupadas esperando o pagamento. Com 3 s por chamada, são 180 threads — quase o pool inteiro — e todas as outras rotas do serviço de pedidos ficam sem recursos. Se o gateway, por sua vez, espera pelo serviço de pedidos, o esgotamento sobe mais um nível. **Timeouts, circuit breakers e bulkheads** ([Padrões de Resiliência](patterns/index.md)) são a resposta da engenharia a esse modo de falha.

!!! warning "Armadilhas comuns"

    - **Sem timeout** em um cliente HTTP (ou com um padrão de minutos): uma dependência lenta prende threads indefinidamente.
    - **Retry às cegas**: retries multiplicam a carga sobre um serviço que já está com dificuldades, transformando uma lentidão em uma indisponibilidade.
    - **Pools compartilhados**: um único pool de conexões ou de threads para todas as dependências significa que a pior dependência decide por todas.
    - **Supor independência**: duas réplicas no mesmo nó, ou com a mesma configuração errada, falham juntas.

---

## Conexões

- [Sistemas Distribuídos](../distributed_systems/index.md) — falha parcial e a impossibilidade de distinguir lento de morto.
- [Observabilidade](../observability/index.md) — SLIs são calculados a partir de métricas; sem ela não há como operar SLOs nem experimentos de caos.
- [Arquitetura Orientada a Eventos](../event_driven/index.md) — mensageria assíncrona tira a espera de quem chama da cadeia; DLQs tratam mensagens envenenadas.
- [Hands-on 5](../../hands-on/5/index.md) (autorrecuperação no Kubernetes), [Hands-on 7](../../hands-on/7/index.md) (réplicas atrás de um balanceador de carga) e [Hands-on 6](../../hands-on/6/index.md) (Prometheus e Grafana para SLIs).

## Pontos-chave

- Disponibilidade = MTTF / (MTTF + MTTR); recuperar mais rápido costuma ser a melhoria mais barata.
- Cada nove a mais significa 10× menos indisponibilidade — e sempre informe a **janela** a que um número se refere.
- Em série, as disponibilidades se **multiplicam** (pior do que qualquer parte); em paralelo, a redundância dá $1-(1-a)^n$.
- Falhas parciais e **lentas** são a norma; uma dependência lenta esgota os recursos de quem a chama e se propaga **em cascata** para cima.
- O restante da aula mede a confiabilidade (SLOs, error budgets), contém as falhas (padrões de resiliência) e prova que a contenção funciona (engenharia do caos).

---

[^1]: IEEE Standard Glossary of Software Engineering Terminology, IEEE Std 610.12-1990.
[^2]: NYGARD, M. *Release It! Design and Deploy Production-Ready Software*, 2nd ed. Pragmatic Programmers, 2018.
[^3]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/books/){target="_blank"}. Google / O'Reilly, 2016.
