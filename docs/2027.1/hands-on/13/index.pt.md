!!! abstract "Neste lab"

    - Adicionar **cinco etapas de IA** ao pipeline do BoxOffice do [lab 11](../11/index.md): um revisor de pull requests, um gerador de testes avaliado por testes de mutação, um agente que propõe uma correção quando o CI falha, release notes a cada tag e um veredito de canary explicado.
    - Executar todas as etapas por meio de **um cliente pequeno e neutro em relação ao provedor**: um **modelo local com o Ollama** (gratuito, o padrão), o Claude pelo SDK oficial, ou qualquer endpoint compatível com OpenAI pelo LiteLLM.
    - **Endurecer** os workflows: permissões, gatilhos, segredos e um teste de prompt injection ao qual o revisor precisa resistir.
    - **Medir**: precisão das revisões, custo por PR, minutos de CI e tempo até o merge ao longo de uma semana de pull requests.

O lab 11 deu ao BoxOffice um pipeline que compila, testa, escaneia, assina e libera cada mudança por trás de um canary. O lab 12 colocou um modelo de linguagem *dentro* do produto. Este lab coloca modelos de linguagem **dentro do pipeline** — e os trata com a mesma disciplina de qualquer outra dependência: privilégio mínimo, orçamentos, validação de toda saída e números que digam se eles ajudam.

A regra do lab inteiro: **a IA propõe; regras e humanos decidem.** Nenhuma etapa deste lab consegue fazer merge, aprovar, fazer deploy ou rollback sozinha. O modelo escreve comentários, patches e explicações; verificações determinísticas (testes, score de mutação, limites da política) e pessoas decidem.

## Antes de começar { #before-you-start }

| | |
|---|---|
| **Tempo** | 6–8 horas para as partes 0–6 (uma parte por sessão é ok), mais ~15 minutos por dia durante uma semana na parte 7 |
| **Você precisa** | das ferramentas do lab 0; de uma **conta no GitHub** (o repositório no GitHub, a CLI `gh` autenticada); para o modelo gratuito, **~6 GB de RAM livre e ~5 GB de disco** (máquinas de 8 GB: veja [Solução de problemas](#troubleshooting)) |
| **Diretório** | todo comando roda na raiz do seu repositório `boxoffice/` (Windows: dentro do WSL 2) |
| **Custos** | **zero** no caminho padrão: o modelo roda na sua máquina (Ollama) ou no runner do GitHub. O que pode custar dinheiro está em [O que custa dinheiro](#costs) |

``` { .bash .copy }
git --version                 # git 2.40+
gh --version                  # gh 2.x
gh auth status                # "Logged in to github.com account <you>"
uv --version                  # uv 0.5+ (runs every Python script of this lab)
java -version                 # 21 or newer
mvn -v                        # Apache Maven 3.9+
docker info > /dev/null && echo "Docker is running"   # mvn verify starts Testcontainers (parts 2-3)
ollama --version              # installed in step 0.1
```

**Estado inicial** — o fim do lab 12: o seu repositório `boxoffice`, **publicado no GitHub**, com

``` { .tree title="boxoffice/ at the start of lab 13" }
boxoffice/
    .github/workflows/ci.yaml   # lab 11: "name: CI", runs `mvn -B verify` for each service
    docker-compose.yaml  infra/  load/  scripts/  results/
    services/catalog/  services/inventory/  services/auth/  services/gateway/  ...
    k8s/ ...                    # lab 10-11 (only needed for the optional live canary, step 5.4)
```

Este lab usa principalmente `services/catalog` (um serviço Spring Boot 4.1.1 na porta 8082, veja o [lab 0](../0/index.md#boxoffice-services-and-ports)) e o workflow de CI do lab 11. O cluster Kubernetes e o proxy LiteLLM do lab 12 são **opcionais**.

!!! tip "Recupere o atraso"

    Pulou ou quebrou o lab 12? Baixe [boxoffice-after-lab-12.zip](../12/boxoffice-after-lab-12.zip), descompacte e `cd boxoffice`. Depois publique no GitHub — as etapas de IA rodam no GitHub Actions:

    ``` { .bash .copy }
    git init -b main && git add -A && git commit -m "boxoffice after lab 12"
    gh repo create boxoffice --public --source . --push
    ```

    Este lab **adiciona** `.github/ai/` (scripts, golden set, snapshots de canary), `.github/actions/ollama/`, cinco workflows `ai-*.yaml`, `CONVENTIONS.md`, `docs/adr/0001-schema-per-service.md`, `Dockerfile.ai-tools`, `k8s/catalog/analysis-explained.yaml` e um teste unitário do `catalog`, e **substitui** `services/catalog/pom.xml`. Todos aparecem completos nestas páginas e estão todos em [`boxoffice-after-lab-13.zip`](boxoffice-after-lab-13.zip). Se o seu workflow de CI não se chama `CI`, altere `workflows: [CI]` em `ai-fix.yaml` (parte 3).

!!! info "Siglas usadas neste lab"

    **PR** pull request · **CI** integração contínua · **LLM** modelo de linguagem grande · **ADR** registro de decisão de arquitetura · **PIT** a ferramenta de testes de mutação para Java ([pitest.org](https://pitest.org){target="_blank"}) · **SHA** o hash que identifica um commit Git · **pp** pontos percentuais (5 % → 10 % é +5 pp) · **SDK** kit de desenvolvimento de software.

## Slides

<div class="slides-embed">
  <iframe src="slides/ai-cicd.html" title="Slides: hands-on 13 — IA no CI/CD" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/ai-cicd.html){:target="_blank"}

!!! info "Conexão com a teoria"

    Este lab acompanha a aula [Entrega assistida por IA](../../classes/ai-delivery/index.md). Leia as páginas [Code review](../../classes/ai-delivery/code-review/index.md) e [Segurança e governança](../../classes/ai-delivery/security-governance/index.md) antes das partes 1 e 6. Ele se apoia na página [Entrega](../../classes/cloud-native/delivery/index.md) da aula de cloud native e no [LLM gateway](../../classes/ai-systems/llm-gateway/index.md) da aula de sistemas de IA.

## O que você vai construir

``` mermaid-sim
flowchart LR
    dev([Desenvolvedor]) -->|"abre PR"| pr["Pull request"]
    pr --> rev["1 · Review por IA<br/>comentários inline + custo"]
    pr -->|"label ai-tests"| gen["2 · Testes por IA<br/>o PIT precisa melhorar"]
    pr --> ci["CI (lab 11)<br/>build · teste · scan"]
    ci -->|"falha"| fix["3 · Agente de correção<br/>PR em rascunho"]
    ci -->|"merge + tag"| rel["4 · Release notes por IA<br/>release em rascunho"]
    rel --> canary["Canary (lab 11)"]
    canary --> expl["5 · Veredito da política<br/>+ explicação da IA"]
    expl -->|"promove / rollback"| prod([Produção])
    sec["6 · Endurecimento<br/>permissões · teste de injection"] -.-> rev
    sec -.-> fix
    meas["7 · Meça<br/>precisão · US$/PR · minutos"] -.-> rev
```

Toda etapa de IA tem a mesma forma — um **gatilho**, a **coleta de contexto**, **uma chamada ao modelo (ou um loop de agente limitado) com saída estruturada**, a **validação** e uma **ação com a menor permissão possível**:

| Parte | Gatilho | Contexto | Saída | Validada por | Ação (permissão) |
|---|---|---|---|---|---|
| [1. Review por IA](review/index.md) | `pull_request` | diff numerado, `CONVENTIONS.md`, ADRs | achados em JSON | só linhas adicionadas, limites, deduplicação | comentários de review (`pull-requests: write`) |
| [2. Testes por IA](tests/index.md) | label `ai-tests` | classe, vizinhas, testes existentes | uma classe de teste | compila, passa duas vezes, **score do PIT** sobe | PR em rascunho (job separado) |
| [3. Agente de correção](fix-agent/index.md) | `workflow_run` com falha | log da falha, repositório | um patch | `mvn verify`, nenhum teste removido, só `src/` | PR em rascunho (job separado) |
| [4. Release notes](release-notes/index.md) | tag `v*` | commits, diffstat, migrations | itens em JSON com referências | todo item cita um commit real | release em **rascunho** (`contents: write`) |
| [5. Canary](canary/index.md) | etapa de análise | números do Prometheus | explicação | precisa repetir o veredito da **política** | nenhuma: a política decide |
| [6. Segurança](security/index.md) | — | — | — | golden set + casos de injection | — |
| [7. Meça](measure/index.md) | semanal | histórico de PRs | relatório | — | — |



## 0. Setup: um cliente, três formas de chegar a um modelo

Todos os scripts ficam em `.github/ai/` do seu repositório e importam um único módulo, `llm.py`. Ele esconde o provedor atrás de uma única função, `complete_json(system, user, schema)`, que devolve **JSON validado contra um schema** junto com o **uso de tokens e o seu custo**. O provedor é escolhido por variáveis de ambiente — os mesmos nomes localmente e no GitHub Actions (como *variables* do repositório):

| Variável | Padrão | Significado |
|---|---|---|
| `LLM_PROVIDER` | `ollama` | `ollama` (local, gratuito), `anthropic` (Claude) ou `openai` (qualquer endpoint compatível com OpenAI, ex.: LiteLLM) |
| `LLM_MODEL` | `qwen2.5-coder-16k` no `ollama`, `claude-opus-5-5` no `anthropic` | o id do modelo |
| `LLM_BASE_URL` | `http://localhost:11434/v1` no `ollama` | endpoint de `ollama` / `openai` |
| `LLM_API_KEY`, `ANTHROPIC_API_KEY` | — | **segredos**, só para os caminhos pagos ou remotos |

### 0.1 Escolha um modelo { #pick-a-model }

=== "Modelo local com Ollama (gratuito, padrão)"

    1. Instale o [Ollama](https://ollama.com/download){target="_blank"} e inicie-o:

        ``` { .bash .copy }
        # macOS
        brew install ollama && brew services start ollama
        # Linux and Windows (inside WSL 2)
        curl -fsSL https://ollama.com/install.sh | sh
        ```

        Verifique se o servidor responde: `curl -s http://localhost:11434/api/version` imprime `{"version":"..."}`. No Linux sem systemd (algumas instalações de WSL), inicie-o à mão em outro terminal com `ollama serve`.

    2. Baixe o modelo — **depois** de salvar os arquivos do passo 0.2 (o script é um deles):

        ``` { .bash .copy }
        bash .github/ai/ollama-model.sh
        ```

        Ele baixa o `qwen2.5-coder:7b` (4,7 GB, uma vez) e cria o `qwen2.5-coder-16k`, o mesmo modelo com uma **janela de contexto de 16.384 tokens**. A janela padrão do Ollama é de 4.096 tokens, e um prompt maior é cortado **em silêncio** — o revisor perderia as instruções num diff grande. No final, você deve ver:

        ```text
        success
        ready: LLM_PROVIDER=ollama LLM_MODEL=qwen2.5-coder-16k (context 16384 tokens)
        ```

    Nada mais a configurar: `ollama` é o provedor padrão. No GitHub Actions, os workflows instalam o Ollama **no runner** com a action composta `.github/actions/ollama` (abaixo) — de graça, mas devagar: um runner só com CPU precisa de minutos por chamada, onde o seu notebook precisa de segundos. Espere uma qualidade de review menor que a de um modelo de fronteira; a parte 6 mede *quanto* menor.

=== "Claude (API da Anthropic, pago)"

    1. Crie uma chave de API no [Claude Console](https://platform.claude.com){target="_blank"} e defina um **limite de gasto mensal** para o workspace dela (alguns dólares bastam para este lab).
    2. Localmente: `export LLM_PROVIDER=anthropic` e `export ANTHROPIC_API_KEY=<a chave que você acabou de criar>` (nunca faça commit dela; o `.gitignore` do lab 0 já ignora `.env`).
    3. No GitHub: **Settings → Secrets and variables → Actions**, ou com o `gh`:

        ``` { .bash .copy }
        gh secret set ANTHROPIC_API_KEY          # paste the key when asked
        gh variable set LLM_PROVIDER --body anthropic
        gh variable set LLM_MODEL --body claude-opus-5-5   # or claude-sonnet-5-5 / claude-haiku-4-5: cheaper
        ```

    O cliente chama a Messages API pelo SDK oficial `anthropic` com **saídas estruturadas** (`output_config.format` com um JSON schema), **prompt caching** do prompt de sistema e o **fallback de recusa** do lado do servidor (um beta) nos modelos que o suportam. Consulte a [visão geral dos modelos](https://platform.claude.com/docs/en/about-claude/models/overview){target="_blank"} para os ids e preços atuais.

=== "Qualquer provedor pelo LiteLLM (opcional)"

    O proxy LiteLLM do [lab 12](../12/index.md) expõe um endpoint **compatível com OpenAI** na frente de qualquer provedor. Localmente: `export LLM_PROVIDER=openai LLM_BASE_URL=http://localhost:4000/v1 LLM_MODEL=<um alias de modelo do seu proxy>` e `export LLM_API_KEY=<a sua chave virtual do LiteLLM>`; `curl -s -H "Authorization: Bearer $LLM_API_KEY" $LLM_BASE_URL/models` lista os aliases.

    Runners hospedados pelo GitHub não alcançam o `localhost` do seu notebook: no CI, esse caminho exige um proxy LiteLLM acessível pela internet (ou um runner self-hosted). Defina as variáveis de repositório `LLM_PROVIDER=openai`, `LLM_BASE_URL`, `LLM_MODEL` e o segredo `LLM_API_KEY` (uma chave virtual com orçamento próprio).

!!! note "E o GitHub Models?"

    Versões anteriores deste lab podiam usar o GitHub Models, uma API de inferência gratuita para o Actions. O GitHub o desativou em 30 de julho de 2026 ([documentação do GitHub](https://docs.github.com/en/github-models){target="_blank"}), então o caminho gratuito agora é o Ollama.

### O que custa dinheiro { #costs }

| Item | Custo |
|---|---|
| Ollama na sua máquina | gratuito (energia, ~5 GB de disco) |
| Minutos do GitHub Actions | **gratuitos em repositórios públicos**; num repositório privado contam na cota mensal do seu plano ([cobrança do GitHub](https://docs.github.com/en/billing/concepts/product-billing/github-actions){target="_blank"}) — o caminho do Ollama usa vários minutos de runner por job de IA |
| API do Claude (`LLM_PROVIDER=anthropic`, e o caminho A da parte 3) | **paga** por token; proteja-a com um limite de gasto no workspace. Cada job imprime o seu custo em US$ |
| Um proxy LiteLLM na internet | o que o provedor por trás dele cobrar |

!!! warning "Política do curso para este lab"

    Use a **sua própria** chave ou um modelo local, nunca a de um colega ou de uma empresa. Nunca cole segredos, dados reais de clientes ou dados pessoais em prompts. Todo commit que contém código gerado por IA leva o trailer `AI-assisted: <tool> (<model>)` e todo PR aberto por IA leva o label `ai-generated`.

### 0.2 O cliente compartilhado

Salve os arquivos abaixo nos caminhos dos seus títulos (a pasta `.github/ai/` é nova). Para não copiar vinte arquivos à mão, você também pode tirá-los de [`boxoffice-after-lab-13.zip`](boxoffice-after-lab-13.zip) — o estado do **fim** deste lab — e copiar só o que precisa:

``` { .bash .copy }
curl -fsSL -o /tmp/lab13.zip https://insper.github.io/platform/2027.1/hands-on/13/boxoffice-after-lab-13.zip
unzip -oq /tmp/lab13.zip -d /tmp/lab13      # outside your repository: nothing to clean up in git status
cp -R /tmp/lab13/boxoffice/.github/ai /tmp/lab13/boxoffice/.github/actions .github/
```

``` { .text title=".github/ai/requirements.txt" .copy }
--8<-- "docs/2027.1/hands-on/13/code/.github/ai/requirements.txt"
```

``` { .bash title=".github/ai/ollama-model.sh" .copy }
--8<-- "docs/2027.1/hands-on/13/code/.github/ai/ollama-model.sh"
```

``` { .yaml title=".github/actions/ollama/action.yml" .copy }
--8<-- "docs/2027.1/hands-on/13/code/.github/actions/ollama/action.yml"
```

``` { .python title=".github/ai/llm.py" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/13/code/.github/ai/llm.py"
```

O que observar em `llm.py`:

| Decisão de projeto | Por quê |
|---|---|
| **`system` é estável, `user` carrega os dados da execução** | O prompt de sistema (instruções + convenções) é idêntico em todas as execuções, então pode ser **cacheado**: no Claude, tokens de entrada lidos do cache são cobrados a uma fração do preço normal. O diff, os logs e as métricas mudam a cada execução e vão em `user`. |
| **Saída estruturada + validação por schema** | O Claude restringe a resposta ao JSON schema (`output_config.format`); o caminho compatível com OpenAI (Ollama, LiteLLM) usa o modo JSON e valida com uma tentativa de reparo. De qualquer forma, quem chama recebe um `dict` que pode verificar, nunca texto livre que precise interpretar. |
| **Toda falha vira um `LLMError`** | Uma recusa, uma resposta truncada (`max_tokens`), a falta de chave, um servidor de modelo fora do ar: cada job decide explicitamente o que acontece (em geral: *fail open*, pular a etapa de IA e dizer isso no resumo). |
| **`Usage` com preços** | Todo job imprime tokens e dólares no seu resumo. Não dá para gerenciar um custo que você não vê. Os preços são os de tabela de quando este lab foi escrito — atualize `PRICES` pela página do provedor. Um modelo local mostra `n/a`. |
| **Sem retentativas aqui** | Os SDKs já repetem `429` e `5xx` com backoff; uma segunda camada de retentativas multiplicaria as chamadas durante uma indisponibilidade (a tempestade de retentativas de [Confiabilidade](../../classes/reliability/index.md)). |

**Ponto de verificação.** Rode o teste rápido no fim de `llm.py` (o primeiro `uv run` baixa os pacotes Python, ~10 s):

``` { .bash .copy }
uv run --no-project --python 3.12 --with-requirements .github/ai/requirements.txt python .github/ai/llm.py
```

Você deve ver (a saudação varia; a primeira chamada também carrega o modelo na memória, então demora mais):

```text
provider=ollama model=qwen2.5-coder-16k
{"greeting": "Hello, BoxOffice team!"}
| Model | Calls | Input | Cache read | Cache write | Output | Time | Cost |
|---|---|---|---|---|---|---|---|
| `qwen2.5-coder-16k` | 1 | 81 | 0 | 0 | 15 | 1.9 s | n/a (local or unknown model) |
```

`LLM error: APIConnectionError: Connection error.` significa que o Ollama não está rodando; `NotFoundError ... model 'qwen2.5-coder-16k' not found` significa que o passo 0.1 foi pulado. Veja [Solução de problemas](#troubleshooting).

### 0.3 O contexto: convenções e decisões

O revisor só é tão bom quanto o que ele sabe sobre o **seu** sistema. Um modelo genérico conhece Java; ele não sabe que `order` nunca deve escrever no schema `inventory`. Escreva esse conhecimento uma vez — para humanos, antes de tudo — em `CONVENTIONS.md`, na raiz do repositório:

``` { .markdown title="CONVENTIONS.md" .copy }
--8<-- "docs/2027.1/hands-on/13/code/CONVENTIONS.md"
```

Os registros de decisão de arquitetura (ADRs) em `docs/adr/` também são enviados ao revisor (os primeiros 3.000 caracteres de cada um). Um ADR é uma nota curta sobre uma decisão: contexto, decisão, consequências. Comece pela que o BoxOffice tomou no lab 1:

``` { .markdown title="docs/adr/0001-schema-per-service.md" .copy }
--8<-- "docs/2027.1/hands-on/13/code/docs/adr/0001-schema-per-service.md"
```

### 0.4 Configurações do repositório { #repository-settings }

Uma vez por repositório, a partir da raiz:

``` { .bash .copy }
gh label create ai-generated --color 8250df --description "opened or written by an AI step"
gh label create ai-tests --color 0e8a16 --description "run the AI test generator on this PR"
# Workflow permissions: read-only by default, and allow Actions to open (draft) pull requests
gh api --method PUT "repos/{owner}/{repo}/actions/permissions/workflow" \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true
```

`{owner}/{repo}` é preenchido pelo `gh` a partir do repositório atual. O último comando equivale a **Settings → Actions → General → Workflow permissions**: *Read repository contents* e *Allow GitHub Actions to create and approve pull requests* (o GitHub tem uma só caixa para os dois; nenhum workflow deste lab aprova nada). Confira com `gh api "repos/{owner}/{repo}/actions/permissions/workflow"`:

```json
{"default_workflow_permissions":"read","can_approve_pull_request_reviews":true}
```

## Partes

1. [Review de pull request por IA](review/index.md) — achados estruturados como comentários inline, controle de ruído, custo no resumo do job.
2. [Testes gerados por IA, avaliados por testes de mutação](tests/index.md) — manter um teste gerado só se o PIT disser que ele pega mais bugs.
3. [Um agente que corrige o build quebrado](fix-agent/index.md) — Claude Code headless ou um loop de agente de 150 linhas; um PR em rascunho para um humano.
4. [Release notes por IA](release-notes/index.md) — ancoradas nos commits, publicadas como rascunho.
5. [Um veredito de canary explicado](canary/index.md) — a política decide, o modelo explica.
6. [Endurecimento de segurança](security/index.md) — gatilhos, permissões, segredos, prompt injection e uma avaliação com golden set.
7. [Meça](measure/index.md) — precisão, US$/PR, minutos de CI e tempo até o merge ao longo de uma semana.
8. [Quiz](quiz.md).



## Solução de problemas { #troubleshooting }

Cada parte tem a sua própria lista para os erros específicos; estes podem aparecer em qualquer lugar.

| Sintoma | Causa | Correção |
|---|---|---|
| `AI review skipped` / `LLM error: APIConnectionError: Connection error.` | o Ollama não está rodando (ou `LLM_BASE_URL` aponta para outro lugar) | `curl -s http://localhost:11434/api/version`; inicie-o (`brew services start ollama`, `sudo systemctl start ollama` ou `ollama serve`) |
| `NotFoundError ... model 'qwen2.5-coder-16k' not found` | o modelo de 16k não foi criado | `bash .github/ai/ollama-model.sh`; `ollama list` precisa mostrá-lo |
| Uma chamada local leva minutos, ou a máquina usa swap | RAM livre insuficiente para um modelo 7B com janela de 16k | feche outros programas; numa máquina de 8 GB use o modelo 3B: `OLLAMA_BASE_MODEL=qwen2.5-coder:3b bash .github/ai/ollama-model.sh` (mesmo nome, modelo menor, qualidade menor) |
| `TypeError: Could not resolve authentication method` | `LLM_PROVIDER=anthropic` sem `ANTHROPIC_API_KEY` | exporte a chave, ou `unset LLM_PROVIDER` para voltar ao Ollama |
| `uv: command not found` / `No interpreter found for Python 3.12` | uv ausente (lab 0) | instale o uv (lab 0); `uv python install 3.12` |
| Um workflow nem começa | o arquivo ainda não está no branch padrão (`workflow_run`, labels), ou o Actions está desabilitado | faça merge dos workflows em `main` primeiro; **Settings → Actions → General → Allow all actions** |
| `HTTP 403: Resource not accessible by integration` | falta uma permissão ao job, ou o padrão do repositório é só leitura e o workflow não a declarou | mantenha os blocos `permissions:` dos arquivos destas páginas; rode o passo 0.4 |
| `GitHub Actions is not permitted to create or approve pull requests` | passo 0.4 pulado | rode o comando `gh api --method PUT ...` do passo 0.4 |
| Um job de CI com Ollama estoura o timeout | runner só com CPU, prompt grande (num repositório privado o runner pode ter menos memória) | diffs menores; o modelo 3B (adicione `env: { OLLAMA_BASE_MODEL: "qwen2.5-coder:3b" }` ao passo que usa `./.github/actions/ollama`); ou um provedor pago para esse job |

## Limpeza

``` { .bash .copy }
# stop the AI workflows from running on every PR (re-enable with `gh workflow enable`)
for w in ai-review.yaml ai-tests.yaml ai-fix.yaml ai-release-notes.yaml ai-eval.yaml; do gh workflow disable "$w"; done
# delete the branches the bots opened (their PRs were merged or closed)
git ls-remote --heads origin 'ai-fix/*' 'ai-tests/*' | awk '{print $2}' | sed 's|refs/heads/||' \
  | xargs -r -n1 git push origin --delete
ollama stop qwen2.5-coder-16k          # frees the RAM now; `ollama rm qwen2.5-coder-16k qwen2.5-coder:7b` frees the disk
```

Se você usou o Claude, **revogue a chave de API** no Claude Console (ou mantenha-a com o limite de gasto) e `gh secret delete ANTHROPIC_API_KEY`. Mantenha os arquivos: eles fazem parte do seu repositório e do projeto em equipe.

## Entregável

- [ ] `.github/ai/` com `llm.py`, `diffutil.py`, `review.py`, `gen_tests.py`, `fix_agent.py`, `release_notes.py`, `canary_explain.py`, `eval_review.py`, `metrics.py`, `ollama-model.sh`, `requirements.txt`, o golden set em `evals/` e os snapshots em `canary/`.
- [ ] `CONVENTIONS.md` com pelo menos cinco regras específicas do **seu** BoxOffice, e pelo menos um ADR em `docs/adr/`.
- [ ] Os workflows `ai-review.yaml`, `ai-tests.yaml`, `ai-fix.yaml`, `ai-release-notes.yaml` e `ai-eval.yaml`, cada um com um bloco `permissions:` explícito, passando no `actionlint` (parte 6).
- [ ] Um PR em que o revisor postou comentários inline, com a tabela de custo no resumo do job.
- [ ] Um PR em rascunho aberto pelo gerador de testes com um **score de mutação maior**, ou o resumo do job explicando por que os testes foram rejeitados.
- [ ] Um PR em rascunho aberto pelo agente de correção para um build que você quebrou de propósito (ou a execução local da parte 3), revisado (aprovado ou rejeitado) por você com uma justificativa escrita.
- [ ] Uma release em rascunho com notas geradas por IA para uma tag `v*`.
- [ ] Os três vereditos de canary (saudável, regressão, pouco tráfego) da parte 5.
- [ ] O PR de injection da parte 6 e uma execução do `ai-eval`, com a tabela de avaliação do seu modelo.
- [ ] `results/lab13.md` com a tabela de medições da parte 7 e a sua conclusão: manter, ajustar ou remover cada etapa de IA?
- [ ] Faça a tag do commit: `git tag lab13 && git push --tags`; [quiz](quiz.md) respondido.

**Autoverificação antes de entregar:** `git status` limpo; `gh workflow list` mostra os cinco workflows de IA *active*; `gh run list --limit 20` mostra ao menos uma execução bem-sucedida de `AI review`, `AI tests`, `AI release notes` e `AI reviewer eval`; `git log -p | grep -c 'sk-ant-'` imprime `0` (nenhuma chave do Claude entrou num commit).

## Estado final

``` { .tree title="changed in lab 13" }
boxoffice/
    .github/ai/                       # new: llm.py, diffutil.py, review.py, gen_tests.py, fix_agent.py,
                                      #      release_notes.py, canary_explain.py, eval_review.py, metrics.py,
                                      #      ollama-model.sh, requirements.txt, evals/ (5 cases), canary/ (3 snapshots)
    .github/actions/ollama/action.yml # new: the free model on the runner
    .github/workflows/ai-review.yaml  ai-tests.yaml  ai-fix.yaml  ai-release-notes.yaml  ai-eval.yaml   # new
    CONVENTIONS.md                    # new
    docs/adr/0001-schema-per-service.md                                        # new
    Dockerfile.ai-tools               # new (optional live canary, step 5.4)
    k8s/catalog/analysis-explained.yaml                                        # new (optional, step 5.4)
    services/catalog/pom.xml          # replaced: lab 11 pom + PIT plugin
    services/catalog/src/test/java/boxoffice/catalog/CatalogServiceTest.java   # new
    results/lab13.md
```

Este é o último lab: o mesmo pipeline, as convenções e as medições seguem para o projeto em equipe.

[Comece pela parte 1: review por IA](review/index.md){ .md-button .md-button--primary }
