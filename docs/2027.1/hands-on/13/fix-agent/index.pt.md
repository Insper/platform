O revisor da parte 1 faz **uma** chamada ao modelo e posta texto. Um **agente** é diferente: ele roda um loop — lê um arquivo, edita, roda o build, lê o erro, edita de novo — escolhendo o próprio próximo passo até a tarefa terminar ou um orçamento se esgotar (veja [Agentes e ferramentas](../../../classes/ai-systems/agents/index.md)). Isso o torna muito mais capaz, e muito mais perigoso: ele executa comandos, escreve código e custa mais a cada passo. Esta parte constrói um agente que reage a uma **execução de CI com falha** propondo uma correção como um **pull request em rascunho** — e gasta a maior parte das suas linhas mantendo esse agente dentro de uma caixa.

## 3.1 O fluxo e suas fronteiras de confiança

``` mermaid-sim
sequenceDiagram
    autonumber
    participant CI as Workflow de CI (lab 11)
    participant Fix as job "fix"<br/>contents: read, actions: read
    participant Agent as Agente<br/>(Claude Code ou fix_agent.py)
    participant Open as job "open-pr"<br/>contents: write, pull-requests: write
    actor Human as Revisor
    CI-->>Fix: workflow_run concluído (falha)
    Fix->>Fix: dedup: o branch ai-fix/<sha> existe? para
    Fix->>Fix: gh run view --log-failed | tail -300
    Fix->>Agent: log + repositório (sem token do GitHub)
    Agent->>Agent: lê · edita · mvn verify (≤ 25 turnos, ≤ US$ 1,50)
    Agent-->>Fix: alterações na árvore de trabalho
    Fix->>Fix: verifica: só src/, nenhum teste removido, mvn verify passa
    Fix->>Open: artefato ai-fix.patch (+ transcrição)
    Open->>Open: aplica o patch, commit com trailer de IA, push de ai-fix/<sha>
    Open->>Human: PR em rascunho, label ai-generated
    Human->>Human: revisa, roda o CI, faz merge ou fecha
```

Três separações fazem o trabalho de segurança:

| Separação | O que ela impede |
|---|---|
| **O agente nunca tem um token do GitHub.** Só a `ANTHROPIC_API_KEY` (ou a chave do LiteLLM) está no ambiente dele | Um agente confuso ou vítima de injection não consegue fazer push, comentar, aprovar nem ler outros repositórios |
| **A verificação não é feita pelo agente.** Um passo de shell simples roda `mvn verify` de novo, rejeita arquivos fora de `services/<name>/src/` e rejeita `@Test` removidos ou `@Disabled` adicionados | "Consertei o build" é verificado, não acreditado; o atalho clássico — apagar o teste que falha — é pego |
| **Só o `open-pr` pode escrever**, e ele não roda modelo nem build: ele aplica um patch | O acesso de escrita fica com dez linhas de shell determinístico |

E um humano faz o merge. Nada neste workflow chega à `main` sem um review exigido pela proteção de branch.


## 3.2 Caminho A — Claude Code, headless (pago)

O [Claude Code](https://code.claude.com/docs/en/headless){target="_blank"} pode rodar de forma não interativa com `claude -p`. As flags usadas aqui, da sua referência de CLI:

| Flag | Papel neste lab |
|---|---|
| `--bare` | Pula a descoberta automática de hooks, skills, plugins, servidores MCP e `CLAUDE.md` do repositório — o agente carrega **só** o que a linha de comando lhe dá, igual em todo runner |
| `--allowedTools "Read,Edit,Write,Bash(mvn -B *)"` | Ferramentas que rodam sem perguntar; o shell fica limitado a comandos que começam com `mvn -B` |
| `--permission-mode dontAsk` | Tudo o que não é permitido é **negado**, não perguntado (ninguém consegue responder a uma pergunta no CI) |
| `--max-turns 25` | Limite de turnos do agente |
| `--max-budget-usd 1.50` | Para a execução quando o gasto estimado atinge o limite (uma estimativa do lado do cliente — deixe folga) |
| `--output-format stream-json --verbose` | Um evento JSON por linha: a transcrição completa, guardada como **log de auditoria**; a última linha é o resultado com `total_cost_usd` |
| `--model` | O modelo, vindo da variável `LLM_MODEL` |

O log da falha chega pela **stdin**, então o agente não precisa de permissão para ler arquivos fora do repositório.


O caminho A só roda quando a variável de repositório `LLM_PROVIDER` é `anthropic`, e precisa do segredo `ANTHROPIC_API_KEY`: **toda execução é cobrada**, com teto de US$ 1,50 pelo `--max-budget-usd`. O workflow instala uma versão **fixada** do Claude Code (`@anthropic-ai/claude-code@2.1.302`); atualize-a de propósito, como qualquer outra dependência. Sem chave, pule para o caminho B — ele é o padrão.

!!! info "A GitHub Action do Claude Code"

    A Anthropic também publica a [`anthropics/claude-code-action@v1`](https://github.com/anthropics/claude-code-action){target="_blank"}, que empacota o mesmo motor para o GitHub: menções `@claude` em PRs e issues, ou automação com um input `prompt`, e flags de CLI por meio de `claude_args` (por exemplo `--max-turns 5 --model ...`). É o jeito mais rápido de ter um assistente sob demanda nos PRs. Este lab chama a CLI diretamente porque queremos a **separação por artefato de patch** acima, em que o job que roda o agente não tem token de escrita; consulte a [documentação de segurança](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md){target="_blank"} da action se você a usar para escritas.


## 3.3 Caminho B — um agente neutro em relação ao provedor em menos de 200 linhas (gratuito com Ollama)

Para ver que um agente é "só um loop", o `fix_agent.py` implementa um sobre qualquer endpoint compatível com OpenAI com chamada de ferramentas (LiteLLM, ou Ollama com um modelo que suporte ferramentas). Ele tem cinco ferramentas — `list_files`, `read_file`, `write_file`, `run_build`, `finish` — e **nenhum shell**.

``` { .python title=".github/ai/fix_agent.py" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/13/code/.github/ai/fix_agent.py"
```

| Proteção | Onde |
|---|---|
| Caminhos resolvidos e mantidos dentro do repositório; `.git/` e `.github/` inalcançáveis | `safe()` |
| Escreve só em `services/<name>/src/` | `safe(..., write=True)` |
| O build roda com um ambiente **sem** variáveis `KEY`, `TOKEN`, `SECRET` | `run_build()` |
| Erros de ferramenta voltam ao modelo como texto, nunca derrubam o loop | `call_tool()` + `except` |
| Orçamento: passos, tokens e dólares | `MAX_STEPS`, `MAX_TOKENS`, `MAX_USD` |
| Toda chamada de ferramenta registrada em `agent-audit.jsonl` (fora do repositório) | `AUDIT` |
| Uma chamada de ferramenta escrita como **texto** JSON (modelos locais pequenos fazem isso) é aceita como chamada, nunca executada como código | `text_tool_call()` |
| `run_build("catalog")` é lido como `services/catalog`; um `pom.xml` ausente vira mensagem de erro, não um crash | `run_build()` |

## 3.4 O workflow

``` { .yaml title=".github/workflows/ai-fix.yaml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/13/code/.github/workflows/ai-fix.yaml"
```

| Detalhe | Por quê |
|---|---|
| `on: workflow_run` | Roda **depois** que o CI termina, com a definição do workflow do branch padrão |
| `head_repository.full_name == github.repository` | O `workflow_run` roda com os segredos deste repositório mesmo quando a execução de CI veio de um fork; fazer checkout e build do código do fork aqui seria um *pwn request* (parte 6) |
| `!startsWith(head_branch, 'ai-fix/')` | Os próprios branches do agente nunca disparam outro agente: nada de loops |
| `concurrency` no SHA do head + verificação do branch `ai-fix/<sha8>` | **Idempotente**: uma proposta por commit com falha, mesmo que a execução seja repetida |
| `if-no-files-found: ignore` + `always()` | A transcrição é enviada mesmo quando o agente falha — é justamente quando você precisa dela |

| `--trailer "AI-assisted: ..."` | O commit diz que foi gerado por IA, e com qual modelo |
| `vars.LLM_PROVIDER == 'anthropic'` → caminho A, senão caminho B | Uma variável troca o agente; sem variável nenhuma, o caminho B roda com o Ollama **no runner** (gratuito, mas um runner só com CPU precisa de muitos minutos para 20 passos — a execução local da 3.5 é bem mais rápida) |

!!! warning "Duas configurações do GitHub que você precisa conhecer"

    1. O `GITHUB_TOKEN` só pode criar pull requests se **Allow GitHub Actions to create and approve pull requests** estiver habilitado — o passo 0.4 do [setup](../index.md#repository-settings) fez isso. Este lab nunca aprova.
    2. Eventos causados pelo `GITHUB_TOKEN` (o push de `ai-fix/...`, o PR que ele abre) **não disparam outros workflows**, então o CI não roda sozinho no PR em rascunho. É uma proteção do GitHub contra loops. Para rodar o CI nele, faça push de um commit vazio da sua máquina: `gh pr checkout <número do PR em rascunho>`, depois `git commit --allow-empty -m "ci: run CI on the AI fix" && git push` (ou use um token de GitHub App se o seu time automatizar isso).

## 3.5 Quebre o build de propósito

Faça commit do agente e do seu workflow na `main` antes (workflows `workflow_run` só rodam a partir do branch padrão):

``` { .bash .copy }
git switch main && git pull
git add .github/ai/fix_agent.py .github/workflows/ai-fix.yaml
git commit -m "ci(ai): fix agent for failed CI runs (lab 13)"
git push
```

Agora um bug **realista** que um teste unitário pega: em `deleteEvent` do `CatalogService`, alguém "simplifica" a verificação de existência e tira o `!`:

``` { .bash .copy }
git switch -c break-catalog
```

``` { .diff title="services/catalog/src/main/java/boxoffice/catalog/CatalogService.java" }
     public void deleteEvent(Long id) {
-        if (!events.existsById(id)) {
+        if (events.existsById(id)) {
             throw notFound("event", id);
         }
```

``` { .bash .copy }
git commit -am "catalog: simplify deleteEvent"
```

**Localmente primeiro** (de graça, e minutos em vez de dezenas de minutos). Reproduza o que o CI vai ver, entregue o log ao agente e veja o que ele mudou. O Docker precisa estar rodando: o `mvn verify` — o seu, o `run_build` do agente e o passo de verificação no CI — também roda o teste com Testcontainers `CatalogApiTest` do lab 11:

``` { .bash .copy }
mvn -B -f services/catalog/pom.xml verify > /tmp/ci-full.log 2>&1; tail -n 300 /tmp/ci-full.log > /tmp/ci-failure.log
grep -E "Tests run: .*(Failures: [1-9]|Errors: [1-9])|BUILD" /tmp/ci-failure.log | head -n 3
AGENT_AUDIT=/tmp/agent-audit.jsonl uv run --no-project --python 3.12 \
  --with-requirements .github/ai/requirements.txt python .github/ai/fix_agent.py /tmp/ci-failure.log
git diff                                   # the agent's change, if any
jq -c '{step, tool, args}' /tmp/agent-audit.jsonl   # what it did, step by step (or: cat the file)
```

O `grep` precisa mostrar a falha que o CI vai ver (o Maven 3.9 imprime `[INFO] BUILD FAILURE`):

```text
[ERROR] Tests run: 3, Failures: 1, Errors: 1, Skipped: 0, Time elapsed: 0.618 s <<< FAILURE! -- in boxoffice.catalog.CatalogServiceTest
[ERROR] Tests run: 6, Failures: 1, Errors: 1, Skipped: 0
[ERROR] BUILD FAILURE
```

O agente imprime uma linha JSON no final: `fixed`, a sua `explanation`, os tokens, os passos e o tempo. Uma execução com o `qwen2.5-coder-16k` local enquanto este lab era escrito:

```text
{"fixed": false, "explanation": "```json\n{\"name\": \"write_file\", ... (abridged)", "model": "qwen2.5-coder-16k", "calls": 20, "in": 165075, "cache_read": 0, "cache_write": 0, "out": 5596, "seconds": 517.1, "usd": 0.0, "steps": 20}
```

Leia o log de auditoria ao lado do `git diff`: o modelo gratuito de 7B **nunca abriu o `CatalogService.java`**. Ele reescreveu o *teste* seis vezes — acrescentando, entre outros, um teste que espera um `404` quando o evento **existe**, o que transforma o bug em especificação (o problema do oráculo da parte 2) — depois quebrou a compilação com um método duplicado e esgotou os seus 20 passos depois de 8 minutos e meio e 165.075 tokens de entrada, terminando com `"fixed": false`. Nada perigoso aconteceu: toda escrita ficou em `services/catalog/src/`, e no CI o `mvn verify` independente do passo de verificação falha com este patch, então nenhum PR é aberto. Esse é o objetivo das proteções — elas tornam um agente ruim inofensivo, não bom. Rode de novo com um modelo mais forte, se tiver um, e compare.

```text
$ jq -c '{step, tool, args}' /tmp/agent-audit.jsonl
{"step":1,"tool":"read_file","args":{"path":"services/catalog/src/test/java/boxoffice/catalog/CatalogServiceTest.java"}}
{"step":2,"tool":"write_file","args":{"path":"services/catalog/src/test/java/boxoffice/catalog/CatalogServiceTest.java","content":"<2431 chars>"}}
{"step":3,"tool":"run_build","args":{"service":"catalog"}}
...
{"step":18,"tool":"run_build","args":{"service":"catalog"}}
{"step":19,"tool":"read_file","args":{"path":"services/catalog/src/test/java/boxoffice/catalog/CatalogServiceTest.java"}}
```

Seja o que for que ele fez, **verifique como o workflow faz**: `git diff --stat` só pode listar arquivos em `services/catalog/src/`, nenhum `@Test` pode sumir, e `mvn -B -f services/catalog/pom.xml verify` precisa passar. Depois desfaça a mudança do agente (`git checkout -- services`) — a execução de CI abaixo deve partir do commit quebrado.

**Depois no CI:**

1. Faça push do branch e abra um PR: `git push -u origin break-catalog && gh pr create --fill --base main`.
2. O CI falha (`gh pr checks` mostra `CI` em vermelho). Em menos de um minuto o workflow `AI fix` começa: `gh run list --workflow ai-fix.yaml --limit 1`. Com o modelo gratuito no runner, dê a ele até 45 minutos.
3. Abra o resumo e baixe o artefato `ai-fix`: `gh run download <run id> -n ai-fix -D /tmp/ai-fix`. Ele tem `agent-audit.jsonl` (caminho B) ou `agent-transcript.jsonl` (caminho A), e `ai-fix.patch` se a mudança passou na verificação.
4. Se a verificação passou, aparece um PR em rascunho `AI fix proposal for break-catalog (<sha>)`: `gh pr list --label ai-generated`. Leia-o e responda em `results/lab13.md`:
    - O agente corrigiu o **código** ou dobrou o **teste**? (A proteção pega testes apagados, não uma asserção enfraquecida — ele tentou?)
    - Quantos passos (ou turnos) e quantos dólares ou minutos foram necessários? Compare com o tempo que *você* levou.
    - Você faria o merge? Aprove ou feche o PR com uma justificativa escrita (`gh pr review --approve -b "..."` ou `gh pr close -c "..."`).
5. Repita com uma falha que o agente **não consegue** corrigir só com o repositório — por exemplo, um teste que precisa de um banco que o job de CI não sobe. Um bom agente para e explica (`"fixed": false`); um ruim edita arquivos aleatórios. O seu passo de verificação é o que mantém o segundo caso inofensivo.

Quando terminar, feche o PR `break-catalog` sem merge (`gh pr close break-catalog --delete-branch`).

!!! tip "Onde agentes no CI compensam"

    Falhas mecânicas com um sinal claro no log: erros de compilação depois de atualizar uma dependência, um método renomeado, um import quebrado, uma verificação de formatação, um teste que falha porque uma mensagem esperada mudou. Eles compensam menos em testes instáveis e problemas de infraestrutura — classifique esses primeiro (a página da aula sobre [testes](../../../classes/ai-delivery/testing/index.md) trata da triagem de testes instáveis).


## Solução de problemas

| Sintoma | Causa | Correção |
|---|---|---|
| O `AI fix` nunca começa depois que o CI falha | o workflow não está no branch padrão, ou o seu workflow de CI não se chama `CI` | faça merge do `ai-fix.yaml` na `main`; `gh workflow list` mostra o nome do CI — use-o em `workflows: [...]` |
| A execução é **pulada** | o CI não falhou, o branch começa com `ai-fix/` ou `ai-tests/`, ou a execução de CI veio de um fork | esperado: são as proteções |
| `fixed: false`, `explanation: stopped by budget after N steps` | o modelo se perdeu (comum em modelos pequenos) | leia o `agent-audit.jsonl`; aumente `AGENT_MAX_STEPS` localmente, ou teste um modelo mais forte |
| `ERROR: ... only files under services/<name>/src/ may be written` na auditoria | o agente tentou editar o `pom.xml`, um workflow ou outro arquivo protegido | esperado: a proteção funcionou |
| `the agent changed files outside services/<name>/src/` no passo de verificação | o caminho A escreveu fora de `src/` | o patch é rejeitado de propósito; leia a transcrição |
| `openai.BadRequestError ... does not support tools` | o modelo do Ollama não tem chamada de ferramentas | use o `qwen2.5-coder-16k` (feito a partir do `qwen2.5-coder:7b`, que suporta ferramentas) |
| Execução local: `agent-audit.jsonl` aparece no `git status` | `AGENT_AUDIT` não definido, então o log foi para a raiz do repositório | defina `AGENT_AUDIT=/tmp/agent-audit.jsonl` como no comando acima; apague o arquivo perdido |

[Próximo: parte 4 — release notes](../release-notes/index.md){ .md-button .md-button--primary }
