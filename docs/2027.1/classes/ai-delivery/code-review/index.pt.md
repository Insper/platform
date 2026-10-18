Um pull request no `order` muda o checkout para que ele confirme a reserva do assento com um único comando SQL, em vez de uma chamada HTTP ao `inventory` — "é mais rápido". O código compila, os testes passam e o revisor, às 18h40 de uma sexta-feira, aprova. Três semanas depois, durante uma abertura de vendas, o `inventory` muda sua tabela de reservas e o checkout quebra. A regra violada — *um schema por serviço* — estava escrita numa página da wiki que ninguém abria. Um revisor que tivesse lido essa página, toda vez, em todo PR, teria pegado o problema.

Essa é a promessa da **revisão de código por IA**: um revisor que lê cada diff em minutos, nunca se cansa e pode ser informado das regras do time. Esta página trata de transformar essa promessa em uma ferramenta em que as pessoas realmente confiem.

---

## Por que revisão de código, e para que ela serve

A revisão de código moderna — uma revisão leve, apoiada em ferramentas, de cada mudança antes do merge — é praticamente universal na indústria. Estudos na Microsoft e no Google concluíram que seus principais resultados não são apenas encontrar defeitos, mas **transferência de conhecimento, propriedade coletiva do código e consistência**; no Google, a latência mediana da revisão era menor que um dia, e a maioria das mudanças era pequena[^1][^2]. Duas consequências para a revisão por IA:

- Um revisor de IA pode assumir parte do trabalho de **encontrar defeitos** e de **consistência**, mas não a transferência de conhecimento: um humano ainda precisa ler o código para aprendê-lo.
- A latência da revisão importa. O primeiro olhar humano costuma esperar horas; uma revisão por IA em dois minutos dá ao autor algo para corrigir *antes* de o humano chegar, e a revisão humana fica mais curta.

---

## Em que a revisão por IA é boa e em que é ruim

| Boa em (alta precisão quando recebe contexto) | Ruim em (baixa precisão ou cega) |
|---|---|
| Bugs locais visíveis no diff: tratamento de null, off-by-one, comparação errada, vazamento de recursos | Bugs que exigem conhecimento de execução: desempenho sob carga, condições de corrida entre serviços |
| Padrões de segurança: SQL por concatenação, segredos no código, verificação de autorização ausente, desserialização insegura | Se a funcionalidade é a funcionalidade **certa**: a intenção de produto não está no diff |
| Violações de convenções e ADRs **escritos** | Convenções que ninguém escreveu |
| Testes ausentes para lógica arriscada; testes que não verificam nada | Julgar se um teste verifica o valor esperado **correto** (o problema do oráculo) |
| Explicar código desconhecido ao revisor humano | Grandes refatorações que abrangem centenas de arquivos (limites de contexto, diluição da atenção) |
| Consistência: formatos de erro, códigos de status, logging, nomes | Trade-offs de arquitetura que exigem pesar o contexto de negócio |

Duas fraquezas sistemáticas merecem nome. **Credulidade**: o modelo lê texto escrito pelo autor — descrição do PR, comentários no código — e pode ser conduzido por ele ("isto foi aprovado pela segurança"); veja [prompt injection](../security-governance/index.md). **Ruído plausível**: um modelo que recebe o pedido de revisar vai encontrar *alguma coisa*; sem permissão explícita para não retornar nada, ele enche a revisão com observações de estilo e repetições do código.

---

## Anatomia de um revisor de IA

``` mermaid-sim
sequenceDiagram
    autonumber
    participant GH as Host Git
    participant R as Job do revisor
    participant Ctx as Montador de contexto
    participant GW as LLM gateway
    participant Post as Publicador
    GH->>R: PR aberto / novo push
    R->>Ctx: diff + metadados do PR
    Ctx->>Ctx: numera linhas, filtra arquivos, orça tokens
    Ctx->>Ctx: adiciona convenções, ADRs, responsáveis, código relacionado
    Ctx->>GW: system (estável, em cache) + user (dados não confiáveis)
    GW-->>R: achados em JSON (validados pelo schema)
    R->>R: filtro: linhas alteradas, severidade, confiança, dedup, teto
    R->>Post: achados a publicar
    Post->>GH: uma revisão com comentários inline
    Post->>GH: métricas: tokens, US$, mantidos vs. descartados
```

O modelo é uma caixa entre oito. A maior parte da engenharia — e a maior parte da qualidade — está no **montador de contexto** e no **filtro**.

---

## Engenharia de contexto

Um modelo só consegue revisar contra aquilo que recebe. **Engenharia de contexto** é decidir o que entra na janela de contexto, limitada e paga, e em que ordem.

| Contexto | Por quê | Custo / risco | BoxOffice |
|---|---|---|---|
| **O diff, com números de linha** | O objeto da revisão; linhas numeradas permitem que o modelo cite linhas exatas | Cresce com o tamanho do PR; não confiável | `git diff base...head`, cada linha nova como `L21 + …` |
| **Convenções do repositório** | Transforma conselhos genéricos nas *suas* regras | Precisam ser curtas e atuais; lidas em toda execução | `CONVENTIONS.md`: schema por serviço, timeouts, dinheiro em centavos |
| **Decisões de arquitetura (ADRs)** | O *porquê* das regras; permite que o modelo aponte decisões sendo revertidas | Longos; resuma ou recupere os relevantes | `0001-schema-per-service.md`, `0004-outbox-for-events.md` |
| **Código ao redor** | A função ou classe inteira em torno de um trecho; quem chama um método alterado | Caro em tokens; exige recuperação em repositórios grandes | O `HoldService.java` inteiro quando um trecho altera `expire()` |
| **Responsáveis e mapa de serviços** | Qual serviço é dono de quais dados e APIs | Pequeno, de alto valor | "`inventory` é dono de `inventory.*`; `order` é dono de `orders.*`" |
| **Histórico** | Comentários de revisões anteriores, incidentes relacionados | Pode enviesar para problemas antigos | "Incidente 2026-08: expiração da reserva com 2 min de diferença" |
| **Título e descrição do PR** | A intenção da mudança | **Não confiável** — canal de injeção | Envolvido em `<untrusted_pr_description>` |

Três regras práticas:

1. **Ordene pensando no cache.** Coloque o conteúdo estável primeiro (instruções, convenções, ADRs) e o conteúdo de cada execução por último (diff). O prompt caching é uma correspondência de prefixo: se a parte estável for idêntica byte a byte, as revisões repetidas a leem por uma fração do preço ([LLM gateway](../../ai-systems/llm-gateway/index.md)).
2. **Orce, não trunque.** Um PR de 5.000 linhas não cabe — e não deveria ser revisado como um único bloco. Mantenha arquivos inteiros por prioridade (código de produção antes de testes, antes de configuração), liste na revisão os arquivos pulados, ou divida: uma chamada por arquivo ou por serviço (*map*) e depois uma chamada para juntar e deduplicar (*reduce*). Cortar um diff no meio produz absurdos confiantes sobre código que o modelo nunca viu.
3. **Escreva as convenções primeiro para humanos.** Se uma regra não é clara para um engenheiro novo, não é clara para o modelo. Uma regra que precisa de um parágrafo de nuances costuma funcionar melhor como verificação determinística (abaixo).

??? question "Pense primeiro: recuperação em um monorepo"

    A BoxOffice vira um monorepo de 40 serviços e 2 milhões de linhas. Um PR muda a assinatura de `InventoryClient.confirmHold`. Que contexto extra mais melhoraria a revisão, e como encontrá-lo sem enviar o repositório inteiro?

    Os **pontos de chamada** do método alterado e o **contrato** da API que ele encapsula. Encontre-os de forma determinística — um índice de código (language server, `ctags`, um serviço de busca de código) ou um simples `git grep confirmHold` — e adicione os 5–10 trechos mais relevantes. A recuperação baseada em embeddings sobre o repositório ([RAG](../../ai-systems/rag-memory/index.md)) ajuda em perguntas vagas ("onde mais calculamos preços de assentos?"), mas, para "quem chama este método", um índice de símbolos é exato e mais barato.

---

## Saída estruturada, publicada como comentários de revisão

Texto livre é para humanos; o pipeline precisa de **dados**. Peça um JSON que seja validado contra um schema — no Claude, as structured outputs restringem a resposta ao schema; em outros provedores, modo JSON mais validação e uma tentativa de reparo:

```json
{
  "summary": "Adds direct SQL access from order to the inventory schema.",
  "findings": [
    {
      "file": "services/order/src/main/java/boxoffice/order/OrderService.java",
      "line": 21,
      "severity": "blocker",
      "category": "architecture",
      "confidence": "high",
      "title": "order writes to the inventory schema",
      "explanation": "CONVENTIONS.md: a service reads and writes only its own schema. This UPDATE couples order to inventory's table layout and bypasses inventory's locking, so a hold can be confirmed after it expired.",
      "suggestion": "Call InventoryClient.confirmHold(holdId) and handle 409 Conflict."
    }
  ]
}
```

| Campo | Usado para |
|---|---|
| `file`, `line` | Posicionamento inline; validado contra o diff (comentários em linhas fora do diff são rejeitados pelo host Git) |
| `severity` (`nit` … `blocker`) | Limiares e ordenação; decisões de gate |
| `category` | Precisão por categoria; roteamento (achados de segurança para o security champion) |
| `confidence` | Controle de ruído; calibração ao longo do tempo |
| `title` | Impressão digital para deduplicação; a linha que as pessoas leem de relance |
| `explanation`, `suggestion` | O corpo do comentário; uma correção concreta torna o comentário acionável |

No GitHub, todos os achados de uma execução vão para **uma revisão** (`POST /repos/{owner}/{repo}/pulls/{number}/reviews` com um array `comments` de `path`, `line`, `side`), de modo que o autor recebe uma notificação, e não doze[^3]. Um **evento** de revisão `COMMENT` mantém o bot consultivo; é o código — não o modelo — que escolhe esse evento.

---

## Controle de ruído

Cada comentário gasta a atenção de um desenvolvedor. Um revisor é julgado pelos seus **piores** comentários: depois de alguns inúteis, as pessoas param de ler — inclusive os úteis. Os controles, na ordem em que atuam:

| Controle | O que ele remove |
|---|---|
| Gatilhos e filtros de caminho | Rascunhos, PRs só de documentação, arquivos gerados, lockfiles, código vendorizado |
| Prompt: "uma lista vazia é uma boa revisão; sem elogios; sem repetir o código" | Enchimento |
| Só **linhas alteradas** | Comentários em código que o autor não tocou |
| **Severidade** mínima | Detalhes de estilo que um formatador deveria resolver |
| **Confiança** mínima | Especulação |
| **Deduplicação** por impressão digital entre pushes | O mesmo comentário republicado a cada push |
| **Teto** por PR | Enxurradas em PRs grandes — mantenha os mais graves |
| Uma revisão por push + um resumo fixo | Tempestades de notificações |

Os limiares trocam **precisão** (a fração dos comentários publicados que são úteis) por **recall** (a fração dos problemas reais encontrados). A tabela usa uma amostra rotulada ilustrativa de 100 PRs — o modelo emitiu 60 achados de confiança alta, 90 de média e 150 de baixa, dos quais 48, 45 e 30 eram problemas reais, de um total de 150 problemas reais:

```python exec="1"
# Illustrative labelled sample: findings per confidence bucket and how many were real.
buckets = [("high", 60, 48), ("medium", 90, 45), ("low", 150, 30)]
REAL_PROBLEMS, PRS = 150, 100

print("| Post findings with confidence ≥ | Comments per PR | Precision | Recall |")
print("|---|---|---|---|")
posted = useful = 0
for name, emitted, real in buckets:
    posted += emitted
    useful += real
    print(f"| {name} | {posted / PRS:.1f} | {useful / posted:.0%} | {useful / REAL_PROBLEMS:.0%} |")
```

Publicar tudo encontra a maior parte dos problemas e é ignorado por todo mundo (3 comentários por PR, 4 em cada 10 úteis). Publicar só os de confiança alta gera confiança e deixa passar dois terços dos problemas. A maioria dos times começa com **alta + média para severidades ≥ minor**, mede e ajusta por categoria: segredos e SQL injection podem ficar em média; estilo nunca é publicado.

---

## Consultivo ou gate?

| | Consultivo | Gate (check obrigatório) |
|---|---|---|
| Efeito | Comentários; humanos decidem | Merge bloqueado até o achado ser corrigido ou ignorado com justificativa |
| Custo de um falso positivo | Um minuto de leitura | Um PR bloqueado, uma liberação manual, frustração — e pressão para desligar o bot |
| Custo de um falso negativo | O mesmo de hoje | Falsa sensação de segurança se os humanos relaxarem |
| Requisitos | Nada de especial | **Alta precisão medida** naquela categoria; um caminho para liberação manual; confiabilidade com fail closed |
| Bom para | Tudo, no começo | Categorias estreitas e de alta precisão: segredos no código, SQL por concatenação, acesso proibido entre schemas |

Uma implantação segura: **sombra** (achados registrados, não publicados; compare com o que os humanos encontraram) → **consultivo** para times voluntários → **gate por categoria** quando a precisão estiver comprovada. Mesmo como gate, uma verificação de IA é um *status check obrigatório* — nunca uma aprovação. A aprovação continua humana, imposta pela proteção de branch.

---

## Medindo o revisor

Não dá para ajustar o que não se mede, e "o time gosta" não é uma medida.

| Métrica | Como | Observações |
|---|---|---|
| **Precisão** | Comentários aceitos ÷ (aceitos + descartados); reações ou um botão de resolver com motivo | Exige que as pessoas avaliem; use amostragem se necessário |
| **Recall** | Encontrados ÷ plantados, em um **golden set** de PRs com problemas conhecidos | Rode a cada mudança de prompt ou de modelo, no CI |
| **Defeitos escapados** | Bugs encontrados depois em código que o bot revisou | Lenta, mas é a métrica que interessa ao negócio |
| **Ruído** | Comentários por PR; % de PRs sem nenhum comentário | Zero muitas vezes é a resposta certa |
| **Custo e latência** | US$ e minutos por revisão | A partir do uso de tokens do job |
| **Comportamentais** | Tempo até a primeira revisão, rodadas de revisão, tempo até o merge | Exigem um período de referência |

Um LLM também pode *julgar* comentários ("este comentário estava correto?"), o que é mais barato que rótulos humanos — mas o [LLM como juiz](../../ai-systems/safety-evals/index.md) tem vieses (tende a concordar com textos confiantes, e consigo mesmo). Use-o para triagem e calibre-o contra uma amostra rotulada por humanos.

---

## Conformidade com a arquitetura

A história do início — o `order` escrevendo no schema de `inventory` — é uma **regra de arquitetura**. Essas regras são o que de mais valioso um revisor automatizado pode verificar, porque humanos as esquecem e as violações custam caro depois. Mas muitas delas não precisam de modelo algum.

| Regra | Verificação determinística (preferida) | Onde a IA agrega valor |
|---|---|---|
| "O `order` não deve acessar o schema de `inventory`" | Lint de SQL: grep por `inventory.` em `services/order/**`; usuários de banco separados por serviço, com grants (o banco recusa) | Explicar o *porquê*, sugerir a chamada de API no lugar |
| "Controllers não devem chamar repositories diretamente" | Teste com [ArchUnit](https://www.archunit.org){target="_blank"} no build | — |
| "Todo cliente HTTP de saída tem timeouts" | Lint customizado, ou uma biblioteca de cliente compartilhada que os exige | Identificar um novo cliente feito à mão que contorna a biblioteca |
| "Eventos passam pelo outbox" | ArchUnit: nenhum uso de `KafkaTemplate` fora do relay do outbox | Reconhecer uma publicação direta disfarçada |
| "Prefira operações idempotentes para pagamento" | Difícil de expressar estaticamente | Bom encaixe: vago, semântico, dependente de contexto |

```java title="services/order/src/test/java/boxoffice/order/ArchitectureTest.java"
@AnalyzeClasses(packages = "boxoffice.order")
class ArchitectureTest {

    @ArchTest
    static final ArchRule no_direct_kafka_outside_outbox =
        noClasses().that().resideOutsideOfPackage("..outbox..")
            .should().dependOnClassesThat().haveSimpleName("KafkaTemplate")
            .because("ADR-0004: events are published through the transactional outbox");
}
```

O melhor projeto combina os dois: regras determinísticas **bloqueiam**, porque são exatas; o revisor de IA **explica** e pega o que as regras não conseguem expressar, e seus achados recorrentes viram candidatos a novas regras determinísticas. De novo, defesa em profundidade — e o usuário de banco do `order` sem grants em `inventory.*` é a última camada, que não depende de revisor nenhum.

!!! example "BoxOffice: o revisor pega o atalho"

    Com o `CONVENTIONS.md` no contexto, o revisor do [hands-on 13](../../../hands-on/13/review/index.md) aponta o `UPDATE inventory.hold` no `OrderService` como um bloqueador de arquitetura de alta confiança, citando a regra e explicando a consequência (uma reserva confirmada depois de expirada, acoplamento à tabela de outro serviço). O time então adiciona a verificação determinística: um papel (role) do PostgreSQL separado por serviço, para que o mesmo erro falhe nos testes de integração mesmo que todos os revisores deixem passar.

---

!!! tip "Na entrevista"

    Quando pedirem para você projetar um revisor de código com IA, diga cedo que **precisão vale mais que recall** para tudo o que fala com humanos, e mostre como você vai *medi-la* (golden set para o recall, aceitos/avaliados para a precisão). Descreva o contexto (diff + convenções + ADRs + código relacionado por busca de símbolos), os achados estruturados, o filtro (linhas alteradas, severidade, confiança, dedup, teto) e a implantação (sombra → consultivo → gate por categoria). Mencione que regras de arquitetura devem ser **verificações determinísticas primeiro**, com a IA como quem explica.

!!! warning "Armadilhas comuns"

    - **Sem permissão para ficar em silêncio**: o modelo inventa trabalho. Diga explicitamente que uma revisão vazia é boa.
    - **Revisar o repositório inteiro em vez da mudança**: caro e fora do assunto.
    - **Tratar o silêncio do bot como aprovação**: os humanos relaxam, os defeitos escapados aumentam.
    - **Usar como gate antes de medir**: uma semana de bloqueios falsos e o time desliga o bot.
    - **Regras só no prompt**: uma regra que importa também deve existir como teste, lint ou grant no banco.

---

## Como se conecta { #how-it-connects }

``` mermaid
flowchart LR
    PR["pull request event"] --> CTX["context: diff, conventions,<br/>ADRs, symbol search"]
    CTX --> RET["retrieval<br/>→ AI systems RAG & Memory"]
    CTX --> LLM["model call<br/>→ LLM gateway, prefix cache"]
    LLM --> OUT["structured findings<br/>(JSON schema)"]
    OUT --> NOISE["noise control: changed lines,<br/>confidence, dedup, cap"]
    NOISE --> GATE{"advisory<br/>or gate?"}
    GATE --> PREC["precision + golden set<br/>→ AI systems safety & evals"]
    ARCH["architecture rules:<br/>deterministic checks first"] --> OUT
    PR --> INJ["PR text is untrusted<br/>→ Security & governance"]
```

**Componentes da paleta:** [`orchestrator`](../../../reference/components/ai/index.md#orchestrator) (o job do revisor em volta do modelo) · [`llmgw`](../../../reference/components/ai/index.md#llmgw) (roteamento, cotas, prefixo em cache com convenções e ADRs) · [`memory`](../../../reference/components/ai/index.md#memory) (o contexto montado para cada diff) · [`safety`](../../../reference/components/ai/index.md#safety) (texto do PR não confiável, saída validada) · [`metrics`](../../../reference/components/observability/index.md#metrics) (precisão e comentários por PR). **Cenários:** nenhum específico. **Continua em:** [Sistemas de IA — RAG e memória](../../ai-systems/rag-memory/index.md), [Sistemas de IA — LLM Gateway](../../ai-systems/llm-gateway/index.md), [Sistemas de IA — segurança e avaliações](../../ai-systems/safety-evals/index.md), [Segurança e governança](../security-governance/index.md), [Hands-on 13 — o revisor](../../../hands-on/13/review/index.md).

---

[^1]: BACCHELLI, A.; BIRD, C. *Expectations, outcomes, and challenges of modern code review*. ICSE 2013.
[^2]: SADOWSKI, C. et al. *Modern code review: a case study at Google*. ICSE-SEIP 2018.
[^3]: GitHub Docs. [REST API endpoints for pull request reviews](https://docs.github.com/en/rest/pulls/reviews){target="_blank"}.
