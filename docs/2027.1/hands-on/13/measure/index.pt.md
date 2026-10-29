Todo lab deste curso termina com uma medição, e esta importa mais do que a maioria: ferramentas de IA são adotadas por **sensação**. Num ensaio clínico randomizado de 2025 feito pela METR, desenvolvedores experientes de código aberto usando ferramentas de IA levaram cerca de **19% mais tempo** para concluir as tarefas — enquanto acreditavam ter sido cerca de **20% mais rápidos**[^1]. Um estudo não encerra a questão para o seu time, mas encerra uma coisa: **você precisa medir**. Esta parte mede o revisor da parte 1 (e as outras etapas) ao longo de uma semana de pull requests reais.

## 7.1 O que medir { #71-what-to-measure }

| Métrica | Definição | Fonte | Direção saudável |
|---|---|---|---|
| **Precisão do review** | 👍 ÷ (👍 + 👎) nos comentários da IA | reações nos comentários de review | alta (≥ 70% é uma barra razoável antes de um portão) |
| **Comentários por PR** | comentários da IA postados ÷ PRs | comentários de review com o marcador de fingerprint | baixa e estável: ruído é um custo |
| **Comentários desatualizados** | comentários da IA cuja linha mudou depois | `line == null` no comentário | um sinal *fraco* de que o comentário foi tratado |
| **Custo por PR** | soma de `usd` no comentário fixo ÷ PRs | as linhas ocultas `ai-cost` | conhecido e limitado |
| **Minutos de CI por PR** | soma das durações dos jobs das execuções do PR | API do Actions | os jobs de IA devem ser uma fração pequena |
| **Tempo até o merge** | `mergedAt − createdAt` | API de PRs | não deve piorar |
| **Recall no golden set** | achados esperados encontrados ÷ esperados | `eval_review.py` (parte 6) | ≥ o limite, por modelo |

A precisão por reações precisa que **as pessoas reajam**. Combine isso com o seu time para esta semana: todo comentário da IA recebe um 👍 (útil: mudei algo ou aprendi algo) ou um 👎 (errado, irrelevante ou óbvio). Comentários sem avaliação são reportados à parte.

## 7.2 O coletor { #72-the-collector }

``` { .python title=".github/ai/metrics.py" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/13/code/.github/ai/metrics.py"
```


Rode-o a partir da raiz do repositório (ele só lê, com o seu login do `gh`; não precisa de modelo):

``` { .bash .copy }
mkdir -p results
uv run --no-project --python 3.12 python .github/ai/metrics.py --days 7 > results/lab13-metrics.md
cat results/lab13-metrics.md
```

Você deve ver uma linha por PR do período e os totais. O formato, de uma execução com `--days 365` num repositório com dois PRs e ainda sem comentários de IA:

```text
## AI reviewer, last 365 days (2 PRs)

| PR | Title | AI comments | 👍 | 👎 | Outdated | US$ | CI min | Hours to merge |
|---|---|---|---|---|---|---|---|---|
| #3 | docs: add git pull --recurse-submodules  | 0 | 0 | 0 | 0 | 0.0000 | 0.0 | 0.0 |
| #4 | feat: gitactions page | 0 | 0 | 0 | 0 | 0.0000 | 0.0 | 0.0 |

- Precision: no rated comments yet
- Comments per PR: 0.0 · rated: 0/0
- AI cost: US$ 0.00 total, US$ 0.000 per PR
- CI minutes: 0 total, 0.0 per PR
- Median time to merge: 0.0 h (2 merged)
```

Com o modelo gratuito, `US$` fica em 0 — o seu custo está na coluna `CI min`. Rode-o no fim da semana, e uma vez no meio para conferir que os comentários estão sendo avaliados.

## 7.3 A semana { #73-the-week }

Você precisa de **pelo menos 10 PRs**. Trabalhe em dupla (ou com o seu time de projeto) e revise os PRs uns dos outros como faria normalmente; o revisor de IA é mais uma voz. **Trabalhando sozinho?** Abra você mesmo os PRs — mudanças pequenas e reais (um teste, um rename, uma linha de log, uma seção do README, uma correção vinda dos próprios comentários do revisor) —, avalie cada comentário da IA com honestidade antes de ler o próximo e diga no relatório que uma pessoa avaliou tudo.

1. Dias 1–2, **linha de base**: `gh variable set AI_REVIEW_MAX_COMMENTS --body 0` (o job roda e custa quase o mesmo, mas não posta nada) ou `gh workflow disable ai-review.yaml`. Abra de 3 a 5 PRs.
2. Dias 3–7, **com review por IA**: `gh variable delete AI_REVIEW_MAX_COMMENTS` (ou `gh workflow enable ai-review.yaml`). Abra os PRs restantes. Reaja a todo comentário da IA com 👍 ou 👎.
3. Durante a semana, coloque o label `ai-tests` em dois PRs, quebre o CI uma vez de propósito para o agente de correção e faça push de uma tag.
4. Rode a avaliação da parte 6 com **pelo menos dois modelos**. De graça: o modelo de 7B que você já tem e um de 3B (mais 1,9 GB):

    ``` { .bash .copy }
    OLLAMA_BASE_MODEL=qwen2.5-coder:3b OLLAMA_MODEL_NAME=qwen2.5-coder-3b-16k bash .github/ai/ollama-model.sh
    for m in qwen2.5-coder-16k qwen2.5-coder-3b-16k; do
      LLM_MODEL=$m uv run --no-project --python 3.12 --with-requirements .github/ai/requirements.txt \
        python .github/ai/eval_review.py .github/ai/evals 2>&1 | tail -n 6
    done
    ```

    Com uma chave do Claude (pago, alguns centavos no total), compare modelos hospedados do mesmo jeito:

    ``` { .bash .copy }
    for m in claude-opus-5-5 claude-sonnet-5-5 claude-haiku-4-5; do
      LLM_PROVIDER=anthropic LLM_MODEL=$m uv run --no-project --python 3.12 --with-requirements .github/ai/requirements.txt \
        python .github/ai/eval_review.py .github/ai/evals 2>&1 | tail -n 6
    done
    ```

    Cada execução termina com a linha de recall e a tabela de custo; copie-as para a tabela de modelos abaixo.

## 7.4 Modelo de resultados { #74-results-template }

Copie para `results/lab13.md` e preencha:

```markdown
## Lab 13 — AI in CI/CD

### Reviewer over one week
| | Baseline (no AI comments) | With AI review |
|---|---|---|
| PRs | | |
| AI comments posted / per PR | — | |
| Rated 👍 / 👎 / unrated | — | |
| Precision 👍/(👍+👎) | — | |
| Outdated (line changed afterwards) | — | |
| Median time to merge (h) | | |
| CI minutes per PR | | |
| AI US$ per PR | | |

### Models on the golden set (part 6)
| Model | Recall | Extra findings | Injections flagged | US$ for 5 cases | Seconds |
|---|---|---|---|---|---|
| | | | | | |

### Other steps
| Step | Runs | Accepted / useful | US$ total | Notes |
|---|---|---|---|---|
| AI tests (PIT gain) | | | | |
| Fix agent (draft PRs merged) | | | | |
| Release notes (items dropped as ungrounded) | | | | |
| Canary explanation (consistent with policy) | | | | |

### Decision
For each step: keep, tune (which knob?), or remove — and why, with the numbers above.
```

## 7.5 Lendo os números { #75-reading-the-numbers }

- **Precisão abaixo de ~50%** — o revisor é ruído; as pessoas vão aprender a ignorá-lo, inclusive quando ele estiver certo. Aumente `AI_REVIEW_MIN_SEVERITY`, diminua `AI_REVIEW_MAX_COMMENTS`, adicione os falsos positivos ao `CONVENTIONS.md` ("usamos `double` para coordenadas de propósito") e ao golden set.
- **Precisão alta, poucos comentários** — candidato ao modo portão para `blocker` + confiança `high`, como check *obrigatório*. Ainda assim, não é uma aprovação.
- **Custo por PR** — multiplique pelo número de PRs do seu time por mês. A, digamos, US$ 0,02 por review e 400 PRs por mês, o revisor custa cerca de US$ 8: menos do que dez minutos do tempo de um engenheiro. O custo de **atenção** de comentários ruins costuma ser maior do que o custo de tokens.
- **Tempo até o merge** — com dez PRs, o ruído é maior do que qualquer efeito. Reporte-o, mas não o interprete demais. A página da aula sobre [entrega assistida por IA](../../../classes/ai-delivery/index.md) discute como métricas no estilo DORA devem ser lidas quando a IA entra no pipeline.

- **O modelo gratuito** — se o recall dele no golden set for bem menor, a vantagem de custo não é real: uma SQL injection que passou não sai mais barata. O modelo local de 7B marcou 50 % de recall e foi enganado pelos dois casos de injection enquanto este lab era escrito (parte 6).
- **Segundos e minutos** dependem do seu hardware: um notebook com GPU ou Apple silicon responde em segundos, um runner só com CPU em minutos. Compare tempos entre as suas próprias execuções, não com os números destas páginas; as contagens (achados, recall, mutantes) é que devem ser comparáveis.

!!! tip "Na entrevista"

    *"Como você saberia se o code review por IA vale a pena?"* — Defina precisão (comentários aceitos ÷ avaliados) e recall num golden set, acompanhe o custo por PR e o tempo até o merge, faça um período de linha de base e decida por etapa, com números. Mencione que a produtividade percebida e a produtividade medida podem divergir, então autoavaliações não bastam.


## Solução de problemas { #troubleshooting }

| Sintoma | Causa | Correção |
|---|---|---|
| `no git remotes found` / `none of the git remotes ... point to a known GitHub host` | não rodou a partir do seu repositório, ou não há remote do GitHub | `cd` para a raiz do repositório; `gh repo set-default` |
| `0 PRs` | nenhum PR criado no período (`--days`) | aumente-o: `--days 14` |
| `HTTP 403: API rate limit exceeded` | muitos PRs × muitas execuções, cada uma uma chamada de API | espere uma hora, ou rode com um `--days` menor |
| `Precision: no rated comments yet` | ninguém reagiu com 👍/👎 | avalie os comentários (as reações ficam em cada comentário inline) e rode de novo |
| `CI min` muito maior que o esperado | o caminho do Ollama instala e baixa o modelo em cada job de IA | esperado no caminho gratuito; compare com um modelo hospedado na sua decisão |

[Voltar à visão geral do lab](../index.md){ .md-button } [Fazer o quiz](../quiz.md){ .md-button .md-button--primary }


[^1]: BECKER, J. et al. [Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/){target="_blank"}. METR, julho de 2025.
