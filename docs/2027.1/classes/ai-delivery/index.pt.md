A BoxOffice tem doze engenheiros e faz merge de cerca de sessenta pull requests por semana. Um PR espera, em média, quase um dia útil inteiro pela primeira revisão humana; a abertura das vendas de um show em estádio é daqui a três semanas. Na reunião de planejamento, alguém diz o óbvio: *"Vamos colocar IA no pipeline."* Duas semanas depois, o time tem um bot que deixa quinze comentários em cada PR (as pessoas pararam de lê-los no terceiro dia), um agente que "consertou" um build vermelho apagando o teste que falhava, notas de versão anunciando uma funcionalidade de reembolso que ninguém construiu e uma fatura que ninguém previu.

Nada disso é problema dos modelos. As mesmas ferramentas, bem projetadas, reduzem a latência da revisão, encontram bugs reais, escrevem testes úteis e encurtam incidentes. A diferença está no **projeto do sistema**: onde a etapa de IA fica no ciclo de entrega, que contexto recebe, o que tem permissão para fazer, como sua saída é verificada, quanto custa e como o time sabe se ela ajuda. Esta aula aplica a caixa de ferramentas do curso — componentes, modos de falha, números, trade-offs — à **IA dentro do pipeline de entrega de software**.

!!! quote "A história até aqui"

    Capítulo 14 da [história da disciplina](../../index.md#story). Toda mudança na BoxOffice passa pelo pipeline do [lab 11](../../hands-on/11/index.md) — build, testes, varredura, assinatura, canary — e, desde a [aula 13](../ai-systems/index.md), um modelo roda dentro do produto. Agora os mesmos modelos escrevem o código, e as mudanças chegam mais rápido do que as pessoas que as revisam, testam e liberam. **Esta aula** responde: onde a IA pode acelerar a entrega sem virar quem aprova o próprio trabalho?

!!! abstract "Objetivos de aprendizagem"

    Ao final desta aula, você deve ser capaz de:

    - **Mapear** as capacidades de IA para cada etapa do ciclo de entrega (planejar, codificar, revisar, testar, construir, liberar, operar) e **posicionar** uma ferramenta no espectro que vai do assistente ao agente autônomo.
    - **Projetar** um revisor de pull requests com IA: contexto, saída estruturada, controle de ruído, consultivo vs. gate, e como **medir** sua precisão.
    - **Avaliar** testes gerados por IA com testes de mutação e **explicar** o problema do oráculo, a triagem de testes flaky e a seleção de testes.
    - **Especificar** um agente que roda sem interface (headless) no CI com privilégio mínimo, orçamentos, idempotência, verificação e trilha de auditoria.
    - **Separar** decisão de explicação na liberação e na operação: pontuação de risco, análise de canary, resumos de incidentes, postmortems.
    - **Modelar as ameaças** da IA no pipeline (prompt injection, exfiltração de segredos, slopsquatting, cadeia de suprimentos) e **definir** uma política de governança, incluindo a avaliação das próprias ferramentas de IA.
    - **Estimar** o custo em tokens, em runner e em atenção de uma etapa de IA e **prever** seu efeito nas métricas DORA.

## Roteiro { #roadmap }

1. **Esta visão geral** — IA ao longo do ciclo de entrega, o espectro de autonomia, o contrato de uma etapa de IA, métricas DORA e custo.
2. [Revisão de código](code-review/index.md) — em que a revisão por IA é boa e ruim, engenharia de contexto, achados estruturados, controle de ruído, gates, precisão, conformidade com a arquitetura.
3. [Testes](testing/index.md) — testes gerados e testes de mutação, testes de contrato e baseados em propriedades, scripts de carga a partir do OpenAPI, triagem de testes flaky, seleção de testes, dados sintéticos, o problema do oráculo.
4. [Agentes no CI](agents-in-ci/index.md) — agentes de correção do build, de dependências e de migração; execuções headless; sandboxing, permissões, orçamentos, idempotência e auditoria.
5. [Liberação e operação](release-operate/index.md) — notas de versão, pontuação de risco de mudanças, análise de canary, resposta a incidentes, postmortems, ChatOps: *a IA propõe, políticas e humanos decidem*.
6. [Segurança e governança](security-governance/index.md) — prompt injection no pipeline, exfiltração, slopsquatting, SLSA, SBOM e assinatura, política como código, licenciamento, privacidade, governança de custos e avaliação de ferramentas de IA.
7. [Quiz](quiz.md) — verifique seu entendimento.

## Slides

<div class="slides-embed">
  <iframe src="slides/ai-delivery.html" title="Slides: entrega assistida por IA" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/ai-delivery.html){:target="_blank"}

---

## Pré-requisitos de aulas anteriores { #prerequisites-from-earlier-classes }

Esta aula não repete dois fundamentos; leia-os antes, se necessário:

- [Cloud-native — Entrega](../cloud-native/delivery/index.md): CI, GitOps com Argo CD, estratégias de deploy, análise de canary com Argo Rollouts e as métricas DORA. Cada etapa de IA aqui **se encaixa** nesse pipeline.
- [Sistemas de IA e agentes](../ai-systems/index.md): o LLM como dependência (tokens, latência, custo), o [LLM gateway](../ai-systems/llm-gateway/index.md), o [loop do agente](../ai-systems/agents/index.md) e [segurança e avaliações](../ai-systems/safety-evals/index.md). Aqui os "usuários" do modelo não são fãs, mas **engenheiros e pipelines**.

---

## IA ao longo do ciclo de entrega { #ai-across-the-delivery-lifecycle }

O ciclo de entrega de software é uma sequência de etapas, cada uma com suas entradas, saídas e modos de falha. A IA pode ajudar em todas elas — mas o que "ajudar" significa, e o que pode dar errado, varia muito:

| Etapa | O que a IA faz | Exemplo na BoxOffice | Principal risco | Controle |
|---|---|---|---|---|
| **Planejar** | Rascunha especificações e ADRs, divide o trabalho, estima impacto | Rascunho do ADR "Redis para reservas de assentos vs. PostgreSQL" a partir da discussão | Raciocínio de projeto confiante, mas errado | ADR sob responsabilidade humana, revisado pelo arquiteto |
| **Codificar** | Completa código, escreve funcionalidades na IDE ou como agente | Implementa `GET /catalog/events?city=` com testes | Código plausível com bugs sutis; padrões inseguros; pacotes inventados | Revisão, testes, SAST, política de dependências |
| **Revisar** | Revisa PRs: bugs, segurança, convenções, regras de arquitetura | Aponta o `order` escrevendo no schema de `inventory` | Ruído; falsa sensação de segurança; ingenuidade diante de texto injetado | Precisão medida, consultivo primeiro, aprovação humana |
| **Testar** | Gera testes, faz triagem dos flaky, seleciona o que rodar | Testes unitários para a expiração de reservas; escolhe os 40 testes relevantes entre 4.000 | Testes que afirmam bugs; testes relevantes pulados | Mutation score, rede de segurança com execuções completas |
| **Construir** | Explica falhas, propõe correções, atualiza dependências | Corrige um erro de compilação após um upgrade do Spring Boot | Agente dobra os testes para passar; permissões excessivas | Sandbox, nenhum token de escrita, verificação, PRs em rascunho |
| **Liberar** | Notas de versão, changelogs, pontuação de risco de mudanças | Notas da `v1.8.0` com a nova migração do Flyway | Funcionalidades inventadas; estimativa de risco errada | Ancoragem nos commits; o risco só *direciona* revisões |
| **Operar** | Explica canaries, resume incidentes, sugere runbooks, rascunha postmortems | "O canary de `inventory` falha porque o p99 dobrou após a mudança no pool" | Diagnóstico errado seguido sob estresse; rollbacks autônomos | A política decide; humanos agem; a IA explica |

``` diagram-sim
flowchart LR
    plan["Planejar<br/>IA rascunha ADR"] --> code["Codificar<br/>assistente / agente"]
    code --> pr["Pull request"]
    pr --> review["Revisão por IA<br/>comentários consultivos"]
    pr --> tests["Testes no CI<br/>+ testes gerados por IA<br/>julgados pelo mutation score"]
    review --> human{"Aprovação humana<br/>(proteção de branch)"}
    tests --> human
    tests -->|"build vermelho"| agent["Agente de correção<br/>PR em rascunho"]
    agent --> human
    human --> build["Build · scan · SBOM · assinatura"]
    build --> release["Notas de versão<br/>rascunho ancorado"]
    release --> canary["Canary<br/>veredito da política + explicação da IA"]
    canary --> operate["Operar<br/>resumo de incidente pela IA"]
    operate -->|"rascunho de postmortem"| plan
```

Repare na forma: as etapas de IA **se ramificam** a partir do caminho principal e voltam por uma **verificação determinística ou um humano** antes que qualquer coisa mude em produção. É esse o padrão que o restante da aula desenvolve.

---

## O espectro de autonomia { #the-autonomy-spectrum }

"IA no pipeline" abrange ferramentas com autonomias muito diferentes. Uma escala útil, emprestada da forma como a indústria fala de automação na direção de veículos, é *quem decide a próxima ação e quem responde por ela*:

| Nível | Nome | A IA… | Um humano… | Exemplo na BoxOffice |
|---|---|---|---|---|
| 0 | **Assistente** | responde quando perguntada | pergunta, lê, decide tudo | "Explique este stack trace" num chat |
| 1 | **Copiloto** | sugere inline, no contexto | aceita ou rejeita cada sugestão | Autocompletar da IDE enquanto escreve o `HoldService` |
| 2 | **Revisor / redator** | produz um artefato a partir de um evento (comentário, teste, notas) | revisa o artefato; nada é aplicado automaticamente | O revisor de PRs e o rascunho das notas de versão |
| 3 | **Agente supervisionado** | planeja e executa vários passos com ferramentas, em um sandbox, e **propõe** uma mudança | aprova o resultado (PR em rascunho, pedido de mudança) | O agente de correção do build abrindo um PR em rascunho |
| 4 | **Agente autônomo** | executa e **aplica** mudanças dentro de guardrails, sem aprovação a cada mudança | define políticas e audita depois | Upgrades de patch de dependências com merge automático e CI verde |

Subir na escala compra vazão e custa controle. O nível certo depende do **raio de impacto** de um erro e de quão **verificável** é a saída: a correção de um erro de digitação na documentação pode ser nível 4; uma mudança no travamento de assentos do `inventory` fica no nível 2–3, por melhor que seja o modelo. A responsabilidade nunca passa para a ferramenta: o engenheiro que faz o merge de uma mudança escrita por IA é dono dela.

??? question "Pense primeiro: qual nível para cada caso?"

    (a) Atualizar o `jackson-databind` de 2.18.1 para 2.18.2 em todos os serviços; (b) reescrever o `SELECT … FOR UPDATE` do `inventory`; (c) traduzir as mensagens de erro do `notification` para o espanhol.

    (a) O nível 4 é razoável *se* o CI for confiável: versão de patch, testes automatizados, canary — é o que o merge automático do Dependabot/Renovate já faz sem IA. (b) Nível 2, no máximo: bugs de concorrência são difíceis de testar, e o raio de impacto é "reserva duplicada às 10h". (c) Nível 3: um agente pode fazer o trabalho e abrir um PR, mas um falante nativo o revisa — a correção não é verificável por máquina.

---

## O contrato de uma etapa de IA { #the-contract-of-an-ai-step }

Toda etapa de IA em um pipeline — revisão, geração de testes, agente de correção, notas, explicação de canary — pode ser projetada com o mesmo contrato de cinco partes. Escrevê-lo para cada etapa é o jeito mais rápido de descobrir o que está faltando:

| Parte | Pergunta | Exemplo do revisor |
|---|---|---|
| **Gatilho** | Que evento a inicia, e qual *não* deve iniciá-la? | `pull_request` opened/synchronize; não em rascunhos, não em forks |
| **Contexto** | O que ela lê, e o que disso não é confiável? | Diff (não confiável), texto do PR (não confiável), `CONVENTIONS.md`, ADRs |
| **Saída** | Em que formato, e como é validada? | Achados em JSON contra um schema; só linhas adicionadas; limiares |
| **Ação** | O que ela altera, com qual permissão? | Comentários inline, `pull-requests: write`; nunca aprova |
| **Orçamento e fallback** | Tempo, tokens e dólares máximos? E se o modelo estiver fora do ar ou errado? | 10 min, ~US$ 0,02; fail open (sem comentários) |

Duas propriedades decorrem do contrato. **Privilégio mínimo**: a permissão da ação é o máximo que a etapa pode fazer, diga o modelo o que disser. **Direção segura de falha**: decida de antemão se uma indisponibilidade da IA bloqueia o pipeline (fail closed) ou pula a etapa (fail open). Etapas consultivas falham abertas; um gate de segurança do qual você depende deve falhar fechado — e então precisa ser muito confiável.

---

## O que acontece com as métricas DORA { #what-happens-to-the-dora-metrics }

As métricas DORA — frequência de deploy, lead time de mudanças, taxa de falha de mudanças e tempo de restauração — são definidas em [Entrega](../cloud-native/delivery/index.md#measuring-delivery-the-dora-metrics). A IA muda as entradas das quatro, nem sempre na direção esperada:

- O **lead time** pode cair (primeira revisão mais rápida, correção mais rápida de builds vermelhos) — ou subir, se os PRs ficarem maiores porque gerar código é barato e revisá-lo é lento.
- A **frequência de deploy** acompanha o lead time, mas só se os lotes continuarem pequenos.
- A **taxa de falha de mudanças** pode subir se a atenção na revisão cair ("o bot já olhou") ou se código gerado for mergeado sem ser entendido; pode cair se a revisão e os testes por IA pegarem defeitos reais.
- O **tempo de restauração** pode cair com bons resumos de incidentes e diagnóstico mais rápido; pode subir se uma explicação errada e confiante mandar o engenheiro de plantão pelo caminho errado.

A pesquisa até agora é um alerta contra supor a direção boa. O relatório DORA de 2024 estimou que um aumento de 25% na adoção de IA estava associado a uma **queda de 1,5% na vazão de entrega** e a uma **queda de 7,2% na estabilidade da entrega**, mesmo com as pessoas relatando maior produtividade e melhor qualidade de código e de documentação[^1]; os autores apontam lotes maiores e fundamentos mais fracos como causas plausíveis. A pesquisa DORA de 2025 descreve a IA como um **amplificador** do que a organização já é — plataformas fortes, lotes pequenos e bons testes ficam mais fortes; os fracos ficam mais fracos[^2]. E, em um ensaio clínico randomizado de 2025, desenvolvedores experientes de código aberto levaram **19% mais tempo** com ferramentas de IA, acreditando estar cerca de 20% mais rápidos[^3].

A resposta de engenharia não é evitar a IA, mas **medi-la como qualquer outra mudança** — com um período de referência (baseline) e métricas por etapa:

| Etapa | Métrica antecedente | Métrica de negócio que ela deveria mover |
|---|---|---|
| Revisão por IA | precisão (aceitos ÷ comentários avaliados), comentários por PR | tempo até a primeira revisão, defeitos escapados |
| Testes por IA | ganho de mutation score, testes mantidos após revisão | taxa de falha de mudanças |
| Agente de correção | propostas mergeadas ÷ propostas, turnos e US$ por proposta | tempo em que um build fica vermelho |
| Notas de versão | itens editados ou descartados por humanos | tempo para escrever as notas; tempo de diagnóstico de incidentes |
| Explicação de canary | explicações coerentes com a política; feedback do plantão | tempo de restauração |

---

## Os números: quanto custa uma etapa de IA { #the-numbers-what-an-ai-step-costs }

Uma etapa de IA tem três custos: **tokens** (a conta do provedor), **minutos de runner** (tempo de CI) e **atenção** (cada comentário ou proposta que um humano precisa ler). Os dois primeiros são fáceis de estimar; o terceiro costuma ser o maior.

A tabela estima o custo em tokens de **uma revisão** de um PR típico e a conta mensal da BoxOffice (12 engenheiros, ~250 revisões por mês, contando as re-revisões após novos pushes) e de uma organização de 500 engenheiros (~20.000 revisões por mês). Premissas, todas ilustrativas: um prefixo estável de 8.000 tokens (instruções, convenções, ADRs), 6.000 tokens de diff e texto do PR, 1.500 tokens de saída (achados mais raciocínio). Os preços são os de tabela dos provedores por milhão de tokens quando esta página foi escrita — confira os preços atuais antes de usá-los.

```python exec="1"
# Token cost of one AI review and per month. Every number is an illustrative assumption.
MODELS = {                      # US$ per 1M tokens: input, output, cached read
    "Large model (Claude Opus 5.5)": (4.00, 20.00, 0.20),
    "Mid model (Claude Sonnet 5.5)": (2.00, 10.00, 0.20),
    "Small model (Claude Haiku 4.5)": (1.00, 5.00, 0.10),
    "Local model (Ollama on the runner)": (0.0, 0.0, 0.0),
}
PREFIX, DIFF, OUT = 8_000, 6_000, 1_500   # tokens per review
WRITE = 1.25                               # cache write premium
SMALL_TEAM, BIG_ORG = 250, 20_000          # reviews per month


def review_cost(p_in, p_out, p_read, hit):
    cached = PREFIX * hit
    written = PREFIX * (1 - hit)           # a miss writes the prefix to the cache
    return (cached * p_read + written * p_in * WRITE + DIFF * p_in + OUT * p_out) / 1e6


print("| Model | US$ / review (cold cache) | US$ / review (80 % prefix hits) "
      "| US$ / month, 12 engineers | US$ / month, 500 engineers |")
print("|---|---|---|---|---|")
for name, (p_in, p_out, p_read) in MODELS.items():
    cold = review_cost(p_in, p_out, p_read, 0.0)
    warm = review_cost(p_in, p_out, p_read, 0.8)
    print(f"| {name} | {cold:.4f} | {warm:.4f} | {warm * SMALL_TEAM:,.2f} | {warm * BIG_ORG:,.0f} |")
```

O que os números dizem:

- **Tokens são baratos em comparação com pessoas.** Mesmo com o maior modelo, uma revisão custa centavos; a organização de 500 engenheiros paga por mês aproximadamente o que custam alguns dias de trabalho de um engenheiro. A falha cara não é a conta, é o **ruído**: um revisor com 40% de precisão que posta quatro comentários em cada uma de ~5.000 revisões por semana produz cerca de 12.000 comentários inúteis por semana — a um minuto cada, 200 horas — cinco semanas inteiras de 40 horas de engenheiros gastas para lê-los.
- **Os tokens de saída são cerca de metade da conta** no modelo grande, embora sejam um décimo dos tokens: cada token de saída custa 5× um token de entrada. Pedir "sem elogios, sem repetir o código" também é uma otimização de custo.
- **Fazer cache do prefixo estável** ajuda mais à medida que o prefixo cresce (arquivos de convenções grandes, muitos ADRs) — mas só se o prefixo for idêntico byte a byte entre as execuções.
- **Modelos locais** eliminam a conta de tokens, mas não o custo: um runner de CPU gerando poucos tokens por segundo deixa o job com minutos de duração, e um recall menor significa defeitos não detectados. Compare-os em um golden set antes de escolher.
- **Minutos de runner**: um job de revisão de ~1,5 minuto em um runner Linux hospedado custa na ordem de um centavo de dólar aos preços típicos por minuto (confira com seu provedor de CI) — comparável aos tokens. Um agente que roda o build completo três vezes custa muito mais em minutos do que em tokens.

Agentes se comportam de outra forma: cada passo reenvia o contexto crescente, então o custo cresce aproximadamente de forma **quadrática** com o número de passos ([Sistemas de IA — os números](../ai-systems/index.md#numbers)). A página [Agentes no CI](agents-in-ci/index.md) faz essa conta para um agente de correção do build.

---

## O LLM gateway é infraestrutura compartilhada { #the-llm-gateway-is-shared-infrastructure }

Bots de CI são clientes do modelo assim como o assistente da BoxOffice. Na escala de uma organização, eles devem passar pelo mesmo [LLM gateway](../ai-systems/llm-gateway/index.md): um único lugar para chaves, **cotas e orçamentos por repositório**, roteamento de modelos ("modelo pequeno para notas de versão, modelo grande para revisão de segurança"), fallbacks quando um provedor cai e atribuição de custo por time. Sem ele, cada repositório guarda sua própria chave de API, e um loop descontrolado de agente em um repositório pode esgotar o rate limit da organização durante a abertura das vendas.

Experimente: abra o cenário abaixo com o perfil `spike` e imagine que o pico não são fãs, mas **uma atualização em massa de dependências** que dispara 300 revisões de PR e 300 agentes de correção ao mesmo tempo. O playground tem um só tipo de cliente, então mostra o que faz uma cota **compartilhada**: ao longo da execução cerca de 70% das perguntas falham, contra 37% na carga normal. Selecione o LLM Gateway e baixe a **Cota do provedor** de 10 para 5 chamadas/s: os erros passam de 90% — para todos. É por isso que o gateway precisa de uma cota **por cliente** (por repositório, por time) com prioridade para o tráfego interativo: os bots devem esperar, os fãs não. O playground não modela cotas por cliente; o seu botão **Modelo reserva** mostra a outra alavanca, capacidade comprada a um preço (os erros caem para cerca de 3%, o custo por mês dobra).

<div class="sdp" data-scenario="ai-assistant" data-mode="compact" data-profile="spike" data-height="520"></div>

[Abra o playground completo](../../../playground/index.md) para alterar os componentes você mesmo. O componente de gateway está descrito no [catálogo de componentes](../../reference/components/ai/index.md#llmgw).

!!! tip "Na entrevista"

    *"Como você adicionaria revisão de código por IA a um monorepo de 500 engenheiros?"* Uma resposta forte segue o framework de system design em vez de citar uma ferramenta:

    1. **Requisitos**: quais problemas (latência da revisão, classes de bugs que escapam, desvio da arquitetura)? Consultivo ou bloqueante? Quais linguagens e diretórios? Há dados que não podem sair da empresa?
    2. **Estimativas**: PRs por dia (~500 engenheiros × ~1 PR/dia ≈ 500, ×2 com re-revisões), tokens por revisão, custo por mês (centavos por revisão → no máximo alguns milhares de dólares por mês), orçamento de latência (comentários antes de o revisor humano chegar, < 5 min).
    3. **Projeto**: gatilho em eventos de PR com filtros de caminho e roteamento ciente do `CODEOWNERS`; contexto = diff + **convenções por diretório** + ADRs + responsáveis; achados estruturados; controle de ruído (limiares, deduplicação, só linhas alteradas, teto por PR); uma revisão por push; LLM gateway com cotas por time; fail open.
    4. **Implantação gradual**: modo sombra (achados registrados, não postados) em um golden set e em PRs reais → consultivo para times voluntários → medir a precisão por categoria → usar como gate só as categorias de alta precisão (por exemplo segredos, SQL injection, chamadas que cruzam fronteiras), como check obrigatório, nunca como aprovação.
    5. **Riscos**: prompt injection vinda do texto do PR, segredos em prompts, PRs de forks e `pull_request_target`, regressões do modelo — uma avaliação com golden set no CI a cada mudança de prompt ou de modelo, e dashboards de custo.

!!! success "Boas práticas"

    - **Escreva no repositório o contrato de toda etapa de IA** — gatilho, contexto, saída, ação, orçamento; uma etapa sem contrato não é ligada. No BoxOffice: todo workflow do [lab 13](../../hands-on/13/index.md) declara o seu gatilho, as suas `permissions:` e o seu `timeout-minutes`.
    - **Meça uma baseline antes de ligar uma etapa** — tempo até a primeira revisão, defeitos que escaparam e minutos de CI por pelo menos uma semana; sem isso, "ajuda" é opinião. No BoxOffice: [lab 13 — Meça](../../hands-on/13/measure/index.md).
    - **Escolha a direção à prova de falhas de cada etapa e teste-a** — desligue o modelo uma vez e confira que o pipeline ainda faz merge (consultiva) ou ainda bloqueia (portão). No BoxOffice: o `review.py` sai com 0 quando o modelo falha.
    - **Marque as mudanças escritas por IA** — um trailer no commit e um rótulo tornam a autoria por IA consultável meses depois. No BoxOffice: o agente de correção faz commit com `AI-assisted: ai-fix workflow (<model>)` e rotula o PR com `ai-generated`.
    - **Mande toda chamada de modelo do CI pelo gateway compartilhado, com cota por repositório** — uma atualização em massa não pode gastar a cota do assistente dos fãs (veja o Experimente acima).

!!! warning "Armadilhas comuns"

    - **Adicionar IA a um pipeline fraco**: sem CI rápido, bons testes e PRs pequenos, a IA amplifica a fraqueza (o alerta do DORA). Conserte os fundamentos primeiro.
    - **Medir adoção em vez de resultados**: "80% dos PRs tiveram revisão por IA" não diz nada; precisão, defeitos escapados e lead time dizem.
    - **Deixar o modelo decidir**: aprovações, merges, rollbacks e promoções pertencem a políticas e pessoas. O modelo propõe e explica.
    - **Ignorar o custo de atenção**: cada comentário de pouco valor ensina as pessoas a ignorar os de alto valor.
    - **Conceder permissões amplas "para funcionar"**: a permissão da ação é o pior caso de toda prompt injection.

---

## O mapa de conceitos da entrega assistida por IA { #concept-map }

Cada etapa de IA no pipeline é um pequeno sistema de IA: um orquestrador em volta de um modelo, ferramentas com permissões, uma camada de políticas e telemetria que diz se ela ajuda. O mapa liga os **componentes da paleta** (verde) que reaparecem aqui aos **conceitos** desta aula (azul):

``` diagram
flowchart LR
    ev["PR or pipeline event"] --> orch["orchestrator<br/>(reviewer, fix agent)"]:::comp
    orch --> llmgw["llmgw"]:::comp
    orch --> toolreg["toolreg<br/>tool allow-list"]:::comp
    orch --> safety["safety"]:::comp
    orch --> logs["logs<br/>audit trail"]:::comp
    obs["metrics · alerting"]:::comp
    orch -.- c1["autonomy levels,<br/>contract of an AI step"]:::tech
    llmgw -.- c2["per-repository quotas,<br/>routing, cost attribution"]:::tech
    toolreg -.- c3["least privilege, sandbox,<br/>draft PRs"]:::tech
    safety -.- c4["injection in PR text,<br/>slopsquatting, policy as code"]:::tech
    obs -.- c5["canary verdict by policy,<br/>AI explains"]:::tech
    obs -.- c6["DORA, reviewer precision,<br/>mutation score"]:::tech
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

| Componente da paleta | Pergunta que responde | Conceitos | Ensinado em | Cenários |
|---|---|---|---|---|
| [`orchestrator`](../../reference/components/ai/index.md#orchestrator) | Quem executa a etapa de IA, e *até onde ela pode ir*? | espectro de autonomia, o contrato em cinco partes, execuções headless, orçamentos, idempotência, verificação fora do agente | esta visão geral · [Agentes no CI](agents-in-ci/index.md) | — |
| [`llmgw`](../../reference/components/ai/index.md#llmgw) | *Qual modelo*, com qual cota, a que custo? | gateway compartilhado, cotas por repositório, roteamento por tarefa, fallbacks, cache de prefixo, atribuição de custo | esta visão geral · [Sistemas de IA — LLM Gateway](../ai-systems/llm-gateway/index.md) | `ai-assistant` (perfil spike) |
| [`toolreg`](../../reference/components/ai/index.md#toolreg) | Quais ferramentas e *permissões* a etapa recebe? | menor privilégio, sandbox, lista de ferramentas permitidas, escopos de token, etapa privilegiada que abre um PR em rascunho | [Agentes no CI](agents-in-ci/index.md) | — |
| [`safety`](../../reference/components/ai/index.md#safety) | Um *texto não confiável* pode conduzir a etapa? | prompt injection em PRs, a tríade letal, exfiltração, slopsquatting, política como código | [Segurança e governança](security-governance/index.md) | — |
| [`metrics`](../../reference/components/observability/index.md#metrics) · [`alerting`](../../reference/components/observability/index.md#alerting) | A mudança *melhorou as coisas*, e a versão está saudável? | métricas DORA, precisão do revisor, mutation score, análise de canário por política, resumos de incidente por IA | esta visão geral · [Liberação e operação](release-operate/index.md) | `observability-stack` |
| [`logs`](../../reference/components/observability/index.md#logs) | *Quem mudou o quê*, e por quê? | trilha de auditoria, proveniência (SLSA), SBOM, assinatura | [Agentes no CI](agents-in-ci/index.md) · [Segurança e governança](security-governance/index.md) | — |
| *(o próprio pipeline de CI)* | O código está *correto* e fiel à arquitetura? | revisão por IA, engenharia de contexto, controle de ruído, testes gerados julgados por testes de mutação, seleção de testes | [Revisão de código](code-review/index.md) · [Testes](testing/index.md) | — |

---

## Relacionados { #related }

- [Hands-on 13 — IA no CI/CD](../../hands-on/13/index.md): construa o revisor, o gerador de testes com PIT, o agente de correção, as notas de versão, o canary explicado, o hardening e a medição.
- [Hands-on 11 — Entrega](../../hands-on/11/index.md) e [Hands-on 12 — Assistente de IA](../../hands-on/12/index.md): o pipeline e o LLM gateway sobre os quais esta aula se apoia.
- [Projeto](../../exercises/project/index.md): o marco de K8s + CI/CD pode incluir uma etapa de IA, medida.
- [Preparação para entrevistas](../../support/interview/index.md): a pergunta acima é um enunciado comum de "projete uma ferramenta para desenvolvedores".

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - A IA cabe em todas as etapas da entrega, mas **o que ela pode fazer** depende do raio de impacto e da verificabilidade da sua saída: assistente → copiloto → revisor → agente supervisionado → agente autônomo.
    - Projete cada etapa de IA com o **contrato**: gatilho, contexto (confiável vs. não confiável), saída validada, ação com privilégio mínimo, orçamento e direção segura de falha.
    - A IA muda as entradas do **DORA** nas duas direções; a pesquisa até agora mostra que a produtividade percebida e a medida podem discordar — **meça** com baselines e métricas por etapa.
    - Tokens são baratos; **atenção** e **decisões erradas** são caras. Precisão vale mais que recall para tudo o que fala com humanos.
    - **A IA propõe; regras e humanos decidem.**

## O que quebra em seguida { #what-breaks-next }

Toda etapa de IA desta aula julga **uma mudança**: um diff, uma classe de teste, um build vermelho, um canary contra a sua baseline no tráfego de hoje. Nenhuma responde à pergunta que a próxima abertura de vendas faz ao sistema **inteiro**: com a borda, os caches, a sala de espera, os breakers, o Kubernetes e um assistente no lugar, a BoxOffice mantém o p99 abaixo de 300 ms quando 2 M de fãs chegam às 10:00, qual componente quebra primeiro, e quanto custa operá-la? Catorze capítulos acrescentaram caixas; nenhum provou que elas aguentam juntas. Provar isso com carga, perfis e um modelo de custo — e corrigir o que a prova encontrar — é a [aula 15 — Engenharia de Desempenho](../performance/index.md).

---

[^1]: DORA / Google Cloud. [Accelerate State of DevOps Report 2024](https://dora.dev/research/2024/dora-report/){target="_blank"}.
[^2]: DORA / Google Cloud. [State of AI-assisted Software Development 2025](https://dora.dev/research/2025/dora-report/){target="_blank"}.
[^3]: BECKER, J. et al. [Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/){target="_blank"}. METR, julho de 2025.
