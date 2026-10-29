A primeira etapa de IA é a de melhor relação custo/benefício: um revisor que lê cada pull request **antes** de um humano e deixa alguns comentários inline precisos — ou nada. Revisores humanos são escassos e lentos (um PR muitas vezes espera horas pela primeira olhada); um modelo é rápido, barato por PR e nunca se cansa da centésima verificação de nulo. Ele também erra com frequência, é prolixo e crédulo. Esta parte constrói um revisor que é útil *apesar* dessas fraquezas.

## 1.1 Como funciona { #11-how-it-works }

``` diagram-sim
sequenceDiagram
    autonumber
    actor Dev as Desenvolvedor
    participant GH as GitHub
    participant Job as job ai-review
    participant LLM as Modelo (Claude / LiteLLM / Ollama)
    Dev->>GH: push em um branch de PR
    GH->>Job: pull_request (synchronize)
    Job->>Job: git diff base...head, numera as linhas do lado novo
    Job->>Job: carrega CONVENTIONS.md + ADRs (prompt de sistema em cache)
    Job->>LLM: system + título, corpo e diff do PR (não confiáveis)
    LLM-->>Job: JSON {summary, findings[]}
    Job->>Job: mantém linhas adicionadas, ≥ minor, confiança não baixa, não postados antes, no máximo 6
    Job->>GH: um review com comentários inline (evento COMMENT)
    Job->>GH: atualiza o comentário fixo de resumo (custo por execução)
    Job->>GH: resumo do job: tokens, US$, achados mantidos e descartados
```

Quatro ideias sustentam o projeto; a página [Code review](../../../classes/ai-delivery/code-review/index.md) da aula as explica em profundidade:

1. **Engenharia de contexto.** O modelo recebe o diff *e* o que um engenheiro sênior do BoxOffice sabe: as convenções e os ADRs. Sem eles, ele só consegue dar conselhos genéricos.
2. **Saída estruturada.** A resposta é um JSON com `file`, `line`, `severity`, `category`, `confidence`, `title`, `explanation`, `suggestion` — assim o código consegue filtrá-la, deduplicá-la e postá-la exatamente onde ela pertence.
3. **Controle de ruído.** Cada comentário custa a atenção de um desenvolvedor. Comentários fora das linhas alteradas, abaixo de `minor`, com confiança baixa, já postados ou acima do limite são **descartados** (e listados no resumo do job, para que você possa ajustar os limites).
4. **Consultivo, não um portão.** O bot posta `event: COMMENT` — nunca `APPROVE` nem `REQUEST_CHANGES`. Existe um modo de portão opcional, mas você só o liga depois de medir a precisão na parte 7.

## 1.2 Os utilitários de diff { #12-the-diff-helpers }

Modelos são ruins em contar linhas. Em vez de pedir ao modelo que calcule números de linha a partir dos cabeçalhos `@@ -16,4 +16,9 @@`, o `diffutil.py` imprime **cada linha do lado novo com o seu número** (`L21 + ...`) e depois verifica que cada achado aponta para uma linha que o PR realmente **adicionou**. O GitHub rejeita um comentário de review numa linha que não faz parte do diff, então essa verificação também evita uma chamada de API com falha.

``` { .python title=".github/ai/diffutil.py" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/13/code/.github/ai/diffutil.py"
```

Isto é o que o modelo vê para um PR pequeno — repare que as linhas removidas não têm número e que só as linhas `+` podem receber um comentário:

```text
### services/catalog/src/main/java/boxoffice/catalog/EventRepository.java
@@ -16,4 +16,9 @@ public class EventRepository {
L16        public List<Event> findAll() {
L17            return jdbc.query("select id, name, starts_at from catalog.event", Event.MAPPER);
L18        }
L19   +
L20   +     public List<Event> search(String text) {
L21   +         return jdbc.query("select id, name, starts_at from catalog.event where name ilike '%"
L22   +                 + text + "%'", Event.MAPPER);
L23   +     }
L24      }
```

## 1.3 O revisor { #13-the-reviewer }

``` { .python title=".github/ai/review.py" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/13/code/.github/ai/review.py"
```

Leia o código com estas perguntas em mente:

| Onde | O que faz | Por quê |
|---|---|---|
| `INSTRUCTIONS` | Diz o que procurar, o que **não** comentar e que uma lista vazia é um bom review | Sem "nada de elogios, nada de detalhes irrelevantes", um modelo enche a página; a permissão para a lista vazia é o maior redutor de ruído |
| Tags `<untrusted_…>` | Envolvem título, descrição e diff | Marcam o texto escrito pelo autor como **dados** e pedem ao modelo que reporte texto dirigido a ele como possível prompt injection (parte 6) |
| Filtros de `review()` | Linhas adicionadas · severidade mínima · sem confiança baixa · máximo de comentários | Precisão acima de recall: um comentário ignorado ensina as pessoas a ignorar o bot |
| `fingerprint()` | Hash de arquivo + categoria + título normalizado, escondido no comentário | O próximo push não posta de novo o mesmo achado |
| `post()` | Um review com todos os comentários inline + um comentário de resumo **fixo**, editado no lugar | Uma notificação por push em vez de dez; o comentário fixo guarda o custo de cada execução para a parte 7 |
| `except LLMError` | Escreve o erro no resumo e sai com 0 | **Fail open**: uma indisponibilidade do provedor do modelo não pode bloquear todos os merges |
| `GATE` | Sai com 1 num blocker de confiança alta se `AI_REVIEW_GATE=true` | O portão existe, mas fica desligado por padrão |


## 1.4 O workflow { #14-the-workflow }

``` { .yaml title=".github/workflows/ai-review.yaml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/13/code/.github/workflows/ai-review.yaml"
```

| Linha | Por quê |
|---|---|
| `permissions:` | `contents: read` para o checkout, `pull-requests: write` para comentar. Nada mais: nada de `actions`, `packages` ou `id-token` |
| `concurrency` com `cancel-in-progress` | Três pushes rápidos → um review do último, não três reviews e três contas |
| `if: !draft && head.repo == repository` | Rascunhos não estão prontos; PRs de forks em `pull_request` não recebem segredos de qualquer forma (parte 6) |
| `timeout-minutes` por expressão | Um modelo local num runner só com CPU ganha 25 minutos; um modelo hospedado, 10. Uma chamada travada não queima uma hora |
| `persist-credentials: false` | O token não fica em `.git/config` para os passos seguintes encontrarem |
| Actions fixadas por SHA de commit | Uma tag movida não troca o código que você executa (parte 6) |
| `uses: ./.github/actions/ollama` | Só quando `LLM_PROVIDER` é `ollama` (ou não está definido): instala o modelo gratuito no runner |
| `vars.*` com padrões | Troque provedor, modelo ou limites com uma variável de repositório, sem mudar código |
| Título e corpo do PR lidos do arquivo do evento | Nunca use `${{ github.event.pull_request.title }}` dentro de `run:` — isso é uma injeção de shell (parte 6) |

Faça commit de tudo da parte 0 e deste workflow **na `main`** e dê push — um workflow de `pull_request` roda a partir do merge do seu PR na `main`, então ele precisa estar lá antes:

``` { .bash .copy }
git switch main
git add .github/ai .github/actions .github/workflows/ai-review.yaml CONVENTIONS.md docs/adr
git commit -m "ci(ai): AI pull-request reviewer (lab 13)"
git push
```

## 1.5 Experimente: localmente primeiro, depois num pull request { #15-try-it-locally-first-then-on-a-pull-request }

Crie um branch com um problema **proposital** — uma busca que monta SQL concatenando a entrada do usuário (uma SQL injection, proibida pelo `CONVENTIONS.md`). Ele compila e os testes passam, então só um review pega:

``` { .bash .copy }
git switch -c try-ai-review
```

``` { .java title="services/catalog/src/main/java/boxoffice/catalog/EventSearch.java" .copy }
package boxoffice.catalog;

import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Search events by title. Lab 13: this file has a DELIBERATE bug for the AI reviewer. */
@Repository
public class EventSearch {

    private final JdbcClient jdbc;

    public EventSearch(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public List<String> titlesLike(String text) {
        return jdbc.sql("select title from catalog.events where title ilike '%" + text + "%'")
                .query(String.class)
                .list();
    }
}
```

Faça commit e rode o revisor **na sua máquina** contra o diff do branch, sem postar nada (`--dry-run`). O relatório vai para o terminal:

``` { .bash .copy }
git add services/catalog/src/main/java/boxoffice/catalog/EventSearch.java
git commit -m "catalog: search events by title"
git diff main...try-ai-review > /tmp/pr.diff
uv run --no-project --python 3.12 --with-requirements .github/ai/requirements.txt \
  python .github/ai/review.py --diff /tmp/pr.diff --title "catalog: search events by title" --dry-run
```

Você deve ver algo assim (uma execução com o `qwen2.5-coder-16k` local num notebook; o texto, a linha e o tempo variam de uma execução para outra):

```text
### AI review

The pull request introduces a SQL query that is vulnerable to SQL injection.

| Model | Calls | Input | Cache read | Cache write | Output | Time | Cost |
|---|---|---|---|---|---|---|---|
| `qwen2.5-coder-16k` | 1 | 1,479 | 0 | 0 | 179 | 10.7 s | n/a (local or unknown model) |


Findings: 1 kept, 1 new, 0 dropped.

| Severity | Confidence | Where | Title |
|---|---|---|---|
| blocker | high | `services/catalog/src/main/java/boxoffice/catalog/EventSearch.java:18` | SQL Injection Vulnerability |
```

O que importa: **um** achado, numa linha **adicionada** de `EventSearch.java`, categoria `security`, severidade `major` ou `blocker`. Com o Claude, a coluna de custo mostra US$ em vez de `n/a`.

Agora para valer — faça push do branch e abra o PR:

``` { .bash .copy }
git push -u origin try-ai-review
gh pr create --fill --base main
gh pr checks --watch              # waits for "AI review" (5-15 min on the free runner model)
```

## 1.6 O que você deve ver { #16-what-you-should-see }

No PR, quando o check `AI review` terminar (cerca de um minuto com o Claude; 5–15 minutos com o modelo gratuito no runner, a maior parte instalando o Ollama e baixando o modelo): **um review** com comentários inline nas linhas exatas e **um comentário fixo** `AI review summary` com o custo de cada execução. Um comentário inline tem esta forma (o texto que o modelo local escreveu na execução acima):

```text
🛑 SQL Injection Vulnerability · `blocker` · security · confidence high

The SQL query uses string concatenation to include user input (`text`) in the query, which makes
it vulnerable to SQL injection attacks.

Suggestion: Use parameterized queries to prevent SQL injection. Replace the line with:
`return jdbc.sql("select title from catalog.events where title ilike ?") .bind(0, text) .query(String.class) .list();`

AI review: react 👍 if useful, 👎 if not. Advisory only.
```

Problema certo, linha certa — e uma sugestão que **não compila**: o `JdbcClient` não tem método `bind` (é `.param(...)`), e os curingas `%` sumiram. A sugestão de um revisor é uma dica para um humano, nunca um patch para aplicar às cegas.

Confira também pelo terminal: `gh pr view --comments` mostra o comentário fixo, e `gh api "repos/{owner}/{repo}/pulls/$(gh pr view --json number -q .number)/comments" --jq '.[].path'` lista os arquivos que receberam comentários inline.

No **resumo do job** (Actions → a execução → Summary), o mesmo relatório da execução local: a tabela de achados, os descartados e a tabela de custo. Com o modelo local a coluna de custo diz `n/a`: você paga em minutos de runner. Para comparar, uma execução do golden set de cinco casos da parte 6 com `claude-opus-5-5`, feita enquanto este lab era escrito, custou cerca de **US$ 0,012 por review**, com a maior parte do prompt de sistema servida do cache depois da primeira chamada — os seus números vão variar com o tamanho dos seus diffs e das suas convenções:

| Modelo | Chamadas | Entrada | Leitura do cache | Escrita no cache | Saída | Tempo | Custo |
|---|---|---|---|---|---|---|---|
| `claude-opus-5-5` | 5 | 1.909 | 6.444 | 1.611 | 2.067 | 35,0 s | US$ 0,0583 |

Faça push de um segundo commit que não mexe no problema:

``` { .bash .copy }
git commit --allow-empty -m "chore: run the reviewer again" && git push
```

O revisor roda de novo, encontra o mesmo problema, reconhece o fingerprint e **não posta nada novo** — só o comentário fixo ganha uma linha de custo (`Runs on this PR: 2`). Um modelo local pequeno pode redigir o título de outro jeito a cada execução; aí o fingerprint muda e o comentário é postado duas vezes — mais um motivo para medir o ruído na parte 7.

Mantenha este PR aberto: a parte 7 conta com ele. Não faça merge de `EventSearch.java` — feche o PR quando terminar o lab.

## 1.7 Ajuste { #17-tune-it }

Mude um botão por vez, no mesmo PR, e compare os resumos dos jobs:

| Botão | Onde | Efeito a observar |
|---|---|---|
| `AI_REVIEW_MIN_SEVERITY` (`minor`) | variável de repositório | `major` → menos comentários, e mais importantes |
| `AI_REVIEW_MAX_COMMENTS` (`6`) | variável de repositório | Teto rígido de ruído por push |
| `AI_REVIEW_MAX_DIFF_LINES` (`1500`) | variável de repositório | PRs grandes: arquivos acima do orçamento são listados como *não revisados* — honesto, não truncado em silêncio |
| `LLM_MODEL` | variável de repositório | Qualidade vs. custo: compare na parte 7 |
| `CONVENTIONS.md` | repositório | Adicione uma regra, abra um PR que a viole e veja-a citada |
| `AI_REVIEW_GATE=true` | variável de repositório | O job falha num blocker de confiança alta. Torne-o um check obrigatório **só** depois que a parte 7 mostrar precisão alta |

!!! warning "Armadilhas comuns"

    - **Revisar tudo, inclusive arquivos gerados e lockfiles**: tokens e ruído à toa. `diffutil.SKIP` e `paths-ignore` existem para isso.
    - **Postar cada achado como um comentário separado na issue**: dez notificações por push. Um review com comentários inline, um resumo fixo.
    - **Tratar silêncio como aprovação**: "o bot não encontrou nada" significa *o bot não encontrou nada*. O review humano continua obrigatório pela proteção de branch.
    - **Colocar as convenções no arquivo do workflow**: elas pertencem ao repositório, versionadas, revisadas e lidas também por humanos.


## Solução de problemas { #troubleshooting }

| Sintoma | Causa | Correção |
|---|---|---|
| Nenhum check `AI review` no PR | o PR é rascunho, vem de um fork ou só muda `*.md`/`docs/**` (`paths-ignore`); ou o workflow não está na `main` | `gh pr ready`; faça push do branch no seu repositório, não num fork; faça commit do workflow na `main` antes (passo 1.4) |
| O resumo do job diz `AI review skipped` | a chamada ao modelo falhou (sem chave, Ollama fora do ar, timeout) — o job **falha aberto** de propósito | leia a linha do erro; confira as variáveis com `gh variable list` e os segredos com `gh secret list` |
| `HTTP 422 ... pull_request_review_thread.line ... could not be resolved` | o PR mudou enquanto o job rodava, então a linha não está mais no diff | rode o job de novo (`gh run rerun <id>`), ou faça push de novo |
| Todos os achados descartados como `not an added line` | o modelo devolveu números de linha que não são linhas `+` (modelos pequenos fazem mais isso) | é o controle de ruído; se acontecer em todo PR, teste um modelo maior e compare na parte 7 |
| O mesmo comentário é postado a cada push | o modelo redige o título de outro jeito, então o fingerprint muda | um modelo melhor, ou ajuste o fingerprint para usar `arquivo + linha + categoria` |
| Execução local: `fatal: ambiguous argument 'main...try-ai-review'` | o seu branch padrão tem outro nome, ou o branch não tem commit | `git branch` mostra os nomes; faça commit de `EventSearch.java` antes |

[Próximo: parte 2 — testes por IA](../tests/index.md){ .md-button .md-button--primary }
