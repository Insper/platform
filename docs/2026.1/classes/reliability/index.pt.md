Confiabilidade é a probabilidade de um sistema executar a função exigida sem falhar, sob condições definidas, por um período de tempo especificado[^1]. Em sistemas distribuídos, essa definição vai além do hardware e passa a incluir falhas de software, partições de rede, dependências sobrecarregadas e deploys incorretos.

Um sistema confiável não é aquele que nunca falha. É aquele que **falha de forma controlada, se recupera rapidamente e limita o raio de impacto de qualquer falha isolada** sobre seus usuários.

---

## Disponibilidade

A expressão mais visível da confiabilidade é a **disponibilidade** — a fração do tempo em que um sistema está em estado funcional. Ela é derivada de duas taxas mensuráveis:

| Termo | Nome completo | Significado |
|---|---|---|
| **MTTF** | Mean Time To Failure | Tempo médio de operação do sistema até ocorrer uma falha |
| **MTTR** | Mean Time To Repair | Tempo médio para detectar, diagnosticar e restaurar o serviço após uma falha |
| **MTBF** | Mean Time Between Failures | MTTF + MTTR — o ciclo completo de falha e recuperação |

$$
\text{Availability} = \frac{MTTF}{MTTF + MTTR}
$$

**Ideia-chave**: a confiabilidade melhora ou prevenindo falhas (↑ MTTF) ou recuperando mais rápido (↓ MTTR). A maioria dos investimentos de engenharia mira uma dessas duas alavancas. Resposta a incidentes, automação e runbooks atacam principalmente o MTTR. Projeto tolerante a falhas, testes e redundância atacam principalmente o MTTF.

### Os "noves" de disponibilidade

| Disponibilidade | Indisponibilidade anual | Indisponibilidade mensal | Indisponibilidade semanal |
|---|---|---|---|
| 90% ("um nove") | 36,5 dias | 72,0 horas | 16,8 horas |
| 99% ("dois noves") | 3,65 dias | 7,2 horas | 1,68 hora |
| 99,9% ("três noves") | 8,77 horas | 43,8 minutos | 10,1 minutos |
| 99,95% | 4,38 horas | 21,9 minutos | 5,0 minutos |
| 99,99% ("quatro noves") | 52,6 minutos | 4,38 minutos | 1,01 minuto |
| 99,999% ("cinco noves") | 5,26 minutos | 25,9 segundos | 6,05 segundos |
| 99,9999% ("seis noves") | 31,5 segundos | 2,6 segundos | 0,6 segundo |

Cada "nove" adicional é uma redução de 10× no tempo de indisponibilidade permitido. Passar de três para quatro noves não é uma melhoria incremental — exige uma postura operacional fundamentalmente diferente. Com cinco noves, o tempo de reação humano é lento demais; detecção e recuperação precisam ser totalmente automatizadas.

!!! info "Disponibilidade composta"
    Quando os serviços formam uma cadeia de dependências, suas disponibilidades se multiplicam. Três serviços com 99,9% cada resultam em `0.999³ ≈ 99.7%` de disponibilidade ponta a ponta — pior do que qualquer componente individual. É por isso que existem a redundância (múltiplas instâncias) e os padrões de isolamento (circuit breakers): para quebrar a cadeia de propagação de falhas.

---

## Modos de falha

Sistemas distribuídos falham de formas que sistemas de uma única máquina não falham. Falhas parciais — em que alguns componentes funcionam e outros não — são muito mais comuns do que indisponibilidades totais e consideravelmente mais difíceis de tratar corretamente.

``` mermaid
flowchart TD
    F[Falha] --> T[Transitória\nTemporária, se resolve sozinha\nex. oscilação breve de rede]
    F --> P[Permanente\nExige intervenção\nex. pane de disco, OOM kill]
    F --> I[Intermitente\nRecorrência imprevisível\nex. vazamento de memória, pausa de GC]
    P --> CS[Crash-stop\nO nó para e permanece parado]
    P --> BZ[Bizantina\nO nó se comporta de forma arbitrária ou incorreta]
```

| Classe de falha | Características | Estratégia de tratamento |
|---|---|---|
| **Transitória** | Resolve-se sozinha em segundos; é seguro fazer retry | Retry com backoff exponencial e jitter |
| **Permanente (crash-stop)** | O nó para de responder e nunca se recupera | Circuit breaker + failover para uma réplica saudável |
| **Intermitente** | Aparece e desaparece sem um gatilho claro | Histogramas de latência P99; alertas baseados em anomalias |
| **Bizantina** | O nó retorna dados incorretos sem cair | Protocolos de consenso; checksums; validação de entrada |

### Falhas em cascata

Uma única dependência lenta pode esgotar recursos de quem a chama — slots do pool de threads, entradas do pool de conexões, memória — e propagar esse esgotamento para cima, por todo o grafo de serviços. Esse é o padrão de falha mais perigoso em arquiteturas de microsserviços[^2].

``` mermaid
flowchart LR
    client -->|muitas requisições simultâneas| gateway:::saturated
    gateway -->|requisições se acumulam\nesperando resposta| payment:::slow
    client:::failed

    classDef slow fill:#f90,color:#000
    classDef saturated fill:#f66,color:#fff
    classDef failed fill:#900,color:#fff
```

Um serviço de pagamento cujo tempo de resposta degrada de 100 ms para 3 s faz o pool de threads do gateway se encher de threads bloqueadas, deixando sem recursos todo o restante do tráfego — inclusive rotas que não têm relação com pagamentos. **Timeouts, circuit breakers e bulkheads** são a resposta da engenharia a esse modo de falha.

---

## Tópicos abordados

<div class="grid cards" markdown>

-   :material-gauge:{ .lg .middle } **SLI / SLO / SLA**

    ---

    Como definir, medir e se comprometer com metas de confiabilidade. Aborda Service Level Indicators, Objectives e Agreements, e o modelo de error budget que orienta as decisões de engenharia.

    [:octicons-arrow-right-24: SLI / SLO / SLA](sli-slo-sla/)

-   :material-shield-refresh:{ .lg .middle } **Padrões de Resiliência**

    ---

    Técnicas de engenharia que impedem que falhas transitórias virem indisponibilidades: Timeout, Retry com backoff exponencial, Circuit Breaker, Bulkhead e Rate Limiting.

    [:octicons-arrow-right-24: Padrões de Resiliência](patterns/)

-   :material-lightning-bolt:{ .lg .middle } **Engenharia do Caos**

    ---

    A disciplina de injetar falhas proativamente em produção para descobrir fraquezas antes que elas virem incidentes. Aborda os princípios, as ferramentas e as práticas por trás de experimentos de caos controlados.

    [:octicons-arrow-right-24: Engenharia do Caos](chaos/)

</div>

---

[^1]: IEEE Standard Glossary of Software Engineering Terminology, IEEE Std 610.12-1990.
[^2]: NYGARD, M. *Release It! Design and Deploy Production-Ready Software*, 2nd ed. Pragmatic Programmers, 2018.
[^3]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/books/){target="_blank"}. Google / O'Reilly, 2016.
