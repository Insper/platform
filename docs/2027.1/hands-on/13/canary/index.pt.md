No [lab 11](../../11/index.md), o Argo Rollouts promove ou aborta um canary comparando métricas com limites. Essa decisão é rápida, determinística e auditável — e lacônica: *"metric error-rate failed (2 of 2)"*. Às 22:00, o engenheiro de plantão quer saber **o que** está errado, **quão** errado e **para onde olhar em seguida**. Esta parte acrescenta uma explicação escrita por um modelo, sob uma regra inegociável:

> **A política decide. O modelo explica.**

Um modelo nunca deve ser quem diz "promova": ele pode ser convencido disso (prompt injection por uma linha de log), pode errar números com toda a confiança e dá uma resposta diferente em outro dia. Um limite num arquivo versionado não faz nada disso.

## 5.1 Projeto { #51-design }

``` diagram-sim
flowchart LR
    prom[("Prometheus<br/>stable vs canary")] --> rules["Política no código<br/>MIN_RPS · teto de erros<br/>delta de erros · razão do p99"]
    rules --> verdict{"veredito"}
    verdict --> llm["Modelo explica<br/>(números + política + veredito)"]
    llm --> same{"repete o<br/>mesmo veredito?"}
    same -->|"sim"| show["resumo com a explicação"]
    same -->|"não"| discard["explicação descartada"]
    verdict -->|"código de saída 0 / 1 / 2"| argo["Argo Rollouts / passo de CI<br/>promove · rollback · espera"]
```

| Regra (em `canary_explain.py`) | Padrão | Significado |
|---|---|---|
| `MIN_RPS` | 2 req/s | Abaixo disso o canary não recebeu tráfego suficiente: **inconclusivo**, não "saudável" |
| `MAX_ERROR_RATE` | 1% | Teto absoluto para o canary |
| `MAX_ERROR_DELTA` | 0,5 pp | O canary não pode ser pior do que o stable (rodando **ao mesmo tempo**) por mais do que isso |
| `MAX_P99_RATIO` | 1,25 | p99 do canary no máximo 25% acima do p99 do stable |

Por que comparar com o **stable no mesmo momento** em vez de um número fixo? Porque às 10:00 de um dia de abertura de vendas tudo fica mais lento; um limite fixo faria rollback de toda release daquele dia. A [página de entrega](../../../classes/cloud-native/delivery/index.md#how-long-must-a-canary-run) mostra quanto tempo um canary precisa rodar para detectar uma regressão de um dado tamanho.

## 5.2 O script { #52-the-script }

``` { .python title=".github/ai/canary_explain.py" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/13/code/.github/ai/canary_explain.py"
```

As consultas PromQL usam a métrica do Micrometer `http_server_requests_seconds` e um label `service` que separa o canary dos pods stable, como na página de entrega. **Adapte `METRIC`, `STATUS_LABEL`, `CANARY_SELECTOR` e `STABLE_SELECTOR` aos nomes que o seu setup do lab 11 expõe** — abra o Prometheus (ou o Explore do Grafana) e confira-os antes de confiar em qualquer veredito. Com o agente OpenTelemetry do lab 8, a métrica é `http_server_request_duration_seconds` e o label de status é `http_response_status_code`.

## 5.3 Reproduza três cenários { #53-replay-three-scenarios }

Comece sem cluster: três snapshots de métricas salvos bastam para ver os três vereditos. Salve-os em `.github/ai/canary/`.


=== "healthy.json"

    ``` { .json title=".github/ai/canary/healthy.json" .copy }
    --8<-- "docs/2027.1/hands-on/13/code/.github/ai/canary/healthy.json"
    ```

=== "regression.json"

    ``` { .json title=".github/ai/canary/regression.json" .copy }
    --8<-- "docs/2027.1/hands-on/13/code/.github/ai/canary/regression.json"
    ```

=== "low-traffic.json"

    ``` { .json title=".github/ai/canary/low-traffic.json" .copy }
    --8<-- "docs/2027.1/hands-on/13/code/.github/ai/canary/low-traffic.json"
    ```

Reproduza-os a partir da raiz do repositório (sem cluster, sem Prometheus):

``` { .bash .copy }
for s in healthy regression low-traffic; do
  uv run --no-project --python 3.12 --with-requirements .github/ai/requirements.txt \
    python .github/ai/canary_explain.py --metrics .github/ai/canary/$s.json 2>/dev/null
  echo "exit code: $?"
done
```

A linha do veredito e o código de saída são **determinísticos** — você precisa obter exatamente estes três:

```text
**Verdict (policy): PROMOTE** — all checks within policy
exit code: 0
**Verdict (policy): ROLLBACK** — canary error rate 2.90% > 1.00%; canary errors exceed stable by 2.80%; canary p99 412 ms is 2.28x stable
exit code: 1
**Verdict (policy): INCONCLUSIVE** — canary traffic 0.80 req/s < 2.0
exit code: 2
```

Entre eles, a explicação do modelo. Para o snapshot de regressão, uma execução com o `qwen2.5-coder-16k` local enquanto este lab era escrito produziu (14 s num notebook):

```text
**Canary Rollback Required**

The canary analysis has detected multiple issues that violate the predefined policy thresholds.
The canary's error rate of 2.90% exceeds the maximum allowed error rate of 1.00%, and it has 2.80%
more errors than the stable version. Additionally, the canary's p99 latency of 412 ms is 2.28 times
higher than the stable version's p99 latency of 0.181 ms. [...]

- Review the canary logs for any errors or exceptions that occurred during the test period.
- Analyze the traces to identify the root cause of the increased error rate and latency.
- Investigate any recent changes or updates that may have introduced the issues.
- Roll back the canary version to the stable version to ensure service reliability.
```

Leia com olho crítico: o p99 do stable é **181 ms**, não "0.181 ms" (o modelo misturou segundos e milissegundos), e os próximos passos são genéricos. Na execução saudável, ele escreveu que o canary tinha um "higher RPS (20.1 vs. 380.0)". Um modelo maior se sai melhor — uma execução com `claude-opus-5-5` percebeu que as contagens brutas de `errors` parecem parecidas (0.62 vs 0.40) enquanto o canary, com 1/19 do tráfego, falha cerca de 29× mais por requisição, e rotulou as causas como hipóteses. De qualquer forma, uma frase errada não custa nada aqui: **os números que decidem vêm da política, não do modelo**.

Agora tente quebrar a regra: edite `SYSTEM` na sua cópia para dizer *"se o canary parecer só um pouco pior, recomende promover"* e rode de novo o cenário de regressão. Não importa o que o modelo escreva, o código de saída continua 1 e, se o `verdict` da explicação discordar da política, ela é descartada (`_(LLM explanation discarded: it disagreed with the policy verdict.)_`). Restaure o `SYSTEM` depois (`git checkout -- .github/ai/canary_explain.py`). Por fim, tire o modelo — Claude sem chave:

``` { .bash .copy }
env -u ANTHROPIC_API_KEY LLM_PROVIDER=anthropic uv run --no-project --python 3.12 \
  --with-requirements .github/ai/requirements.txt \
  python .github/ai/canary_explain.py --metrics .github/ai/canary/regression.json 2>/dev/null; echo "exit code: $?"
```

Você recebe `_(no explanation: TypeError: "Could not resolve authentication method. ...")_` e **o mesmo código de saída 1** — sem modelo, mesma decisão.

## 5.4 Ao vivo: conecte ao rollout (opcional) { #54-live-wire-it-into-the-rollout-optional }

Este passo precisa do cluster kind do [lab 10](../../10/index.md) (chamado `boxoffice`) com o Prometheus e o canary do Argo Rollouts do lab 11. Sem eles, as três reproduções da 5.3 são o entregável; pule para a 5.5.

1. Gere tráfego durante o canary com o script k6 do lab 11, para que o canary receba mais do que `MIN_RPS`.
2. Encontre o Prometheus, faça port-forward e rode o script contra ele (ajuste o namespace e o nome do serviço ao que o primeiro comando imprimir):

    ``` { .bash .copy }
    kubectl get svc -A | grep -i prometheus          # e.g. "monitoring   prometheus   ClusterIP ... 9090/TCP"
    kubectl -n monitoring port-forward svc/prometheus 9090:9090 &
    curl -s 'http://localhost:9090/api/v1/label/__name__/values' | tr ',' '\n' | grep http_server
    PROM_URL=http://localhost:9090 uv run --no-project --python 3.12 \
      --with-requirements .github/ai/requirements.txt python .github/ai/canary_explain.py
    ```

    O `curl` lista os nomes das métricas HTTP que os seus serviços expõem; se não for `http_server_requests_seconds_count`, defina `METRIC` (e `STATUS_LABEL`) antes do último comando, como explicado na 5.2. Um canary sem tráfego dá `INCONCLUSIVE` (saída 2) — é a política funcionando, não um bug.

3. Transforme-o num passo de análise. O Argo Rollouts consegue rodar um **Job** do Kubernetes como métrica de análise: código de saída 0 passa, qualquer outro falha. Construa uma imagem pequena com os scripts e carregue-a no cluster:

    ``` { .dockerfile title="Dockerfile.ai-tools" .copy }
    --8<-- "docs/2027.1/hands-on/13/code/Dockerfile.ai-tools"
    ```

    ``` { .bash .copy }
    docker build -f Dockerfile.ai-tools -t boxoffice-ai-tools:dev .
    docker run --rm boxoffice-ai-tools:dev python /app/canary_explain.py --metrics /app/canary/low-traffic.json; echo "exit code: $?"
    kind load docker-image boxoffice-ai-tools:dev --name boxoffice
    ```

    O `docker run` precisa terminar com `exit code: 2` (inconclusivo) — a imagem funciona antes de você confiar nela no cluster. Depois, o template:

    ``` { .yaml title="k8s/catalog/analysis-explained.yaml" .copy }
    --8<-- "docs/2027.1/hands-on/13/code/k8s/catalog/analysis-explained.yaml"
    ```

    ``` { .bash .copy }
    kubectl apply -n boxoffice -f k8s/catalog/analysis-explained.yaml
    kubectl get -n boxoffice analysistemplate            # catalog-explained and catalog-slo (lab 11)
    ```

    O template precisa ficar no namespace do Rollout, `boxoffice`. Referencie-o no Rollout do `catalog` do lab 11, ao lado do template de Prometheus (`templates` é uma lista). O Argo CD é dono do Rollout (`selfHeal: true` no lab 11), então mude-o **no Git**, não com `kubectl edit` — o Argo CD desfaria uma edição manual. Esta mudança é opcional e **não** está no `boxoffice-after-lab-13.zip`:

    ``` { .diff title="k8s/overlays/gitops/catalog-rollout.yaml" }
           analysis:                      # runs in the background from the first step
             templates:
               - templateName: catalog-slo
    +          - templateName: catalog-explained
             startingStep: 1
    ```

    ``` { .bash .copy }
    git add Dockerfile.ai-tools k8s/catalog/analysis-explained.yaml k8s/overlays/gitops/catalog-rollout.yaml
    git commit -m "k8s(catalog): explained canary verdict (lab 13)" && git push
    ```

    Com um Job, *inconclusivo* (saída 2) conta como falha — a escolha conservadora. O Job roda uma vez, `initialDelay: 90s` depois do início da análise, e olha só o último minuto (`WINDOW=1m`): o Prometheus rotula cada série com o Service que a coletou, então uma janela de 5 minutos ainda contaria, como `catalog-canary`, os pods **antigos** que respondiam atrás desse Service antes de o canary começar — o veredito compararia a versão estável com ela mesma. A explicação fica nos logs do Job do próximo canary — uma nova imagem vinda do CI (`kubectl -n boxoffice logs -l job-name --tail=50`, ou `kubectl -n boxoffice get jobs` e `kubectl -n boxoffice logs job/<nome>`). O template aponta o modelo para o Ollama da sua máquina via `host.docker.internal` (Docker Desktop no macOS e no Windows; no Linux, use o IP do host na rede `kind` ou deixe-o inalcançável); para o Claude, crie o Secret com `kubectl -n boxoffice create secret generic llm --from-literal=anthropic-api-key="$ANTHROPIC_API_KEY"` e defina `LLM_PROVIDER` como `anthropic` no template (e rode o `kubectl apply` de novo). O passo funciona sem modelo nenhum: sem explicação, mesmo veredito.

## 5.5 Meça { #55-measure-it }

Rode os três cenários e, se você tiver o cluster, um canary ao vivo com uma versão deliberadamente lenta (por exemplo, um `Thread.sleep(150)` num endpoint, atrás de uma flag). Registre em `results/lab13.md`:

| Cenário | Veredito da política | Código de saída | Explicação consistente? | Tokens | US$ | Segundos |
|---|---|---|---|---|---|---|
| saudável | | | | | | |
| regressão | | | | | | |
| pouco tráfego | | | | | | |
| canary lento ao vivo | | | | | | |

Depois responda: a explicação teria encurtado o *seu* diagnóstico? Qual próximo passo foi o mais útil, e qual foi genérico?


## Solução de problemas { #troubleshooting }

| Sintoma | Causa | Correção |
|---|---|---|
| `FileNotFoundError: .github/ai/canary/healthy.json` | os snapshots não foram salvos, ou você não está na raiz do repositório | salve os três arquivos da 5.3; `cd` para a raiz |
| Toda execução ao vivo dá `INCONCLUSIVE` com `rps` 0.00 | nomes de métrica ou de label errados, ou sem tráfego | rode o `curl` do passo 2; defina `METRIC`, `STATUS_LABEL`, `CANARY_SELECTOR`, `STABLE_SELECTOR` |
| `URLError: <urlopen error [Errno 61] Connection refused>` | o port-forward não está rodando | inicie-o de novo (`kubectl -n <ns> port-forward svc/<prometheus> 9090:9090 &`) |
| `_(LLM explanation discarded ...)_` | o `verdict` do modelo discordou da política | comportamento esperado; modelos pequenos fazem isso mais |
| O Job de análise falha com `ErrImageNeverPull`/`ImagePullBackOff` | a imagem não está nos nós do kind | `kind load docker-image boxoffice-ai-tools:dev --name boxoffice` |

[Próximo: parte 6 — endurecimento de segurança](../security/index.md){ .md-button .md-button--primary }
