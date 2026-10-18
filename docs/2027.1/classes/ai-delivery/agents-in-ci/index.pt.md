O time atualiza o Spring Boot em toda a BoxOffice numa segunda-feira de manhã. Catorze serviços, catorze builds vermelhos: uma propriedade de configuração renomeada aqui, um método depreciado ali, um teste que dependia de um padrão antigo. Cada correção é pequena e tediosa; juntas, tomam dois dias de dois engenheiros. Um **agente** — um modelo que planeja, usa ferramentas, observa o resultado e tenta de novo — pode fazer a maior parte desse trabalho enquanto os engenheiros revisam. Se for mal projetado, ele também pode fazer push na `main`, vazar a chave de deploy, ficar uma hora em loop num teste flaky ou "consertar" um build vermelho apagando a asserção. Esta página trata do projeto que obtém o primeiro resultado e torna o segundo impossível.

---

## O que os agentes fazem em um pipeline

O [loop do agente](../../ai-systems/agents/index.md) — o modelo escolhe uma ferramenta, o harness a executa, o resultado volta para o contexto, repete — vira, no CI, um loop sobre o repositório e o build:

| Workflow agêntico | Gatilho | Verificável por | Raio de impacto típico | Autonomia sensata |
|---|---|---|---|---|
| **Consertar o build que falhou** | Execução de CI falhou | O build e os testes passam; o diff é pequeno | Uma branch | Supervisionada: PR em rascunho |
| **Upgrade de dependência** | PR do Renovate/Dependabot está vermelho | Build, testes, canary | Muitos serviços | Supervisionada; merge automático só de versões de patch com CI verde |
| **Migração** (JUnit 4 → 5, `javax` → `jakarta`, Java 17 → 21) | Campanha planejada | Build, testes, mais um codemod para a parte mecânica | A base de código inteira, em lotes | Supervisionada, um PR por serviço |
| **Da issue ao PR** | Issue rotulada ou `@mention` | Testes escritos com os critérios de aceitação da issue | Uma funcionalidade | Supervisionada; revisão humana como de costume |
| **Sincronizar documentação e configuração** | API ou schema mudou | Lint, verificação de links, diff do OpenAPI | Documentação | Pode ser autônoma para mudanças só de documentação |

Todas as linhas terminam no mesmo lugar: uma **proposta** (uma branch, um PR em rascunho) que verificações determinísticas e um humano aprovam. Esse é o nível 3 do [espectro de autonomia](../index.md#the-autonomy-spectrum). O nível 4 — aplicar mudanças sem aprovação a cada mudança — fica reservado para mudanças que são ao mesmo tempo de baixo risco e totalmente verificáveis, e raramente precisa de um modelo.

---

## Anatomia de um agente que conserta o build

``` mermaid-sim
sequenceDiagram
    autonumber
    participant CI as Execução de CI
    participant Orch as Workflow (determinístico)
    participant Agent as Loop do agente (sandbox)
    participant Model as Modelo
    participant Repo as Host Git
    CI-->>Orch: execução falhou (evento)
    Orch->>Orch: dedup pelo SHA do commit, verifica que a branch não é ai-fix/*
    Orch->>Agent: log da falha + checkout (sem token de escrita)
    loop no máximo N turnos, M dólares
        Agent->>Model: contexto + resultados das ferramentas
        Model-->>Agent: chamada de ferramenta (ler / editar / rodar build)
        Agent->>Agent: executa ferramenta permitida, registra
    end
    Agent-->>Orch: diff da árvore de trabalho + transcrição
    Orch->>Orch: verifica: caminhos permitidos, nenhum teste removido, build verde
    Orch->>Repo: job separado com token de escrita: branch + PR em rascunho
    Repo-->>Orch: humano revisa, CI roda, merge ou fechamento
```

Leia como dois programas. O **agente** é não determinístico e não confiável: pode estar errado, confuso ou ser manipulado por texto no log. O **orquestrador** em volta dele — gatilhos, dedup, verificação, o job do PR — é código determinístico comum, revisado como qualquer outro. Toda a segurança mora no orquestrador.

---

## Rodando agentes headless

Agentes no CI rodam **headless**: sem terminal, sem um humano para responder "posso rodar este comando?". Toda decisão que uma pessoa tomaria interativamente precisa ser tomada **de antemão**, como configuração.

=== "Claude Code (CLI)"

    `claude -p "<task>"` roda o Claude Code de forma não interativa. Flags relevantes da sua [referência de CLI](https://code.claude.com/docs/en/cli-reference){target="_blank"}:

    ```bash
    gh run view "$RUN_ID" --log-failed | tail -n 300 | \
    claude --bare -p "The CI build failed; the log is on stdin. Fix the root cause with the smallest change. Never delete or weaken a test." \
      --allowedTools "Read,Edit,Write,Bash(mvn -B *)" \
      --permission-mode dontAsk \
      --max-turns 25 --max-budget-usd 1.50 \
      --output-format stream-json --verbose > transcript.jsonl
    ```

    `--bare` pula a descoberta automática de hooks, plugins, servidores MCP e `CLAUDE.md` (o mesmo comportamento em toda máquina, e nada carregado do repositório que você não tenha escolhido); `--allowedTools` usa a sintaxe de regras de permissão (`Bash(mvn -B *)` permite apenas comandos que começam com `mvn -B`); `dontAsk` nega todo o resto; `--max-turns` e `--max-budget-usd` limitam o loop; `stream-json` produz uma transcrição para o log de auditoria, cuja última linha informa o custo.

=== "GitHub Action do Claude Code"

    [`anthropics/claude-code-action@v1`](https://github.com/anthropics/claude-code-action){target="_blank"} roda o mesmo motor dentro do GitHub Actions. Sem um `prompt`, ele responde a menções `@claude` em PRs e issues (por padrão, só de usuários com acesso de escrita); com um `prompt`, roda em modo de automação em qualquer evento. As flags da CLI vão em `claude_args`. A configuração interativa da [documentação](https://code.claude.com/docs/en/github-actions){target="_blank"}:

    ```yaml
    name: Claude Code
    on:
      issue_comment:
        types: [created]
      pull_request_review_comment:
        types: [created]
    jobs:
      claude:
        if: contains(github.event.comment.body, '@claude')
        runs-on: ubuntu-latest
        permissions:
          contents: write
          pull-requests: write
          issues: write
          id-token: write
          actions: read
        steps:
          - uses: actions/checkout@v6
            with:
              fetch-depth: 1
          - uses: anthropics/claude-code-action@v1
            with:
              anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    ```

    Repare nas permissões: este job pode escrever código, PRs e issues — adequado para um assistente sob demanda que humanos invocam e que faz push de commits que um humano depois revisa. Para um agente *sem supervisão* que reage a falhas, prefira um job sem acesso de escrita que produza um patch, e um job separado que abra o PR (próxima seção). Consulte a documentação de segurança da action e os inputs atuais antes de usar.

=== "Loop genérico (qualquer provedor)"

    Um agente é um loop que você mesmo pode escrever sobre qualquer API com tool calling — inclusive endpoints compatíveis com OpenAI via LiteLLM ou um modelo local com Ollama. O núcleo, sem tratamento de erros:

    ```python
    for step in range(MAX_STEPS):
        reply = client.chat.completions.create(model=MODEL, messages=messages, tools=TOOLS)
        msg = reply.choices[0].message
        messages.append(msg.model_dump(exclude_none=True))
        if not msg.tool_calls:
            break
        for call in msg.tool_calls:
            result = run_allow_listed(call.function.name, json.loads(call.function.arguments))
            audit(step, call, result)
            messages.append({"role": "tool", "tool_call_id": call.id, "content": result})
    ```

    Escrevê-lo você mesmo torna explícita a **superfície de ferramentas**: aqui o agente tem `read_file`, `write_file` (só em `src/`), `run_build` e `finish` — e nenhum shell. O [hands-on 13](../../../hands-on/13/fix-agent/index.md) tem a versão completa, com orçamentos e log de auditoria.

---

## Sandboxing

O agente executa o build, e o build executa **o código do repositório**: testes, plugins do Maven, scripts. Suponha que esse código — ou o texto que o agente lê — possa ser hostil, e contenha-o em camadas:

| Camada | Controle | Protege contra |
|---|---|---|
| **Ambiente efêmero** | Runner hospedado ou container novo a cada execução, destruído depois | Persistência entre execuções; caches envenenados (cuidado com caches de build compartilhados) |
| **Lista de ferramentas permitidas** | Ler/editar arquivos, rodar *o build*; nenhum shell genérico, nenhum `curl`, nenhum `git push` | O agente fazer qualquer coisa que você não previu |
| **Escopo do sistema de arquivos** | Escrita só em `services/*/src/`; `.github/` e `.git/` inacessíveis | Editar o CI para remover verificações; adulterar o histórico |
| **Limpeza do ambiente** | Build e testes rodam sem variáveis `*KEY*`, `*TOKEN*`, `*SECRET*` | Um teste malicioso lendo o ambiente |
| **Saída de rede** | Só o registry de pacotes e o endpoint do modelo (proxy ou firewall em runners self-hosted) | Exfiltração para hosts arbitrários |
| **Limites de recursos** | Timeout do job, limites de CPU/memória | Loops e builds descontrolados |

Nenhuma camada é perfeita. Uma lista de ferramentas permitidas com `Bash(mvn *)` ainda roda o que quer que os plugins Maven do projeto façam; a limpeza do ambiente não protege a chave da API do modelo mantida pelo próprio processo do agente. É por isso que a chave tem um **limite de gasto**, o job **não tem token de escrita** e a saída é **verificada** fora do agente.

---

## Permissões: o token é o raio de impacto

O que quer que o modelo decida, ele nunca pode fazer mais do que suas credenciais permitem. Projete as credenciais primeiro:

- **`GITHUB_TOKEN` com privilégio mínimo**: declare `permissions:` em todo workflow; o job que roda o agente recebe `contents: read` (e `actions: read` para buscar os logs).
- **Separe os jobs por privilégio**: o job do agente produz um artefato de patch; um job pequeno com `contents: write` e `pull-requests: write` o aplica e abre um **PR em rascunho**. O job com acesso de escrita não roda modelo nem código não confiável.
- **Nenhum segredo no contexto do agente**: nunca cole segredos em prompts ou resultados de ferramentas; mantenha chaves de deploy, credenciais de nuvem e tokens de registry totalmente fora do job.
- **Somente leitura por padrão**: um agente que só diagnostica (explica a falha em um comentário) não precisa de acesso de escrita — comece por aí.
- **Proteção de branch e rulesets**: a `main` exige PRs, CI e uma aprovação humana; bots não podem contornar; mudanças em `.github/workflows/` exigem um code owner.
- **A aprovação humana é estrutural**, não uma instrução no prompt: o agente *não consegue* fazer merge porque seu token não consegue.

---

## Orçamentos: turnos, tokens, dólares, minutos

Cada turno do agente reenvia o contexto inteiro — instruções, definições de ferramentas, o log, cada arquivo lido, cada resultado de ferramenta até ali. O contexto cresce a cada passo, então o **total de tokens de entrada cresce aproximadamente de forma quadrática** com o número de passos ([Sistemas de IA — os números](../../ai-systems/index.md#numbers)). O prompt caching lê o prefixo repetido por uma fração do preço, o que muda drasticamente a inclinação. Premissas ilustrativas: contexto inicial de 20.000 tokens (instruções, definições de ferramentas, log), 2.500 tokens adicionados por passo (resultado da ferramenta mais a saída do modelo), 400 tokens de saída por passo, preços de tabela de um modelo grande na data em que este texto foi escrito (US$ 4 de entrada, US$ 20 de saída, US$ 0,20 de leitura em cache por milhão de tokens):

```python exec="1" html="1"
import matplotlib.pyplot as plt
from io import StringIO

P_IN, P_OUT, P_READ, WRITE = 4.00, 20.00, 0.20, 1.25   # US$ per 1M tokens (illustrative)
START, GROWTH, OUT = 20_000, 2_500, 400               # tokens


def run_cost(steps, cached):
    total, context = 0.0, START
    for i in range(steps):
        new = START if i == 0 else GROWTH
        old = context - new
        if cached:
            total += (old * P_READ + new * P_IN * WRITE) / 1e6
        else:
            total += context * P_IN / 1e6
        total += OUT * P_OUT / 1e6
        context += GROWTH
    return total


steps = list(range(1, 41))
no_cache = [run_cost(s, False) for s in steps]
cache = [run_cost(s, True) for s in steps]

fig, ax = plt.subplots(figsize=(8, 3.6))
ax.plot(steps, no_cache, color="#d1495b", linewidth=2, label="no prompt cache")
ax.plot(steps, cache, color="#2e86ab", linewidth=2, label="prefix cached")
for s in (10, 25, 40):
    ax.annotate(f"US$ {no_cache[s - 1]:.2f}", (s, no_cache[s - 1]), textcoords="offset points",
                xytext=(-10, 8), fontsize=8, color="#d1495b")
    ax.annotate(f"US$ {cache[s - 1]:.2f}", (s, cache[s - 1]), textcoords="offset points",
                xytext=(-10, -14), fontsize=8, color="#2e86ab")
ax.set_xlabel("Agent turns")
ax.set_ylabel("US$ per run")
ax.set_title("Cost of one agent run vs number of turns (illustrative)")
ax.grid(True, alpha=0.3)
ax.legend()
for spine in ax.spines.values():
    spine.set_alpha(0.3)
ax.set_facecolor("none")
ax.tick_params(colors="gray")
ax.xaxis.label.set_color("gray")
ax.yaxis.label.set_color("gray")
ax.title.set_color("gray")
fig.tight_layout()
buffer = StringIO()
fig.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close(fig)
```

Sem cache, 40 turnos custam mais de oito vezes o que custam 10 turnos (cerca de US$ 11 contra US$ 1,3); com cache, a curva é quase linear e cerca de oito vezes mais barata aos 40 turnos. De um jeito ou de outro, o orçamento precisa ser **imposto pelo harness**, e não pedido no prompt:

| Orçamento | Valor típico para consertar o build | Imposto por |
|---|---|---|
| Turnos | 20–30 | `--max-turns`, ou o limite do loop |
| Dólares | US$ 1–2 por execução | `--max-budget-usd`, ou um contador de tokens no loop; **limite de gasto do workspace** no provedor |
| Tempo de relógio | 20–30 min | `timeout-minutes` no job |
| Execuções por commit | 1 | Dedup pelo SHA do commit |
| Execuções por dia por repositório | p. ex. 20 | Cota no LLM gateway |

A razão que importa é **dólares por correção mergeada**, e não por execução: um agente que custa US$ 0,80 por execução, mas produz uma correção mergeável uma vez a cada quatro, custa US$ 3,20 por correção útil — compare isso com o tempo de engenheiro que ele economiza.

---

## Idempotência, retries e loops

Agentes são disparados por eventos, e eventos se repetem: uma execução de CI é reexecutada, dois pushes chegam no mesmo minuto, a própria branch do agente falha no CI. Os padrões de mensageria do curso se aplicam diretamente ([Mensageria — semântica de entrega](../../messaging/semantics/index.md)):

- **Chave de idempotência**: o SHA do commit que falhou. Uma proposta por SHA (branch `ai-fix/<sha8>`, grupo de `concurrency` no SHA). Reexecuções encontram a branch e param.
- **Nada de autodisparo**: nunca rode o agente nas próprias branches (`ai-fix/*`), e lembre que pushes feitos com o `GITHUB_TOKEN` não disparam novas execuções de workflow no GitHub — um disjuntor de loops embutido.
- **Retries são para o transporte, não para a tarefa**: os SDKs repetem `429`/`5xx` com backoff. Reexecutar um *agente que falhou* é uma nova tentativa com um novo custo — torne isso uma decisão humana, ou no máximo um retry automático com uma estratégia diferente.
- **Fail open para agentes consultivos**: se o agente falhar, o build vermelho original continua lá; nada fica pior do que antes.

---

## Auditoria: quem mudou o quê, e por quê

A mudança de um agente precisa ser explicável meses depois. Guarde:

| Registro | Onde |
|---|---|
| A transcrição completa (prompts, chamadas de ferramentas, resultados) | Artefato do CI com período de retenção |
| Id do modelo, versão do prompt, versão do harness | Na transcrição e no corpo do PR |
| Custo e turnos | Resumo do job; agregado no LLM gateway |
| Que o commit foi gerado por IA | Trailer do commit (`AI-assisted: ai-fix (claude-opus-5-5)`), rótulo `ai-generated` no PR |
| Quem aprovou | A revisão do PR — o humano responsável |

É a mesma disciplina de qualquer mudança em produção, e ela alimenta a [proveniência da cadeia de suprimentos](../security-governance/index.md) do software: você consegue responder "que código do `inventory` foi escrito por um agente, e aprovado por quem?".

---

## Agentes de dependências e de migração

**Upgrades de dependências** são, na prática, o workflow agêntico mais comum. Bots como o Renovate ou o Dependabot abrem o PR de upgrade de forma determinística; o trabalho do agente começa quando esse PR fica **vermelho**: ler o changelog e a falha, adaptar o código, manter a mudança mínima. Agrupe atualizações relacionadas (todos os artefatos do Spring juntos), deixe as atualizações de patch com CI verde fazerem merge automático sem IA e mande as versões major para um agente que propõe e um humano que aprova.

**Migrações** — JUnit 4 → 5, `javax.*` → `jakarta.*`, Java 17 → 21 — misturam uma grande parte mecânica com uma cauda longa de casos especiais. Use **codemods** determinísticos para a parte mecânica (receitas do OpenRewrite são a ferramenta padrão para Java) e o agente para as sobras que a receita não resolve. Divida a campanha em **um PR por serviço**, pequeno o bastante para revisar, atrás do CI e do canary normais. As mudanças em larga escala no Google seguiam o mesmo princípio muito antes dos LLMs: automatizar a mudança, fragmentá-la em pedaços revisáveis de forma independente e deixar os responsáveis revisarem cada pedaço[^1].

!!! example "BoxOffice: o upgrade do Spring Boot, de novo"

    O Renovate abre um PR agrupado por serviço. Seis ficam verdes e são mergeados após revisão. Para os oito vermelhos, o agente de correção roda uma vez por commit que falhou, com `mvn` como único comando de shell, um teto de US$ 1,50 e 25 turnos. Ele propõe seis correções como PRs em rascunho (propriedades renomeadas, um padrão alterado em um test slice); nos outros dois, ele para e explica (uma API removida que exige uma decisão de projeto). Dois engenheiros revisam oito PRs em uma manhã, em vez de consertar catorze serviços em dois dias — e os dois casos difíceis recebem toda a atenção deles.

---

!!! tip "Na entrevista"

    Para "projete um agente que conserta builds quebrados", desenhe o **orquestrador** em volta do agente, e não só o loop: gatilho e dedup, sandbox e lista de ferramentas permitidas, orçamentos impostos pelo harness, verificação fora do agente, um passo privilegiado separado que abre um PR em **rascunho**, e a trilha de auditoria. Quantifique o custo por execução (quadrático nos turnos, atenuado pelo cache) e por correção *mergeada*. Diga quais falhas ele *não* deve tocar (testes flaky, infraestrutura, achados de segurança) e como o sistema as detecta.

!!! warning "Armadilhas comuns"

    - **Um único job com o agente e um token de escrita**: toda prompt injection vira um push.
    - **Orçamentos no prompt** ("por favor, pare depois de 10 passos") em vez de no harness.
    - **Confiar no "consertei" do agente**: verifique de forma independente; confira que nenhum teste foi removido ou enfraquecido.
    - **Agentes disparando agentes**: uma branch de correção falha no CI, o que dispara o agente de correção, que…
    - **Rodar agentes sobre código de forks com segredos** (`pull_request_target`, `workflow_run`): veja [Segurança e governança](../security-governance/index.md).

---

## Como se conecta { #how-it-connects }

``` mermaid
flowchart LR
    TRIG["red build event<br/>trigger + dedupe"] --> HARN["harness = orchestrator"]
    HARN --> SB["sandbox, tool allow-list,<br/>no write token"]
    HARN --> BUD["budgets: turns, tokens,<br/>dollars, minutes"]
    HARN --> LOOP["agent loop<br/>→ AI systems agents"]
    LOOP --> VER["verification<br/>outside the agent"]
    VER --> PRIV["separate privileged step<br/>opens a draft PR"]
    PRIV --> HUM["human review"]
    HARN --> IDEM["idempotency, retries, loops<br/>→ Messaging semantics"]
    HARN --> AUD["audit trail:<br/>who changed what, and why"]
```

**Componentes da paleta:** [`orchestrator`](../../../reference/components/ai/index.md#orchestrator) (o harness que impõe orçamentos e permissões) · [`toolreg`](../../../reference/components/ai/index.md#toolreg) (a lista de ferramentas que o agente pode chamar) · [`llmgw`](../../../reference/components/ai/index.md#llmgw) (cotas e custo por execução) · [`safety`](../../../reference/components/ai/index.md#safety) (nenhum segredo ou token de escrita ao alcance do agente) · [`logs`](../../../reference/components/observability/index.md#logs) (a trilha de auditoria) · [`metrics`](../../../reference/components/observability/index.md#metrics) (correções aceitas por proposta, custo por correção aceita). **Cenários:** `ai-assistant` com o perfil `spike` (centenas de agentes ao mesmo tempo disputam o gateway com o tráfego dos usuários). **Continua em:** [Sistemas de IA — agentes](../../ai-systems/agents/index.md), [Mensageria — semântica](../../messaging/semantics/index.md) (execuções pelo menos uma vez, efeitos idempotentes), [Segurança e governança](../security-governance/index.md), [Cloud-native — entrega](../../cloud-native/delivery/index.md), [Hands-on 13 — agente de correção](../../../hands-on/13/fix-agent/index.md).

---

[^1]: WINTERS, T.; MANSHRECK, T.; WRIGHT, H. *Software Engineering at Google*, cap. 22 "Large-Scale Changes". O'Reilly, 2020.
