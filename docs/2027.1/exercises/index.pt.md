As aulas e os labs mostram como as coisas funcionam; os exercícios fazem você **fazer sozinho e provar com números**. Cada exercício individual treina uma habilidade que quem projeta sistemas usa toda semana: estimar, compor componentes, medir, usar cache, tornar o processamento assíncrono, escalar automaticamente e escrever um design de forma que outra pessoa possa revisá-lo. O [projeto em equipe](project/index.md) junta tudo em um sistema que vocês constroem, testam sob carga, quebram de propósito e defendem.

!!! abstract "Para que servem os exercícios"

    Ao final dos exercícios você será capaz de:

    - **Estimar** carga, armazenamento e banda de um sistema antes de construí-lo, e usar esses números para escolher componentes.
    - **Compor** componentes da paleta em um design que atende a metas de latência, disponibilidade e custo — e explicar por que ele funciona.
    - **Medir** um serviço real com k6, ler percentis e encontrar o seu gargalo.
    - **Mudar** uma arquitetura (cache, réplica, fila, autoscaler) e **provar** o efeito com um experimento de antes/depois.
    - **Comunicar** um design como um design doc com ADRs e defendê-lo oralmente.

## Visão geral { #overview }

| # | Exercício | O que treina | Aula / lab relacionados | Prazo | Peso | Entrega |
|:-:|-|-|-|:-:|:-:|-|
| 1 | [Estimativas](estimation/index.md) | Contas de guardanapo para 5 sistemas | [Aula 2](../classes/estimation/index.md) · [Lab 2](../hands-on/2/index.md) | Semana 3 | 10% | Página com a planilha de estimativas |
| 2 | [Relatório de teste de carga](load-test-report/index.md) | Campanha k6, percentis, o joelho, análise do gargalo | [Aula 2](../classes/estimation/index.md) · [Labs 2–3](../hands-on/2/index.md) | Semana 6 | 15% | Página + scripts k6 + resultados brutos |
| 3 | [Cache e banco de dados](cache-db/index.md) | Cache-aside + réplica de leitura, antes/depois | [Aulas 6–7](../classes/caching/index.md) · [Labs 5–6](../hands-on/5/index.md) | Semana 8 | 15% | Página + código + medições |
| 4 | [Orientado a eventos](event-driven/index.md) | Outbox transacional + consumidor idempotente + DLQ | [Aula 8](../classes/messaging/index.md) · [Lab 7](../hands-on/7/index.md) | Semana 10 | 15% | Página + código + demonstração de falhas |
| 5 | [Autoscaling no Kubernetes](kubernetes-autoscaling/index.md) | Probes, requests/limits, HPA sob carga k6 | [Aula 11](../classes/cloud-native/index.md) · [Lab 10](../hands-on/10/index.md) | Semana 14 | 10% | Página + manifestos + vídeo |
| 6 | [Design no playground](playground-design/index.md) | Compor componentes para atingir metas de SLO + custo, com aleatoriedade | [Playground](../../playground/index.md) · Aulas 4–13 | Semana 15 | 15% | JSON exportado + justificativa + relatórios das execuções |
| 7 | [Design doc](design-doc/index.md) | Design escrito + ADRs para um problema de entrevista, defesa oral | [Aula 16](../classes/case-studies/index.md) · [Entrevista](../support/interview/index.md) | Semana 17 | 20% | Página do design doc + ADRs + defesa oral |
| | [Projeto em equipe](project/index.md) | Construir, medir, quebrar e defender um sistema inteiro | Todas | Semanas 3–20 | — | Repositório + documentação + apresentação |

!!! info "As semanas são relativas"

    "Semana *n*" é a *n*-ésima semana do semestre. As datas do calendário, os dias de quiz e de prova estão na [página de planejamento](../planning.md). Salvo aviso do professor, um exercício vence no **último dia de aula da sua semana, às 23:59**. Os pesos são a participação de cada exercício dentro do componente *exercícios* da nota; como esse componente entra na nota final está na [página do curso](../index.md).

## Como os exercícios são avaliados { #how-the-exercises-are-graded }

Cada exercício e cada entrega do projeto recebe um **conceito**, como nas edições anteriores (*Notas da Engenharia* do Insper):

| Conceito | Nota |
|:-:|:-:|
| A (+) | 9 (10) |
| B (+) | 7 (8) |
| C (+) | 5 (6) |
| D | 4 |
| I | 0 |

Cada página de exercício tem uma **rubrica**: uma linha por critério e uma coluna por nível. Os níveis significam sempre a mesma coisa:

| Nível | Significado |
|:-:|-|
| **I** | Não entregue, não reprodutível, copiado, resultados que não foram produzidos por você — ou reprovação na verificação oral. |
| **D** | Entregue, mas pelo menos um requisito *obrigatório* está ausente ou errado. |
| **C** | Todos os requisitos obrigatórios atendidos; a análise é rasa (números mostrados, pouca explicação). |
| **B** | C, mais uma análise sólida: os números sustentam as conclusões, os trade-offs são nomeados, a página é clara. |
| **A** | B, mais profundidade: um experimento ou comparação extra, uma percepção não óbvia, acabamento e reprodutibilidade completos. |

O conceito final de uma entrega é o nível que melhor descreve **a maioria** dos critérios; um critério marcado como **(obrigatório)** limita a nota a D quando não é atendido. O **+** é dado quando o trabalho vai claramente além da descrição do nível.

!!! tip "Critérios de aceitação primeiro"

    Todo exercício lista os seus **requisitos** como uma checklist. Antes de entregar, marque cada item na sua própria cópia. Uma checklist com um item obrigatório desmarcado é o motivo mais comum de um D.

## Regras gerais { #general-rules }

### Repositório e documentação { #repository-and-documentation }

- [ ] **Um repositório GitHub por aluno** para os exercícios individuais (público, ou privado com o professor e o assistente adicionados como colaboradores). Nome sugerido: `sysdesign-<seu-usuario-github>`.
- [ ] **Documentação publicada no GitHub Pages**, feita com MkDocs Material ou Zensical — você pode partir do [template de documentação](https://hsandmann.github.io/documentation.template/){target="_blank"}. Uma página por exercício, com link a partir da página inicial, e o seu nome e usuário GitHub na página inicial.
- [ ] **Tudo o que é preciso para reproduzir os seus resultados está no repositório**: código, `compose.yaml`/manifestos, scripts k6, resultados brutos (resumo JSON do k6, CSV), capturas de tela e uma seção curta de "como executar". Não versione segredos: use `.env.example` e os secrets do GitHub.
- [ ] **A entrega é uma tag**: crie a tag `ex<n>` (por exemplo, `ex3`) no commit que deve ser avaliado e envie o link do Pages e a tag pelo Blackboard. Commits depois da tag são ignorados naquele exercício.
- [ ] O código dos labs e exercícios parte do **repositório do curso** ([repo-classes/pma271](https://github.com/repo-classes/pma271){target="_blank"}); diga na sua página quais partes você alterou.

### Uso de ferramentas de IA { #use-of-ai-tools }

Ferramentas de IA (assistentes de chat, assistentes de código, agentes) **são permitidas** — elas fazem parte de como software é construído em 2026, e aprender a usá-las bem faz parte do curso. As regras:

1. **Você é responsável por cada linha e cada número.** Se você entregou, precisa conseguir explicar, executar e alterar na hora.
2. **Declare o uso.** Cada página de exercício termina com uma seção *Uso de IA*: quais ferramentas, para quê (por exemplo, "gerou o esqueleto do script k6", "revisou minha ADR") e o que você conferiu ou alterou por conta própria.
3. **Medições não podem ser geradas.** Números, gráficos e capturas de tela precisam vir de execuções feitas por você. Resultados inventados ou "ajustados" recebem **I** e são tratados como uma questão de integridade acadêmica.
4. **Texto escrito por um modelo ainda precisa estar certo.** Afirmações erradas escritas com confiança custam mais que um honesto "não testamos isso".

!!! danger "Verificação oral"

    **Qualquer** nota de exercício ou do projeto pode ser validada em uma verificação oral curta (5–10 minutos): explicar uma decisão, reexecutar um experimento, mudar um parâmetro e prever o resultado, ou percorrer um trecho de código. Se a verificação mostrar que você não consegue explicar a sua própria entrega, aquela nota vira **I**. O [design doc](design-doc/index.md) sempre tem defesa oral.

### Política de atraso { #late-policy }

!!! warning "Política de atraso — a ser definida pelo professor"

    *Espaço reservado.* As regras para entregas atrasadas (período de tolerância, penalidade por dia, atraso máximo, verificações orais perdidas) serão anunciadas pelo professor no início do semestre e publicadas aqui.

### Colaboração { #collaboration }

Discutir ideias com colegas é incentivado; **compartilhar código, resultados ou texto dos exercícios individuais não é**. Se um colega te ajudou, diga isso na página (como faz com a IA). O trabalho em equipe acontece no [projeto](project/index.md), onde estão as regras das equipes.

## Estrutura sugerida da página { #suggested-page-structure }

Cada página de exercício na sua documentação deve ser fácil de avaliar. Use este esqueleto (cada exercício acrescenta o seu próprio template a ele):

=== "English"

    ~~~markdown
    # Exercise <n> — <title>

    **Student:** <name> (<github-user>) · **Tag:** ex<n> · **Date:** <yyyy-mm-dd>

    ## Summary
    Three to five lines: what you did, the main result (with a number), the main lesson.

    ## Requirements checklist
    - [x] requirement 1 — where to find the evidence (link/section)
    - [x] requirement 2 — ...

    ## Setup
    Machine (CPU, RAM, OS), versions (Docker, JDK, k6...), how to reproduce (commands).

    ## Work
    The exercise-specific sections (see the exercise template).

    ## Results and discussion
    Tables/charts from your runs. What the numbers mean. What surprised you.

    ## AI usage
    Tools used, for what, and what you verified or changed yourself.

    ## References
    ~~~

=== "Português"

    ~~~markdown
    # Exercício <n> — <título>

    **Aluno(a):** <nome> (<usuário-github>) · **Tag:** ex<n> · **Data:** <aaaa-mm-dd>

    ## Resumo
    Três a cinco linhas: o que você fez, o resultado principal (com um número), a principal lição.

    ## Checklist de requisitos
    - [x] requisito 1 — onde está a evidência (link/seção)
    - [x] requisito 2 — ...

    ## Ambiente
    Máquina (CPU, RAM, SO), versões (Docker, JDK, k6...), como reproduzir (comandos).

    ## Desenvolvimento
    As seções específicas do exercício (veja o template do exercício).

    ## Resultados e discussão
    Tabelas/gráficos das suas execuções. O que os números significam. O que te surpreendeu.

    ## Uso de IA
    Ferramentas usadas, para quê, e o que você verificou ou alterou por conta própria.

    ## Referências
    ~~~

Você pode escrever a sua documentação em inglês ou em português.
