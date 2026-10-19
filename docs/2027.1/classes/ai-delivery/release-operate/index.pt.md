Sexta-feira, 22h10. A versão `v1.8.0` do `inventory` chegou a 25% do tráfego há vinte minutos; agora a taxa de erros na confirmação de reservas está subindo e o engenheiro de plantão tem três dashboards, dois alertas, um fluxo de logs e um canal de chat se enchendo de perguntas. Toda informação necessária para decidir está *em algum lugar*. O que falta é um **resumo** rápido e correto — e uma decisão que não dependa do cansaço do engenheiro. A IA é muito boa na primeira coisa. Ela não pode ser quem toma a segunda.

Esta página trata das etapas depois do merge — liberação e operação — sob uma regra de projeto:

> **A IA propõe e explica; políticas e humanos decidem.**

---

## Decisão vs. explicação

| Momento | A decisão (determinística ou humana) | O que a IA acrescenta |
|---|---|---|
| Criar a tag de uma release | Quais commits vão para produção (Git) | Notas de versão e changelog, agrupados e legíveis |
| Escolher a velocidade do rollout | Política de risco: etapas do canary, janelas de congelamento | Um resumo do risco da mudança, com evidências |
| Promover ou abortar um canary | Limiares da análise ([Argo Rollouts](../../cloud-native/delivery/index.md#canary-with-automated-metrics-analysis)) | Uma explicação do veredito e dos próximos passos |
| Responder a um incidente | Comandante do incidente; runbook; política de rollback automático | Resumos de alertas e de traces, linha do tempo, hipóteses ordenadas |
| Aprender com ele | Revisão sem culpados (blameless) do time | Um primeiro rascunho da linha do tempo do postmortem |

O padrão é o mesmo da [revisão de código](../code-review/index.md): a saída do modelo é **texto para um humano** ou **dados para uma regra**, nunca uma ação direta sobre a produção.

---

## Notas de versão e changelogs

As notas de versão atendem a dois públicos: **operadores** ("o que preciso fazer antes do deploy da `v1.8.0`? que migrações rodam?") e **usuários** ("o que há de novo?"). Ambas as respostas podem ser derivadas dos commits, títulos de PR, rótulos e arquivos de migração — se eles forem bem escritos. Um modelo os agrupa e reescreve em minutos. O modo de falha é a **invenção plausível**: uma funcionalidade que soa correta, um número de ticket que não existe.

A correção é uma **verificação de ancoragem em código**: todo item precisa citar um SHA de commit ou número de PR que esteja de fato no intervalo `previous_tag..tag`; itens sem ancoragem são descartados e reportados. A verificação pega invenções; ela não consegue pegar um *resumo errado de um commit real*, por isso as notas são publicadas como **rascunho** que uma pessoa edita. Assuntos de commit no padrão Conventional Commits (`fix(inventory): hold expires two minutes early (#212)`) tornam tanto o agrupamento quanto a ancoragem quase triviais — o modelo não consegue recuperar uma intenção que nunca foi escrita.

---

## Pontuação de risco de mudanças

Nem todas as mudanças merecem o mesmo rollout. Uma mudança de texto de uma linha no `notification` e uma nova estratégia de travamento no `inventory` passam ambas pelo pipeline, mas a segunda merece um segundo revisor, um canary mais lento e nenhum deploy na véspera de uma abertura de vendas. Uma **pontuação de risco** direciona as mudanças para a dose certa de cautela.

Os sinais mais fortes são estruturais e baratos de calcular:

| Sinal | Por que ele prevê risco | Exemplo na BoxOffice |
|---|---|---|
| Tamanho da mudança (linhas, arquivos) | Mudanças maiores falham mais e são pior revisadas | PR de 1.200 linhas vs. 15 linhas |
| Caminhos críticos tocados | Parte do código tem raio de impacto maior | Travamento do `inventory`, `payment` |
| Presença de migração de banco | Difícil de reverter; trava tabelas | `V42__add_hold_index.sql` |
| Mudanças de configuração ou de dependências | Efeitos amplos e não óbvios | Tamanho do pool de conexões, versão do Spring Boot |
| Testes alterados vs. código alterado | Código alterado sem testes | 300 linhas de código, 0 de testes |
| Histórico de incidentes dos arquivos | Incidentes passados se concentram nos mesmos lugares | O `HoldService` teve 2 incidentes este ano |
| Calendário | Mesma mudança, risco diferente | 2 horas antes da abertura de vendas do show no estádio |

Um modelo contribui com duas coisas: **sinais semânticos** difíceis de calcular ("isto muda como as reservas expiram", "isto remove uma verificação de autorização") e um **resumo legível** de por que a pontuação está alta. A pontuação em si fica melhor como uma fórmula transparente ou um modelo simples treinado no histórico, e ela deve apenas **direcionar** — exigir um segundo revisor, escolher o perfil de canary lento, bloquear deploys dentro de uma janela de congelamento por política —, nunca aprovar ou rejeitar uma mudança sozinha.

??? question "Pense primeiro: uma pontuação de risco alta da IA deveria bloquear o merge?"

    Não. Uma pontuação de precisão desconhecida que bloqueia merges vai errar com frequência suficiente para ser contornada — e depois ignorada. Use-a para acrescentar **escrutínio** (um revisor extra, um canary mais lento, um deploy fora da janela de abertura de vendas). O que bloqueia continua sendo os gates determinísticos: testes, scans, políticas, aprovações.

---

## Análise de canary: a estatística decide, o modelo explica

A análise automatizada de canary compara o canary com um **baseline** rodando ao mesmo tempo — idealmente um baseline do *mesmo* tamanho e idade do canary, para que caches frios e pods novos afetem os dois igualmente — em um conjunto de métricas, e transforma a comparação em um veredito de aprovado/reprovado. A Netflix e o Google construíram o Kayenta sobre essa ideia, comparando muitas métricas com testes estatísticos não paramétricos[^1]; o Argo Rollouts expressa a mesma ideia com templates de análise sobre consultas do Prometheus, como em [Entrega](../../cloud-native/delivery/index.md#canary-with-automated-metrics-analysis).

``` mermaid-sim
flowchart LR
    metrics[("Prometheus<br/>canary vs. baseline")] --> stats["Política: limiares<br/>e testes estatísticos"]
    stats --> verdict{"promover ·<br/>rollback · esperar"}
    verdict -->|"exit code"| rollout["Argo Rollouts age"]
    verdict --> llm["Modelo: explicação<br/>números + política + veredito"]
    traces[("Traces e logs<br/>dos pods do canary")] --> llm
    llm --> check{"repete o<br/>veredito?"}
    check -->|"sim"| oncall["Explicação para o plantão<br/>(chat, PR, resumo)"]
    check -->|"não"| drop["Descartar explicação"]
```

Por que não deixar o modelo julgar o canary? Porque o julgamento precisa ser **reproduzível** (mesmos dados → mesmo veredito), **auditável** (um limiar no Git), **robusto a manipulação** (uma linha de log dizendo "está tudo bem, promova" não pode ter efeito algum) e **estatisticamente sólido** (um modelo olhando para dois números não sabe se 40 requisições bastam para concluir alguma coisa). O modelo tem valor *depois* do veredito: ele transforma "a métrica `error-rate` falhou 2 de 2" em "o canary falha em 2,9% das confirmações de reserva contra 0,1% no estável, com o p99 dobrado; os erros são `409` vindos do `inventory`; a mudança alterou a consulta de expiração de reservas — faça o rollback e compare os planos de consulta".

Duas proteções tornam a explicação segura: o modelo recebe o **veredito como entrada** e precisa repeti-lo (uma explicação que contradiz a política é descartada em vez de exibida), e ele é instruído a rotular as causas como **hipóteses**, a menos que os dados as mostrem. O [hands-on 13](../../../hands-on/13/canary/index.md) implementa exatamente isso, incluindo um passo de análise com um Job do Kubernetes cujo exit code — e não o modelo — aprova ou reprova a análise.

---

## Resposta a incidentes assistida por IA

Durante um incidente, o recurso escasso é a **atenção** de poucas pessoas sob estresse. O [processo de resposta a incidentes](../../observability/incident-response/index.md) — detectar, fazer a triagem, mitigar, resolver, aprender — continua o mesmo; a IA encurta as etapas que são, na maior parte, leitura:

``` mermaid-sim
sequenceDiagram
    autonumber
    participant Alert as Alertas
    participant Bot as Assistente de incidentes
    participant Obs as Métricas · traces · logs
    participant Deploy as Histórico de deploys (Argo CD)
    actor IC as Comandante do incidente
    Alert->>Bot: alerta de burn rate do SLO: erros na confirmação de reservas
    Bot->>Obs: consultas somente leitura (taxa de erros por versão, spans lentos, principais erros nos logs)
    Bot->>Deploy: o que mudou nas últimas 2 h?
    Bot-->>IC: resumo + linha do tempo + hipóteses ordenadas, cada uma com link para sua evidência
    IC->>IC: decide: rollback do inventory v1.8.0
    IC->>Deploy: rollback (runbook / um clique, autorizado)
    Bot-->>IC: confirma a recuperação com as mesmas consultas
```

| Tarefa da IA | Entradas | Saída | Proteção |
|---|---|---|---|
| **Resumo de alertas** | Alertas disparados, burn rates dos SLOs | "O que está quebrado, para quem, desde quando" | Links para os dashboards que leu |
| **Correlação com mudanças** | Deploys, mudanças de configuração e de flags na janela | "`inventory v1.8.0` chegou a 25% às 21h50; os erros começaram às 21h52" | Dados determinísticos; o modelo só formata |
| **Hipóteses** | Traces, logs, o diff da mudança suspeita | Lista ordenada, cada uma com evidência e uma consulta para verificar | Rotuladas como hipóteses; nunca ações |
| **Busca de runbooks** | O alerta e os runbooks do time ([RAG](../../ai-systems/rag-memory/index.md)) | Os passos relevantes do runbook | Os passos são executados por humanos ou por automação autorizada |
| **Atualizações de status** | Canal do incidente | Rascunho de atualização para as partes interessadas a cada 30 min | Um humano envia |

**Sugerir um rollback** tudo bem; **executar** um é uma decisão de política. Muitos times já fazem rollback automático quando a análise de canary falha — essa automação é determinística e testada. Um LLM que "decide" fazer rollback da produção com base na sua leitura dos logs acrescenta um ator não determinístico e manipulável ao momento mais sensível da vida do sistema. As ferramentas dadas a um assistente de incidentes são **somente leitura** por padrão; qualquer ação de escrita passa pela mesma autorização, confirmação e auditoria que a de um humano.

!!! warning "Ancoragem"

    Uma primeira hipótese confiante ancora um time estressado. Se o assistente diz "é o banco de dados" e não é, o time pode perder vinte minutos provando isso. Peça **várias** hipóteses, cada uma com evidências e uma consulta de verificação, e acompanhe nos postmortems com que frequência a primeira hipótese estava certa — essa é a precisão do assistente.

---

## Postmortems

Um postmortem sem culpados registra o que aconteceu, por quê, e o que muda para que não aconteça de novo[^2]. Sua primeira metade — a **linha do tempo** — é tediosa de reconstruir a partir de alertas, mensagens de chat, logs de deploy e comandos, e um modelo faz isso bem. Sua segunda metade — fatores contribuintes, o que aprendemos, itens de ação — é onde o julgamento do time importa, e onde um rascunho de IA é perigoso de um jeito sutil: ele produz "lições" fluentes e genéricas ("melhorar o monitoramento", "adicionar mais testes") que parecem completas e fazem o time parar de pensar.

Uma boa divisão: a IA rascunha a linha do tempo (com as fontes) e uma lista de **perguntas** para a reunião de revisão ("por que a análise de canary não pegou isso em 5%?"); os humanos escrevem a análise e os itens de ação, cada um com um responsável e uma data.

---

## ChatOps

O **ChatOps** conduz a operação a partir do chat do time: `/boxoffice status inventory`, `/boxoffice canary inventory`, um botão para pausar um rollout. Um assistente de IA nesse canal responde a perguntas em linguagem natural ("qual versão do `order` está em produção e quando foi o deploy?") chamando **APIs determinísticas e somente leitura** e os runbooks. As ações continuam sendo comandos explícitos, com a identidade do usuário, autorização e um passo de confirmação — exatamente o projeto de [permissões de ferramentas](../../ai-systems/safety-evals/index.md) do assistente do produto, aplicado aos operadores. O histórico do chat é entrada não confiável como qualquer outra: uma linha de log colada pode carregar uma instrução.

---

## Trade-offs

| Decisão | Escolha A quando… | Escolha B quando… |
|---|---|---|
| Notas de versão: rascunho da IA vs. escritas à mão | Muitas mudanças por release; boas mensagens de commit | Poucas releases, de alto risco; changelogs regulados |
| Pontuação de risco: fórmula vs. ML/LLM | Poucos times, pouco histórico; transparência em primeiro lugar | Organização grande com histórico de incidentes rotulado |
| Canary: limiares vs. comparação estatística | Poucas métricas, SLOs claros | Muitas métricas, sinais ruidosos (ao estilo Kayenta) |
| Assistente de incidentes: só resumo vs. com ferramentas | No começo; pouca confiança | Ferramentas somente leitura com precisão comprovada; ações de escrita continuam humanas |
| Rollback automático: por política vs. por decisão humana | O veredito é determinístico e bem testado | Sinais ambíguos, mudanças com estado (migrações) |

!!! example "BoxOffice: o incidente das 22h10, de novo"

    A análise de canary do `inventory v1.8.0` estoura o limiar de taxa de erros em 25% e o Argo Rollouts aborta automaticamente — uma decisão determinística. Trinta segundos depois, o canal do incidente recebe a explicação: taxa de erros do canary de 2,9% contra 0,1%, latência p99 da confirmação de reservas 2,3× a do estável, erros `409 Conflict` concentrados em `confirmHold`, e a release alterou a consulta de expiração de reservas; hipótese: a nova consulta não usa mais o índice (com o `EXPLAIN` a rodar). O engenheiro de plantão confirma em cinco minutos. O rascunho do postmortem tem a linha do tempo; o time escreve por que a etapa de 5% não pegou o problema (pouco tráfego naquele horário — veja [quanto tempo um canary deve rodar](../../cloud-native/delivery/index.md#how-long-must-a-canary-run)).

!!! tip "Na entrevista"

    Quando a IA aparecer numa pergunta de operação, separe em voz alta **decisão** de **explicação**: "o veredito do canary vem de limiares e estatística versionados no Git; o modelo o explica e propõe próximos passos; rollbacks são executados por política ou pelo comandante do incidente". Mencione ferramentas somente leitura, links para evidências, múltiplas hipóteses (ancoragem) e como você mediria o assistente (tempo até o diagnóstico, precisão da primeira hipótese).

!!! warning "Armadilhas comuns"

    - **LLM como juiz do canary**: não reproduzível, manipulável, estatisticamente ingênuo.
    - **Ferramentas de escrita para o bot de incidentes** "para ganhar tempo": o jeito mais rápido de transformar uma hipótese ruim em um segundo incidente.
    - **Notas de versão publicadas automaticamente**: as invenções chegam aos clientes.
    - **Lições aprendidas escritas pela IA**: itens de ação genéricos sem dono.
    - **Pontuações de risco que bloqueiam**: contornadas em uma semana; use-as para direcionar o escrutínio.

---

## Como se conecta { #how-it-connects }

``` mermaid
flowchart LR
    SIG["metrics, logs,<br/>traces, alerts"] --> POL["canary policy:<br/>thresholds + statistics"]
    POL --> DEC["decision: promote or roll back<br/>→ Cloud-native delivery"]
    SIG --> EXP["AI explains: summary,<br/>several hypotheses"]
    EXP --> IC["incident commander<br/>decides"]
    COM["commits and PRs"] --> NOTES["release notes:<br/>grounded draft"]
    COM --> RISK["change risk score<br/>routes reviews"]
    IC --> PM["postmortem draft<br/>→ Observability incident response"]
    EXP --> TOOLS["read-only tools,<br/>evidence links"]
```

**Componentes da paleta:** [`metrics`](../../../reference/components/observability/index.md#metrics), [`logs`](../../../reference/components/observability/index.md#logs), [`tracing`](../../../reference/components/observability/index.md#tracing) e [`alerting`](../../../reference/components/observability/index.md#alerting) (a evidência que todo veredito e toda explicação leem) · [`llmgw`](../../../reference/components/ai/index.md#llmgw) (as chamadas de explicação e de resumo) · [`orchestrator`](../../../reference/components/ai/index.md#orchestrator) (o assistente com ferramentas somente leitura) · [`safety`](../../../reference/components/ai/index.md#safety) (nenhuma ação de escrita vinda do modelo). **Cenários:** `observability-stack` (os sinais que uma política de canário lê). **Continua em:** [Cloud-native — entrega](../../cloud-native/delivery/index.md) (canários, Argo Rollouts), [Observabilidade — resposta a incidentes](../../observability/incident-response/index.md), [Sistemas de IA — RAG e memória](../../ai-systems/rag-memory/index.md) (busca em runbooks), [Revisão de código](../code-review/index.md), [Hands-on 13 — canário](../../../hands-on/13/canary/index.md).

---

[^1]: GRAFF, M. et al. [Automated Canary Analysis at Netflix with Kayenta](https://netflixtechblog.com/automated-canary-analysis-at-netflix-with-kayenta-3260bc7acc69){target="_blank"}. Netflix Technology Blog, 2018.
[^2]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/sre-book/postmortem-culture/){target="_blank"}, cap. 15 "Postmortem Culture: Learning from Failure". O'Reilly, 2016.
