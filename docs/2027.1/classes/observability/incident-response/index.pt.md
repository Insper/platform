
10h03, sábado. O celular do engenheiro de on-call vibra: `CheckoutErrorBudgetFastBurn`. Dois milhões de fãs estão na sala de espera, o provedor de pagamentos está respondendo em segundos e as redes sociais da empresa já estão pegando fogo. O que acontece nos próximos trinta minutos decide se isso vira uma manhã ruim ou uma notícia de jornal. Uma boa telemetria diz *o que* está errado; ela não decide *quem* faz *o quê*, *quem* fala com o mundo lá fora, nem *quando* parar de investigar e começar a mitigar. Isso é resposta a incidentes — uma prática emprestada de bombeiros e serviços de emergência, adaptada para software[^1].

---

## O que conta como incidente { #what-counts-as-an-incident }

Um **incidente** é um evento não planejado que degrada ou ameaça um serviço do qual os usuários dependem, e que precisa de uma resposta **coordenada**. Nem todo alerta é um incidente; um incidente é declarado quando a resposta precisa de mais de uma pessoa trabalhando do jeito normal. **Níveis de severidade** tornam essa decisão rápida e consistente — ninguém deveria discutir a definição às 3 da manhã.

| Severidade | Critérios (BoxOffice) | Exemplo | Resposta |
|---|---|---|---|
| **SEV1** | jornada principal fora do ar ou muito degradada para muitos usuários; perda de dados ou violação de segurança; qualquer abertura de vendas afetada | checkout falhando para 10% dos fãs durante uma abertura de vendas | page imediato, incident commander, página de status, atualizações a cada 15–30 min |
| **SEV2** | degradação significativa com contorno disponível, ou uma jornada não principal fora do ar | a busca devolve resultados desatualizados; e-mails atrasados em 1 h | page para o time dono, canal do incidente, atualizações internas |
| **SEV3** | impacto pequeno, poucos usuários, sem pressão de prazo | o mapa de assentos está lento para um local de evento | ticket, correção em horário comercial |
| **SEV4** | sem impacto no usuário ainda; um quase-incidente (*near miss*) | um certificado expirando em 7 dias | ticket |

!!! tip "Declare cedo, rebaixe à vontade"

    Declarar um incidente é barato; declará-lo tarde é caro. Um SEV1 que acaba sendo um SEV3 custa vinte minutos de algumas pessoas. Um SEV3 que na verdade era um SEV1 custa uma abertura de vendas. Faça de "declare e rebaixe depois" a norma, e nunca puna ninguém por declarar.

---

## On-call

**On-call** significa que uma pessoa nomeada é responsável, por um período, por responder aos pages de um conjunto de serviços. É um requisito de produção, não um ato heroico, e precisa ser sustentável.

- **Escalas** (*rotations*): um **primário** e um **secundário** (escalonamento se o primário não confirmar em poucos minutos), geralmente em turnos de uma semana com uma **passagem de turno** (*handoff*) escrita — problemas em aberto, deploys arriscados, silêncios em vigor.
- **Follow-the-sun**: times em fusos horários diferentes dividem o dia para que ninguém seja acionado de madrugada; exige pelo menos duas sedes.
- **Carga sustentável**: a prática de SRE do Google limita o trabalho de on-call para que os engenheiros passem a maior parte do tempo em engenharia, e mira em no máximo cerca de **dois incidentes por turno de 12 horas** — um incidente consome horas de acompanhamento, não só a resposta[^2]. Mais do que isso significa que o alerting ou o sistema precisa de trabalho, não de mais resistência.
- **You build it, you run it**: o time dono de um serviço carrega o pager dele. É o incentivo mais forte para construir software operável.
- **Preparação**: runbooks, acessos já concedidos (nunca "estou esperando acesso à produção"), dashboards nos favoritos e prática em **game days** ([Engenharia do caos](../../reliability/chaos/index.md)).

---

## O ciclo de vida do incidente { #the-incident-lifecycle }

``` diagram-sim
stateDiagram-v2
    [*] --> Detectado : alerta, relato de cliente ou um engenheiro percebe
    Detectado --> Triado : on-call confirma, avalia o impacto
    Triado --> Declarado : severidade definida, commander e canal atribuídos
    Triado --> Encerrado : alarme falso ou sem impacto (ajuste o alerta)
    Declarado --> Mitigando : estancar o sangramento
    Mitigando --> Monitorando : impacto acabou, SLIs se recuperando
    Monitorando --> Mitigando : o impacto volta
    Monitorando --> Resolvido : estável, correção definitiva agendada
    Resolvido --> Revisado : postmortem blameless, ações
    Revisado --> [*]
    Encerrado --> [*]
```

Cada transição tem um timestamp, e os intervalos entre elas são as métricas que importam:

| Métrica | De → até | Melhora com |
|---|---|---|
| **MTTD** — tempo médio para detectar | o impacto começa → alguém fica sabendo | alertas de burn rate do SLO, probes sintéticas |
| **MTTA** — tempo médio para confirmar | page → um humano assume | carga de pages razoável, políticas de escalonamento |
| **MTTM** — tempo médio para mitigar | o impacto começa → os usuários deixam de ser afetados | runbooks, rollbacks, feature flags, mitigações genéricas |
| **MTTR** — tempo médio para resolver / recuperar | o impacto começa → resolvido | tudo acima, mais diagnóstico rápido (traces) |

Os usuários só sentem o **impacto**: o tempo até a **mitigação** é o número que molda a disponibilidade (lembre de [Confiabilidade](../../reliability/index.md) que disponibilidade = MTTF / (MTTF + MTTR)). A causa raiz pode ser corrigida na segunda-feira.

---

## Papéis { #roles }

O jeito mais comum de um incidente dar errado não é a falta de uma ferramenta — são cinco engenheiros depurando a mesma coisa em paralelo, ninguém decidindo e ninguém contando aos clientes o que está acontecendo. O **Incident Command System** (ICS), criado para o combate a incêndios florestais nos anos 1970, resolveu isso com papéis explícitos; Google, PagerDuty e outros o adaptaram para software[^1][^3].

| Papel | Faz | **Não** faz |
|---|---|---|
| **Incident Commander (IC)** | é dono do incidente: define a severidade, atribui papéis, decide (rollback? failover?), mantém a linha do tempo andando, declara o fim | depurar — a atenção do IC está na resposta como um todo |
| **Líder de operações / técnico** | conduz a investigação e a mitigação; é o único que altera a produção (ou coordena quem altera) | falar com clientes |
| **Líder de comunicação** | atualizações internas numa cadência fixa, página de status, suporte e stakeholders de negócio | especular sobre causas em público |
| **Escriba** | registra a linha do tempo: o que foi visto, decidido, alterado — com timestamps | filtrar o que "pega mal" |
| **Especialistas** | entram quando chamados (pagamentos, banco de dados, rede) | iniciar mudanças paralelas e descoordenadas |

Num time pequeno, uma pessoa pode acumular vários papéis; o IC e o líder de operações ainda devem ser pessoas diferentes sempre que possível. Os papéis são passados **explicitamente** ("agora eu sou o IC") quando os turnos mudam ou o incidente escala.

Execute os primeiros quinze minutos do incidente da venda relâmpago:

``` diagram-sim
sequenceDiagram
    autonumber
    participant AM as Alertmanager
    participant OC as On-call (primário)
    participant IC as Incident commander
    participant OPS as Líder de ops (pagamentos)
    participant COM as Líder de comunicação
    participant ST as Página de status
    AM->>OC: page: CheckoutErrorBudgetFastBurn
    OC->>OC: confirma, abre o dashboard: 504s em /checkout, abertura em andamento
    OC->>IC: declara SEV1, abre o canal inc-onsale-0313
    IC->>OPS: você lidera a mitigação, o on-call de pagamentos entra
    IC->>COM: você cuida das atualizações, a cada 15 min
    COM->>ST: "Alguns fãs veem erros no checkout. Estamos trabalhando nisso."
    OPS->>OPS: trace de exemplar: 7,9 s em payment pool.acquire
    OPS->>IC: provedor lento, proposta: trocar para o provedor secundário
    IC->>OPS: aprovado, pode ir
    OPS->>OPS: flag payment.provider=secondary, sala de espera estrangulada
    OPS->>IC: razão de erros de volta abaixo de 0,5%, p99 1,4 s
    IC->>COM: mitigado, monitorando
    COM->>ST: "O checkout voltou a funcionar. Monitorando."
```

---

## Mitigar primeiro { #mitigate-first }

Durante um incidente, o objetivo é **parar o impacto**, não entendê-lo. O entendimento vem depois, com o postmortem — e é muito mais fácil quando a pressão passou. As melhores mitigações são **genéricas**: funcionam qualquer que seja a causa exata, e são ensaiadas com antecedência.

| Mitigação | Quando | Exemplo no BoxOffice | Pré-requisito |
|---|---|---|---|
| **Rollback** | uma mudança precedeu o impacto (o caso mais comum) | reverter `order` 1.4.2 → 1.4.1 | rollbacks rápidos e testados; anotações de deploy nos dashboards |
| **Desligar uma feature flag** | uma funcionalidade nova se comporta mal | desligar "sugestões de upgrade de assento" | funcionalidades atrás de flags |
| **Failover / drenar** | uma zona, região ou provedor está com problema | trocar para o provedor de pagamentos secundário; drenar `sa-east-1a` | um secundário testado e a troca documentada |
| **Descartar carga** (*shed load*) | a demanda excede a capacidade | estrangular a taxa de admissão da sala de espera | uma sala de espera / rate limiter instalados |
| **Escalar horizontalmente** | saturação, o código está bem | mais réplicas do `inventory`, pool de conexões maior *se* o banco aguentar | folga de capacidade, limites de autoscaling conhecidos |
| **Bloquear tráfego ruim** | bots abusivos ou um ataque | regra de WAF para o ASN dos cambistas | WAF e rate limits na borda |
| **Degradar graciosamente** | uma dependência não crítica falha | esconder recomendações, manter o checkout | fallbacks projetados desde o início |

!!! warning "Não depure em produção durante o incidente, a menos que isso mitigue"

    "Deixa eu adicionar uma linha de log e fazer redeploy para entender" transforma um incidente de 15 minutos num de 2 horas. Se houver uma mitigação disponível, aplique-a; se não houver, investigue com a telemetria que você já tem. Toda mudança durante um incidente passa pelo líder de operações e entra na linha do tempo.

### Comunicação { #communication }

Silêncio durante um incidente é lido como incompetência ou indiferença. As atualizações têm uma **cadência fixa** (para um SEV1, a cada 15–30 minutos), mesmo quando não há nada novo, e um formato fixo:

```text
[SEV1] Checkout errors during the 10:00 on-sale — update #3, 10:21
Impact:   since 10:02, ~12% of checkout attempts failed; fans in the waiting room were not affected.
Status:   MITIGATED at 10:14 — traffic moved to the secondary payment provider.
Next:     monitoring until 10:45; the primary provider is investigating on their side.
Next update: 10:45 or earlier if anything changes.
IC: @ana   Ops: @bruno   Comms: @carla
```

Para fora da empresa, a página de status informa **impacto e progresso**, nunca nomes internos, palpites ou culpados ("nosso provedor falhou").

---

## O incidente do BoxOffice, em números { #the-boxoffice-incident-by-the-numbers }

| Horário | Evento | Métrica |
|---|---|---|
| 10h00 | abrem as vendas | |
| 10h02 | o provedor de pagamentos fica lento; o pool de pagamentos satura; checkouts começam a falhar | o impacto começa |
| 10h03 | o page de queima rápida dispara | **MTTD ≈ 1 min** |
| 10h04 | o on-call confirma | **MTTA ≈ 1 min** |
| 10h06 | SEV1 declarado, IC e papéis atribuídos | |
| 10h11 | o trace de exemplar mostra o tempo dentro de `pool.acquire`; a troca é proposta | |
| 10h14 | provedor secundário ativo, sala de espera estrangulada; erros de volta ao normal | **MTTM ≈ 12 min** |
| 10h40 | estável, incidente resolvido | **MTTR ≈ 38 min** |

O page chegou um minuto depois do início do impacto só porque a abertura das vendas tem **seu próprio SLO**, com alertas em janelas de 5 minutos e de 1 minuto ([Alertas](../alerting/index.md)). Com 12% de falhas, a regra geral de 28 dias — 14,4× numa janela de 1 hora — levaria cerca de 60 min × 1,44% / 12% ≈ 7 minutos para disparar: mais da metade do tempo até a mitigação, perdido antes de alguém olhar.

Quanto isso custou em termos de SLO? Com números ilustrativos — 200 tentativas de checkout por segundo durante a abertura e uma média de 12% de falhas nos 12 minutos de impacto:

$$
200 \times 720\ \text{s} \times 0{,}12 \approx 17\,300 \text{ checkouts com falha}
$$

Se o BoxOffice processa cerca de 2 milhões de checkouts numa janela normal de 28 dias (a janela de SLO usada em [Confiabilidade](../slo/index.md)), um SLO de 99,9% permite **2.000** falhas. Este único incidente gastou mais de oito budgets de 28 dias — mais de sete meses — em doze minutos. A [política de error budget](../slo/index.md) agora se aplica: o trabalho em funcionalidades do checkout pausa até que as ações de confiabilidade sejam feitas. Esse é o error budget cumprindo seu papel — transformar uma manhã ruim numa prioridade de engenharia com recursos garantidos.

---

## Postmortems

Um **postmortem** (também chamado de *incident review* ou retrospectiva) é uma análise escrita de um incidente, feita depois que ele foi resolvido, com um único objetivo: **reduzir a chance e o impacto do próximo**. Escreva um para todo SEV1/SEV2, toda perda de dados, todo gasto significativo de budget — e para quase-incidentes interessantes.

### Blameless

Um postmortem é **blameless** (sem culpados)[^4]: ele assume que todos agiram de forma razoável com o que sabiam no momento, e pergunta *como o sistema tornou o erro fácil*, não *quem errou*. Não se trata de ser gentil. Se as pessoas são punidas por relatos honestos, elas param de fazê-los, e a organização perde a única fonte precisa de informação sobre como seus sistemas realmente falham. "O engenheiro rodou o comando errado" vira "a ferramenta permitiu um comando destrutivo contra a produção sem confirmação, e o runbook o mostrava ao lado de um comando inofensivo".

### Causa raiz — ou fatores contribuintes? { #root-cause-or-contributing-factors }

Sistemas complexos raramente falham por **um** motivo; incidentes precisam que vários fatores se alinhem[^5]. No incidente do BoxOffice:

- o provedor ficou lento (gatilho externo, fora do controle do BoxOffice);
- o adaptador de pagamentos **não tinha timeout** menor que o do próprio provedor, e um pool de 20 conexões compartilhado por todas as chamadas;
- o provedor secundário existia, mas a troca era um passo manual e não documentado;
- os alertas gerais de SLO de 28 dias não foram projetados para uma abertura de vendas de 30 minutos;
- o teste de carga antes da abertura usou um mock do provedor que sempre respondia em 100 ms.

Perguntar "cinco porquês" ao longo de uma única cadeia teria parado em "o provedor estava lento" — o único fator que o BoxOffice não consegue corrigir. Procurar **todos** os fatores contribuintes encontra quatro que ele consegue.

### Modelo { #template }

```markdown
# Postmortem: checkout errors during the 13 March on-sale (SEV1)

**Status**: final · **Authors**: … · **Reviewed**: …

## Summary
Two to four sentences: what happened, impact, how it was mitigated.

## Impact
Users affected, duration, failed checkouts, revenue and SLO budget consumed, support tickets.

## Timeline (UTC-3)
10:02 provider latency rises … 10:03 page … 10:14 mitigated … 10:40 resolved.

## Contributing factors
Technical, process and organisational factors — no names, no blame.

## What went well / what went poorly / where we got lucky

## Action items
| Action | Type (prevent / detect / mitigate) | Owner | Due | Ticket |
|---|---|---|---|---|
| Timeout 800 ms + bulkhead on the provider client | prevent | payments | 27/03 | PAY-312 |
| Automatic failover to the secondary provider | mitigate | payments | 10/04 | PAY-313 |
| On-sale SLO with 1 min / 5 min burn-rate alerts | detect | SRE | 20/03 | OBS-88 |
| Provider latency injected in the pre-sale load test | prevent | performance | 27/03 | PERF-41 |
```

As ações são a única parte de um postmortem que muda alguma coisa. Cada uma é **específica**, tem **um dono** e uma **data**, e é acompanhada como qualquer outro trabalho. Um postmortem cujas ações nunca são feitas é uma história, não uma correção.

### Fechando o ciclo { #closing-the-loop }

- **Reunião de revisão**: os autores apresentam o documento ao time; as perguntas são sobre o sistema, não sobre as pessoas.
- **Compartilhe amplamente**: outros times têm o mesmo pool, o mesmo timeout faltando.
- **Procure tendências**: muitos incidentes vindos de deploys → invista em canaries e rollbacks ([Entrega](../../cloud-native/delivery/index.md)); muitos vindos de uma dependência → bulkheads e fallbacks.
- **Pratique**: transforme o incidente num cenário de **game day** — injete latência no provedor com o Toxiproxy e verifique se o novo timeout, o breaker e o alerta se comportam ([Hands-on 9](../../../hands-on/9/index.md)).
- **Meça a saúde da entrega**: as métricas DORA *change failure rate* e *failed deployment recovery time*[^6] mostram se os incidentes causados por mudanças estão ficando mais raros e mais curtos.

!!! example "No código do BoxOffice: um incidente ensaiado (lab 9)"

    O [Hands-on 9 — game day](../../../hands-on/9/game-day/index.md) roda esta página em miniatura. Um mestre do jogo injeta uma de seis falhas sem contar a ninguém qual; os operadores a detectam com o dashboard do lab 8 e os alertas de burn rate (copiados para o `order` em `slo-order.yaml`); um escriba mantém a linha do tempo; e cada rodada termina com uma revisão sem culpados em `results/lab9-gameday.md` — tempo para detectar, tempo para mitigar, itens de ação com um dono. O script abaixo é toda a caixa de ferramentas do mestre do jogo, e o seu `reset` é o botão de abortar, testado antes da primeira injeção.

    ``` { .sh title="scripts/game-day.sh (the hidden failures)" }
    --8<-- "docs/2027.1/hands-on/9/code/scripts/game-day.sh:7:16"
    ```

!!! note "Assistentes de IA na resposta a incidentes"

    Em 2026, muitos times usam assistentes baseados em LLM para resumir o canal do incidente num rascunho de linha do tempo, sugerir consultas ou buscar em postmortems passados incidentes parecidos. São bons escribas e boas ferramentas de busca. Não são incident commanders: um assistente pode produzir uma causa raiz convincente porém errada, então toda afirmação precisa ser conferida com a telemetria, e as decisões ficam com os humanos nos papéis acima.

---

## Trade-offs

| Decisão | Opção A | Opção B | Orientação |
|---|---|---|---|
| Quem carrega o pager | um time central de operações | o time que constrói o serviço | "you build it, you run it", com um time central de SRE para plataformas e mentoria |
| Quando declarar | só quando houver certeza | cedo, rebaixar depois | cedo — declarar é barato |
| Durante o incidente | achar a causa raiz | mitigar primeiro | mitigar primeiro; entender depois |
| Tom do postmortem | achar quem errou | blameless, focado no sistema | blameless — é o único jeito de obter relatos precisos |
| Análise | causa raiz única (5 porquês) | fatores contribuintes | fatores contribuintes; falhas complexas têm vários |

!!! tip "Na entrevista"

    Entrevistas raramente perguntam diretamente "como você conduz um incidente?", mas frequentemente perguntam "**o que acontece quando X falha?**". Uma resposta forte cobre três camadas: *como o sistema se degrada* (timeouts, fallbacks, sala de espera), *como você fica sabendo* (alerta de burn rate do SLO, antes de os clientes avisarem) e *como você se recupera* (uma mitigação genérica — failover, rollback, flag — documentada e testada). Em entrevistas comportamentais, uma história de incidente bem contada — seu papel, como você mitigou, o que o postmortem mudou — é um dos sinais mais fortes de experiência real (veja [Preparação para entrevistas](../../../support/interview/index.md)).

!!! success "Boas práticas"

    - **Publique a tabela de severidades e a escala de IC antes da abertura das vendas** — ninguém deveria debater o que é um SEV1, ou quem comanda, às 10h03.
    - **Registre com horário toda observação, decisão e mudança num único canal** — MTTD, MTTA e MTTM saem desses horários, e o postmortem é escrito a partir deles. No BoxOffice: a linha do tempo do escriba no [Hands-on 9 — game day](../../../hands-on/9/game-day/index.md).
    - **Mantenha cada mitigação genérica como um comando documentado, ensaiado antes de ser necessário** — rollback, desligar uma flag, trocar de provedor, frear a sala de espera; uma mitigação testada pela primeira vez durante o incidente costuma falhar. No BoxOffice: `scripts/game-day.sh reset`, o botão de abortar testado antes da primeira injeção.
    - **Expresse o impacto como error budget gasto** — "17.300 checkouts com falha, oito orçamentos de 28 dias" transforma uma manhã ruim numa prioridade financiada pela política de error budget. No BoxOffice: a linha *SLO budget spent* do modelo de revisão do lab 9.
    - **Publique o postmortem em até uma semana, com a memória fresca** — os relatos se apagam e os logs expiram; uma revisão escrita um mês depois é reconstruída, não lembrada.

!!! warning "Armadilhas comuns"

    - **Sem incident commander**: todo mundo depura, ninguém decide, ninguém comunica.
    - **Investigar antes de mitigar**: os usuários continuam sofrendo enquanto o time entende um problema que um rollback teria parado.
    - **Incidentes silenciosos**: nenhuma atualização por uma hora; suporte e negócio inventam a própria versão.
    - **Postmortems que buscam culpados**: as pessoas escondem o que fizeram, e os verdadeiros fatores contribuintes continuam escondidos.
    - **Ações sem dono ou sem data**: o mesmo incidente acontece de novo na próxima abertura de vendas.
    - **On-call insustentável**: pages demais esgotam as pessoas, e pessoas cansadas pioram o próximo incidente.

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    AL["burn-rate page<br/>→ Alerting"] --> TRI["triage: severity<br/>SEV1 to SEV4"]
    TRI --> ROLES["IC, ops lead,<br/>comms lead, scribe"]
    ROLES --> MIT["mitigate first"]
    MIT --> RB["rollback, flag off<br/>→ Cloud-native delivery"]
    MIT --> FO["failover, shed load,<br/>degrade → Reliability"]
    MIT --> BLK["block bad traffic<br/>→ Edge (WAF)"]
    MIT -->|"timestamps"| MTT["MTTD, MTTM, MTTR<br/>→ availability"]
    MTT --> BUD["error budget spent<br/>→ SLO policy"]
    MIT --> PM["blameless postmortem,<br/>action items"]
    PM --> GD["game day<br/>→ Chaos engineering"]
```

**Componentes da paleta:** [`alerting`](../../../reference/components/observability/index.md#alerting) (o page que o inicia) · [`tracing`](../../../reference/components/observability/index.md#tracing) (o trace do exemplar que achou o `pool.acquire`) · [`payment`](../../../reference/components/external/index.md#payment) (failover para o provedor secundário) · [`queue`](../../../reference/components/messaging/index.md#queue) (a sala de espera, estrangulada para descartar carga) · [`waf`](../../../reference/components/edge/index.md#waf) (bloqueio de tráfego abusivo) · [`app`](../../../reference/components/compute/index.md#app) (rollback ou scale-out de um serviço). **Cenários:** `flash-sale` (o incidente da abertura de vendas), `cascading-failure` (um provedor lento sem timeouts). **Continua em:** [Confiabilidade](../../reliability/index.md) (disponibilidade = MTTF / (MTTF + MTTR)), [SLIs, SLOs e error budgets](../slo/index.md), [Confiabilidade — engenharia do caos](../../reliability/chaos/index.md), [Cloud-native — entrega](../../cloud-native/delivery/index.md) (rollbacks, canaries, DORA), [Projeto — game day](../../../exercises/project/game-day/index.md), [Preparação para entrevistas](../../../support/interview/index.md).

---

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - Um **incidente** exige coordenação; **níveis de severidade** com critérios claros tornam a declaração rápida — declare cedo, rebaixe à vontade.
    - O on-call precisa ser **sustentável**: primário/secundário, passagens de turno, runbooks e uma carga de pages que deixe tempo para engenharia.
    - Meça **MTTD, MTTA, MTTM, MTTR**; os usuários sentem o tempo até a **mitigação**.
    - Papéis — **incident commander**, líder de operações, líder de comunicação, escriba — evitam o caos; o IC coordena e não depura.
    - **Mitigue primeiro** com mitigações genéricas e ensaiadas (rollback, flag, failover, descarte de carga); comunique numa cadência fixa.
    - **Postmortems blameless** buscam todos os **fatores contribuintes** e produzem **ações** com dono e data; o ciclo se fecha com game days.

---

[^1]: BEYER, B. et al. [Site Reliability Engineering — Managing Incidents](https://sre.google/sre-book/managing-incidents/){target="_blank"}. O'Reilly, 2016. Capítulo 14.
[^2]: BEYER, B. et al. [Site Reliability Engineering — Being On-Call](https://sre.google/sre-book/being-on-call/){target="_blank"}. O'Reilly, 2016. Capítulo 11.
[^3]: PAGERDUTY. [Incident Response Documentation](https://response.pagerduty.com/){target="_blank"}.
[^4]: ALLSPAW, J. [Blameless PostMortems and a Just Culture](https://www.etsy.com/codeascraft/blameless-postmortems){target="_blank"}. Etsy Code as Craft, 2012. Veja também *Site Reliability Engineering*, capítulo 15 — Postmortem Culture.
[^5]: COOK, R. I. [How Complex Systems Fail](https://how.complexsystems.fail/){target="_blank"}. Cognitive Technologies Laboratory, University of Chicago, 1998.
[^6]: DORA. [DORA's software delivery metrics](https://dora.dev/guides/dora-metrics-four-keys/){target="_blank"}. Google Cloud.
