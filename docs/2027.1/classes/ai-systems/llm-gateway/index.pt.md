Seis meses depois do lançamento do assistente, a BoxOffice tem cinco funcionalidades que chamam modelos: o assistente de atendimento, um resumidor de avaliações, um tradutor de descrições de eventos, um classificador de sinais de fraude e o job noturno que gera os embeddings do catálogo. Cada time escolheu o próprio provedor, escreveu o próprio loop de retentativas e colou uma chave de API na própria configuração. Então três coisas aconteceram na mesma semana: um provedor ficou fora do ar por duas horas e três funcionalidades caíram junto; o tradutor, preso num loop de retentativas, queimou o orçamento de um mês em uma noite; e ninguém conseguiu responder à pergunta do CFO: *"quanto custa o assistente por conversa?"*.

A solução é a mesma que a disciplina aplicou ao tráfego HTTP em [Tráfego e borda](../../edge/api-gateway/index.md): colocar **um gateway** na frente de todos os modelos e mover para ele as preocupações transversais.

``` diagram-sim
flowchart LR
    subgraph Before["Antes: todo serviço fala com todo provedor"]
        a1["assistant"] --> p1["provedor A"]
        a2["resumidor"] --> p1
        a2 --> p2["provedor B"]
        a3["tradutor"] --> p2
        a4["job de embeddings"] --> p3["auto-hospedado"]
    end
    subgraph After["Depois: um gateway de LLM"]
        b1["assistant"] --> gw["LLM Gateway"]
        b2["resumidor"] --> gw
        b3["tradutor"] --> gw
        b4["job de embeddings"] --> gw
        gw --> q1["provedor A"]
        gw --> q2["provedor B"]
        gw --> q3["auto-hospedado"]
    end
```

## O que o gateway faz { #what-the-gateway-does }

Um **gateway de LLM** (LLM Gateway) é um proxy reverso especializado em APIs de modelos. Os clientes enviam requisições num formato único para um **alias de modelo** (`assistant-default`, não o nome do modelo de um fornecedor); o gateway decide qual implantação (deployment) real atende a requisição e registra o que aconteceu.

| Responsabilidade | O que significa | Equivalente clássico |
|---|---|---|
| **API unificada** | um único formato de requisição/resposta para todos os provedores; os clientes não importam SDKs de fornecedores | adapter / camada anticorrupção |
| **Credenciais** | as chaves dos provedores ficam só no gateway (cofre de segredos); os clientes se autenticam com a própria identidade de serviço | API gateway + gestão de segredos |
| **Roteamento** | alias → modelo e implantação, por funcionalidade, dificuldade, custo, latência ou residência de dados | roteamento L7 |
| **Fallbacks e retentativas** | em caso de `429`, `5xx` ou primeiro token lento, tenta de novo com backoff ou passa para a próxima implantação | retry + circuit breaker |
| **Cotas e orçamentos** | requisições e **tokens** por minuto por usuário, time e funcionalidade; orçamentos mensais em dinheiro | rate limiter |
| **Cache** | caches de resposta por correspondência exata e semânticos; requisições amigáveis ao cache de prompt | cache |
| **Observabilidade** | um span de trace por chamada com modelo, tokens, custo, TTFT; painéis por funcionalidade | access log + métricas |
| **Ganchos de política** | chama o [Safety Mesh](../safety-evals/index.md) antes e depois do modelo (mascaramento, filtros) | WAF / filtros |

O gateway está no caminho crítico de toda funcionalidade de IA, então ele próprio precisa ser **sem estado, escalado horizontalmente e altamente disponível** — os contadores de cota e os caches ficam no Redis, exatamente como num API gateway com limite de taxa ([Borda](../../edge/api-gateway/index.md)).

---

## Roteamento { #routing }

O mesmo prompt pode ser atendido por modelos que diferem em uma ordem de grandeza em preço e velocidade. O **roteamento** escolhe, por requisição, a implantação mais barata que seja boa o suficiente.

| Estratégia | Como decide | Bom para | Cuidado com |
|---|---|---|---|
| **Estática, por funcionalidade** | o alias aponta para um único modelo (`translator` → modelo pequeno) | a maioria das funcionalidades; simples e previsível | pagar caro demais por requisições fáceis |
| **Por tarefa** | uma regra ou um classificador pequeno rotula a requisição (FAQ, reserva, reclamação) e escolhe um modelo | assistentes com tráfego misto | o classificador é mais um modelo para avaliar |
| **Cascata** | tenta primeiro o modelo pequeno; escala quando a resposta falha na validação ou numa verificação de confiança[^1] | alto volume, requisições majoritariamente fáceis | latência no pior caso = pequeno + grande |
| **Roteador aprendido** | um modelo treinado com dados de preferência prevê se o modelo pequeno basta[^2] | volume muito alto | exige dados de treino e monitoramento |
| **Ciente de latência/custo** | envia para a implantação com o menor TTFT ou preço no momento | múltiplos provedores, múltiplas regiões | oscilação; mantenha alguma aderência (stickiness) |
| **Conformidade** | dados pessoais ficam em implantações de uma região aprovada, ou auto-hospedadas | LGPD, restrições contratuais | menos fallbacks disponíveis |

``` diagram-sim
flowchart TD
    req["requisição: alias assistant-default"] --> pii{"contém dados pessoais?"}
    pii -- sim --> region["só implantações em região aprovada"]
    pii -- não --> all["todas as implantações"]
    region --> task{"classe da tarefa"}
    all --> task
    task -- "FAQ / conversa trivial" --> small["modelo pequeno"]
    task -- "reserva com ferramentas" --> large["modelo grande"]
    small --> check{"resposta válida?"}
    check -- não --> large
    check -- sim --> done(["responder"])
    large --> done
```

**Aliases desacoplam as aplicações dos nomes dos modelos.** Quando surge uma nova versão de modelo, o time de plataforma aponta `assistant-default` para ela em 5% do tráfego (um **canary**, como em [Entrega cloud-native](../../cloud-native/delivery/index.md)), compara as métricas online e as avaliações offline e então avança ou reverte — sem nenhuma mudança no código do assistente. **Fixe as versões dos modelos** atrás do alias: um provedor que atualiza "latest" silenciosamente é um deploy não testado.

---

## Fallbacks e retentativas { #fallbacks-and-retries }

Uma chamada ao modelo **não tem efeitos colaterais**: repeti-la é sempre *seguro* (chamadas de ferramenta são outra história — veja [Agentes e ferramentas](../agents/index.md#side-effects)). Mas nem todo erro merece uma retentativa, e alguns merecem outro modelo.

| Erro | Significado | Ação do gateway |
|---|---|---|
| `429` limite de taxa | sua cota naquela implantação acabou | respeitar o `Retry-After` se for curto; senão, fazer **fallback** para outra implantação |
| `5xx`, "overloaded" | falha do lado do provedor | tentar de novo com backoff exponencial + jitter, depois fazer fallback; contar no **circuit breaker** |
| Nenhum primeiro token dentro do prazo de TTFT | fila ou região sobrecarregada | cancelar e fazer fallback (ou **hedge**: enviar uma segunda requisição depois do TTFT p95 e ficar com a que responder primeiro) |
| Stream interrompido depois de tokens enviados | conexão perdida no meio da resposta | não dá para repetir de forma transparente — o usuário já viu parte; repetir a resposta inteira e avisar o cliente para substituí-la |
| `400` contexto longo demais | o prompt não cabe | **não** repetir na mesma implantação; cortar o histórico ou rotear para um modelo de contexto longo |
| Recusa / filtro de conteúdo | o modelo ou o provedor recusou | **não** fazer fallback para um modelo "menos rígido"; devolver a resposta padrão da política |
| JSON / schema inválido | a saída não seguiu o formato pedido | uma tentativa de reparo com o erro de validação, depois falhar; prefira decodificação restrita (structured outputs) |

Um esboço simplificado e independente de provedor da cadeia de fallback, combinando os padrões de retry e circuit breaker de [Confiabilidade](../../reliability/patterns/index.md):

``` python title="router.py"
import random
import time

CHAIN = {  # model alias -> ordered list of deployments
    "assistant-default": ["large@provider-a", "large@provider-b", "medium@self-hosted"],
    "assistant-cheap": ["small@self-hosted", "small@provider-a"],
}
RETRYABLE = {429, 500, 502, 503, 504}


def complete(alias, request, clients, breakers, ttft_deadline_s=3.0):
    """clients and breakers are this sketch's own interfaces, not a real SDK."""
    last_error = None
    for deployment in CHAIN[alias]:
        if breakers[deployment].is_open():
            continue  # known to be failing: skip it without waiting
        for attempt in range(2):
            try:
                reply = clients[deployment].chat(request, first_token_timeout=ttft_deadline_s)
                breakers[deployment].record_success()
                return reply
            except ProviderError as error:
                breakers[deployment].record_failure()
                last_error = error
                if error.status not in RETRYABLE:
                    raise  # 400, context too long, refusal: another try will not help
                if error.status == 429 and not error.retry_after:
                    break  # quota gone here: go straight to the next deployment
                wait = error.retry_after or 0.2 * 2**attempt
                time.sleep(wait + random.uniform(0, wait))  # backoff with jitter
    raise AllDeploymentsFailed(alias) from last_error
```

Duas armadilhas específicas de modelos:

- **Um modelo de fallback é outro programa.** Prompts ajustados para um modelo, seu formato de chamada de ferramenta e seu estilo de recusa podem não se transferir. Rode a [suíte de avaliação](../safety-evals/index.md#evaluation) contra todos os modelos da cadeia, não só o principal — senão o fallback derruba a qualidade em silêncio justamente durante um incidente.
- **Retentativas multiplicam o gasto de tokens.** A [tempestade de retentativas](../../reliability/patterns/index.md) da aula de confiabilidade agora tem preço: limite as tentativas, use um orçamento de retentativas (por exemplo, retentativas ≤ 10% das chamadas) e desconte os tokens repetidos da cota de quem chamou.

!!! example "No código do BoxOffice: o gateway do assistente (lab 12)"

    O [Hands-on 12 — O serviço e o LLM gateway](../../../hands-on/12/service/index.md) usa o `Router` do LiteLLM, dentro do processo, como gateway. O assistente pede uma **rota** (um alias), nunca o nome de um modelo: `local`, um modelo aberto pequeno no Ollama, sempre existe; `claude` só existe quando há uma chave de API. O fallback `claude → local` mantém o assistente respondendo quando o provedor falha ou a cota acaba — e é a primeira armadilha acima na prática: o fallback é um modelo muito menor, então as avaliações precisam rodar contra ele também. Uma retentativa e timeout de 120 s, porque uma chamada a LLM é a dependência mais lenta que a BoxOffice tem. Um serviço só não precisa do proxy separado do LiteLLM; com vários serviços de IA, o proxy vira o gateway compartilhado desta página. O lab estima uma pergunta em cerca de 1.000 tokens de entrada e 100 de saída, ≈ US$ 0,006 na rota do Claude.

    ``` { .python title="services/assistant/app/llm.py" }
    --8<-- "docs/2027.1/hands-on/12/code/services/assistant/app/llm.py"
    ```

!!! tip "Experimente"

    Carregue o cenário do assistente de IA com o perfil **spike** e o caos em **medium**. Observe o LLM Gateway quando o provedor limita e falha: sem fallback, a maioria das perguntas termina em erro. Selecione o LLM Gateway e ligue **Modelo reserva**: a taxa de erro cai pela metade ou mais, mas o custo por mês mais que dobra e o p99 cresce vários segundos — o modelo reserva responde o que a cota rejeitou, mais devagar. Compare a taxa de tokens que o gateway reporta com o limite do provedor. Abra no [playground completo](../../../../playground/index.md) para combinar o fallback com menos passos do agente e um cache semântico.

<div class="sdp" data-scenario="ai-assistant" data-mode="compact" data-height="520" data-profile="spike" data-chaos="medium"></div>

---

## Cotas e orçamentos de tokens { #quotas }

Os limites dos provedores são expressos em **requisições por minuto (RPM)**, **tokens por minuto (TPM)** — às vezes entrada e saída separadamente — e requisições simultâneas, por conta e por região. Uma única funcionalidade com bug pode esgotar o TPM da conta e derrubar todas as outras junto: o problema do **vizinho barulhento** (noisy neighbor), agora com fatura. A OWASP o lista como *consumo ilimitado* (unbounded consumption)[^3]; há quem o chame de *denial of wallet*.

O gateway impõe os próprios limites, mais finos:

| Escopo | Limite de exemplo (BoxOffice) | Por quê |
|---|---|---|
| Por usuário | 20 requisições e 60.000 tokens por hora | conter abuso e loops descontrolados vindos de uma conta |
| Por funcionalidade | assistente ≤ 60% do TPM da conta; jobs noturnos ≤ 20% | proteger o tráfego interativo dos jobs em lote |
| Por requisição | `max_tokens` ≤ 600 tokens de saída; ≤ 8 chamadas ao modelo por tarefa | limitar o pior caso de uma única requisição |
| Por mês | orçamento em US$ por funcionalidade, com alertas em 50/80/100% | o financeiro consegue planejar; sem surpresas |

**Contar tokens antes de conhecê-los.** Um token bucket conta tokens em vez de requisições, mas os tokens de saída só são conhecidos *depois* da chamada. A abordagem usual é **reservar e depois conciliar**: antes da chamada, conte os tokens de entrada com o tokenizador do modelo e reserve `input + max_tokens` do bucket; depois da chamada, devolva a parte não usada. Mantenha os contadores no Redis com scripts atômicos, como no projeto do rate limiter de [Borda](../../edge/api-gateway/index.md).

**O que acontece quando um orçamento acaba** é uma decisão de produto, tomada com antecedência:

1. **Degradar**: rotear para um modelo menor ou responder a partir do cache/FAQ.
2. **Enfileirar**: trabalho em segundo plano (resumos, embeddings) espera a próxima janela — o padrão de [fila assíncrona](../../messaging/queues-pubsub/index.md).
3. **Descartar**: devolver `429` com `Retry-After` e uma mensagem amigável; o tráfego interativo tem **prioridade** sobre o de lote, e os fluxos de pagamento sobre a navegação.

!!! example "BoxOffice às 10:00"

    A venda relâmpago deixa o tráfego do assistente 50× acima do normal por 15 minutos. O gateway reserva 70% do TPM da conta para o alias `assistant` com prioridade *interativa*, pausa o job noturno de embeddings (prioridade *lote*), roteia as perguntas classificadas como FAQ para o modelo pequeno e para o cache semântico, e limita cada fã a 5 requisições ao assistente por minuto. Quando 90% do TPM reservado está em uso, as novas conversas recebem um link para a página estática de FAQ em vez de uma resposta do modelo: a venda continua; o assistente degrada.

---

## Cache: três coisas diferentes { #caching }

"Fazer cache do LLM" significa três mecanismos diferentes, com riscos muito diferentes.

| | Cache de resposta por correspondência exata | **Cache de prompt** (cache de prefixo) | **Cache semântico** |
|---|---|---|---|
| Chave | hash da requisição completa (modelo, prompt, parâmetros) | o maior **prefixo idêntico** do prompt | **embedding** da pergunta do usuário; acerto se a similaridade ≥ limiar |
| O que é reaproveitado | a resposta final | o estado interno do modelo para o prefixo (o KV cache) | uma resposta guardada para uma pergunta *parecida* |
| Onde fica | gateway (Redis) | dentro do servidor do modelo / provedor | gateway (Redis ou um índice vetorial) |
| Economiza | a chamada inteira | custo dos tokens de entrada (tokens em cache cobrados com desconto) e TTFT | a chamada inteira |
| Risco de corretude | nenhum (mesma entrada) | **nenhum** — a resposta é calculada normalmente | **falsos acertos**: uma pergunta parecida que precisa de outra resposta |
| Taxa de acerto num chat | baixa (perguntas raramente se repetem byte a byte) | alta (system prompt + ferramentas + histórico se repetem a cada chamada) | média para tráfego tipo FAQ; ~0 para requisições pessoais, que usam ferramentas |

### Cache de prompt { #prompt-caching }

Processar a entrada (o *prefill*, abaixo) produz tensores internos de chave/valor para cada token. Quando a próxima requisição começa com os **mesmos tokens**, o servidor pode reaproveitá-los em vez de recalcular. A maioria dos grandes provedores e dos servidores open source (por exemplo, o automatic prefix caching do vLLM) oferece isso; os provedores cobram os tokens de entrada em cache por uma fração do preço normal, exigem um tamanho mínimo de prefixo e mantêm as entradas por alguns minutos de inatividade. Os detalhes — automático ou com marcadores explícitos de cache, desconto, tempo de vida — variam por provedor: leia a documentação de cada um.

Como a correspondência é por **prefixo exato**, a ordem do prompt importa:

``` diagram
flowchart LR
    s["1. system prompt<br/>(estático)"] --> t["2. definições de ferramentas<br/>(estáticas)"] --> k["3. documentos recuperados<br/>(por conversa)"] --> h["4. histórico da conversa<br/>(cresce)"] --> u["5. nova mensagem do usuário<br/>(muda a cada chamada)"]
```

!!! warning "Destruidores de cache"

    Um timestamp, um ID de requisição ou o nome do usuário no **topo** do system prompt muda o prefixo a cada chamada e derruba silenciosamente a taxa de acerto a zero. O mesmo acontece ao reordenar as definições de ferramentas ou ao reserializar JSON com ordem de chaves instável. Coloque tudo o que varia **no final** e monitore a proporção de tokens em cache por funcionalidade.

### Cache semântico { #semantic-caching }

Um cache semântico gera o embedding da pergunta do usuário (veja [RAG e memória](../rag-memory/index.md#embeddings)) e procura uma pergunta anterior cujo embedding esteja próximo o suficiente. "Que horas abrem os portões da Arena Paulista?" e "quando abrem as portas da Arena Paulista?" devem dar acerto. O perigo é o caso inverso: *"posso ter reembolso do show de sábado?"* e *"posso ter reembolso do show de domingo?"* são quase idênticas como vetores e podem precisar de respostas diferentes.

Regras que mantêm um cache semântico seguro:

- **Delimite a chave**: tenant, idioma, ID do evento ou do local e versão da política fazem parte da chave, não só o vetor.
- **Só para respostas genéricas**: nunca guarde em cache respostas que usaram ferramentas, dados pessoais ou as permissões do usuário.
- **Ajuste o limiar com dados**: rotule uma amostra de pares (pergunta, pergunta em cache) como iguais/diferentes e escolha o limiar de similaridade para a precisão de que você precisa; taxa de acerto conquistada com respostas erradas é bug.
- **TTL curto e invalidação** quando o documento de origem muda (o mesmo problema de [Cache](../../caching/invalidation/index.md)).

---

## Desempenho de inferência: TTFT, TPOT e vazão { #inference-performance-ttft-tpot-and-throughput }

Gerar uma resposta tem duas fases com perfis opostos:

- **Prefill** — o modelo processa todos os tokens de entrada **em paralelo**. É limitado por computação e termina quando aparece o primeiro token de saída: define o **tempo até o primeiro token (TTFT)**. O TTFT cresce com o tamanho do prompt fora do cache e com a fila no servidor.
- **Decode** — o modelo gera os tokens de saída **um de cada vez**, e cada passo lê todos os pesos do modelo da memória da GPU. É limitado pela largura de banda de memória e define o **tempo por token de saída (TPOT)**, também chamado de latência entre tokens (ITL, *inter-token latency*).

$$
\text{latência}_{\text{e2e}} = \text{TTFT} + \text{TPOT} \times (N_{out} - 1)
\qquad
\text{velocidade por usuário} = \frac{1}{\text{TPOT}}\ \text{tokens/s}
$$

Com TTFT = 0,6 s e TPOT = 20 ms (50 tokens/s), uma resposta de 250 tokens leva 0,6 + 0,02 × 249 ≈ **5,6 s**; uma de 1.000 tokens, **~20,6 s**. O tamanho da resposta é uma decisão de latência.

```python exec="true" html="1" source="tabbed-right"
import matplotlib.pyplot as plt
from io import StringIO

# Left: end-to-end latency = TTFT + TPOT x (output tokens - 1)
models = {"large model (TTFT 0.6 s, 50 tok/s)": (0.6, 0.020),
          "small model (TTFT 0.2 s, 150 tok/s)": (0.2, 1 / 150)}
tokens = list(range(1, 1001, 10))

# Right: one self-hosted replica decoding a batch of b sequences per step.
# Step time = fixed weight read + a small per-sequence cost (illustrative).
W_READ_MS, PER_SEQ_MS = 12.0, 0.15
batch = list(range(1, 257))
per_stream = [1000 / (W_READ_MS + PER_SEQ_MS * b) for b in batch]
aggregate = [b * s for b, s in zip(batch, per_stream)]

fig, ax = plt.subplots(1, 2, figsize=(11, 4))
for label, (ttft, tpot) in models.items():
    ax[0].plot(tokens, [ttft + tpot * (n - 1) for n in tokens], label=label)
ax[0].set_xlabel("output tokens")
ax[0].set_ylabel("end-to-end latency (s)")
ax[0].set_title("Latency grows with the answer length")
ax[0].legend()
ax[0].grid(alpha=.3)

ax[1].plot(batch, aggregate, color="tab:green", label="replica throughput (tok/s)")
ax[1].set_xlabel("concurrent sequences in the batch")
ax[1].set_ylabel("replica throughput (tokens/s)", color="tab:green")
twin = ax[1].twinx()
twin.plot(batch, per_stream, color="tab:red", label="per-user speed (tok/s)")
twin.set_ylabel("per-user speed (tokens/s)", color="tab:red")
ax[1].axvline(64, ls="--", color="gray")
ax[1].text(66, max(aggregate) * 0.1, "KV-cache full\n(8k-token contexts)", color="gray")
ax[1].set_title("Batching: throughput vs per-user speed")
ax[1].grid(alpha=.3)
plt.tight_layout()

buffer = StringIO()
plt.savefig(buffer, format="svg", transparent=True)
print(buffer.getvalue())
plt.close()
```

### Streaming

Como a resposta chega token a token, o gateway a envia em **streaming** para o cliente — normalmente com Server-Sent Events (SSE) sobre HTTP, como visto em [Protocolos](../../edge/protocols/index.md). O fã começa a ler depois do TTFT, e não depois da latência total; é por isso que **o TTFT é o SLO interativo** (por exemplo, TTFT p95 < 1,5 s) e **o TPOT só precisa vencer a velocidade de leitura** (as pessoas leem cerca de 4–8 palavras por segundo, então ~15–20 tokens/s já parece fluido).

O streaming tem consequências arquiteturais:

- **Conexões de longa duração.** Pela lei de Little, 33 requisições/s × 12 s por resposta em streaming ≈ **400 conexões abertas** por pool de instâncias. Use servidores assíncronos (FastAPI/uvicorn, Netty) e aumente os timeouts de ociosidade de balanceadores de carga e proxies que cortariam um stream lento.
- **Chamadas de ferramenta e JSON só podem ser usados quando completos.** Só a resposta final em linguagem natural se beneficia do streaming.
- **Guardrails de saída e streaming entram em conflito.** Verificar a resposta inteira antes de mostrá-la elimina o ganho de TTFT; verificar pedaço por pedaço pode mostrar uma frase problemática antes de ela ser barrada. Meio-termo comum: fazer streaming, verificar em janelas de algumas frases e retirar o trecho se necessário — e nunca fazer streaming do conteúdo de ações de alto risco antes da validação.

### Batching e o KV cache { #batching-and-the-kv-cache }

Se você hospeda um modelo por conta própria (ou só quer entender os limites dos provedores), um número explica a maior parte do comportamento: **o decode é limitado pela largura de banda de memória, não pela computação**. Cada passo de decode lê todos os pesos. Um modelo de 8 bilhões de parâmetros em precisão de 16 bits tem ~16 GB; uma GPU com ~3 TB/s de largura de banda de memória precisa de pelo menos ~5 ms para lê-lo — então uma única sequência não passa de ~200 tokens/s, por mais potente que seja a GPU.

O **batching** (agrupamento em lotes) amortiza essa leitura: uma passada pelos pesos avança *b* sequências de uma vez. A vazão da réplica cresce quase linearmente com *b*, enquanto a velocidade de cada usuário cai devagar (gráfico da direita, acima). Duas técnicas tornaram isso prático:

- **Batching contínuo (in-flight)**[^4]: em vez de esperar um lote inteiro terminar, o servidor adiciona e remove sequências a **cada passo de token**, de modo que uma resposta curta não espera por uma longa.
- **PagedAttention**[^5]: o KV cache de cada sequência é armazenado em páginas de tamanho fixo, como memória virtual, eliminando a fragmentação e permitindo compartilhar prefixos entre requisições (é assim que funciona o **cache de prompt** auto-hospedado).

O limite é a **memória para o KV cache**, os tensores de chave/valor guardados para cada token de cada sequência ativa:

$$
\text{bytes de KV por token} = 2 \times \text{camadas} \times \text{cabeças KV} \times \text{dim. da cabeça} \times \text{bytes por valor}
$$

Para um modelo da classe Llama-3-8B (32 camadas, 8 cabeças KV, dimensão de cabeça 128, valores de 16 bits): 2 × 32 × 8 × 128 × 2 = **128 KiB por token**. Uma conversa de 8.000 tokens precisa de **~1 GiB**. Numa GPU de 80 GB com ~16 GB de pesos, sobram ~64 GB: **~64 conversas simultâneas de 8k tokens**, ou ~512 de 1k tokens. A concorrência é limitada por tamanho de contexto × usuários; é por isso que prompts longos são caros mesmo quando são baratos por token.

Outras técnicas de serving que você vai encontrar em 2026 (todas trocam algo por vazão ou latência):

| Técnica | Ideia | Trade-off |
|---|---|---|
| Quantização (pesos de 8 bits, 4 bits) | menos bytes por peso → menos memória, decode mais rápido | alguma perda de qualidade; precisa ser avaliada |
| Decodificação especulativa[^6] | um modelo rascunho pequeno propõe vários tokens; o modelo grande os verifica em um passo | computação extra; o ganho depende de quantas vezes o rascunho acerta |
| Prefill em blocos (chunked prefill) | divide prefills longos para que não travem os decodes em andamento | TTFT um pouco maior para prompts longos |
| Desagregação prefill/decode[^7] | executa as duas fases em pools de GPU diferentes | o KV cache precisa ser movido entre pools; mais peças móveis |

### Auto-hospedado ou API? { #self-hosted-or-api }

| Critério | API de provedor | Auto-hospedado (vLLM, SGLang, Ollama para desenvolvimento) |
|---|---|---|
| Modelo de custo | por token; zero quando ocioso | por hora de GPU; pago mesmo ocioso |
| Melhor quando | o tráfego é irregular ou pequeno; são necessários os modelos de melhor qualidade | o tráfego é alto e constante; modelos open-weight menores bastam |
| Controle de latência | limitado (infraestrutura compartilhada, limites de taxa) | total (tamanho do lote, hardware, região) |
| Controle dos dados | contratual (retenção, região) | total |
| Operação | nenhuma | GPUs, drivers, autoscaling, atualização de modelos, plantão |

Uma conta de guardanapo: uma GPU que custa US$ *c* por hora e sustenta *T* tokens de saída/s no seu tamanho de lote custa $c / (3600 \cdot T \cdot u)$ por token a uma utilização *u*. Com 10% de utilização, ela fica **10× mais cara por token** do que com 100%. Hospedar por conta própria só compensa com carga constante — ou quando os dados não podem sair da sua rede. Para trabalho offline (gerar embeddings do catálogo, rodar avaliações), muitos provedores também oferecem **APIs de lote**: assíncronas, com resultados em algumas horas, com desconto.

---

## Observabilidade no gateway { #observability-at-the-gateway }

Como toda chamada passa por ele, o gateway é o lugar natural para emitir a telemetria de LLM descrita em [Segurança, avaliações e observabilidade](../safety-evals/index.md#observability): um span por chamada com modelo, tokens (entrada, em cache, saída), custo, TTFT e motivo de término, além de métricas agregadas por alias, funcionalidade e categoria de usuário. Os painéis respondem diretamente à pergunta do CFO: **US$ por conversa**, por funcionalidade, por dia.

## Produtos { #products }

O gateway é um padrão, não um produto. Exemplos para explorar — consulte a documentação atual de cada produto para conferir os recursos:

=== "Open source"

    - **LiteLLM**: API unificada, roteamento, fallbacks, orçamentos, controle de gastos, como servidor proxy ou como SDK dentro do processo — o `Router` do seu SDK é o gateway do [Hands-on 12](../../../hands-on/12/service/index.md).
    - **Envoy AI Gateway**: gerenciamento de tráfego de LLM construído sobre o Envoy Gateway.
    - Motores de serving atrás do gateway: **vLLM**, **SGLang**, **Ollama** (desenvolvimento local).

=== "Gerenciado / nuvem"

    - Plataformas de modelos em nuvem com roteamento e capacidade entre regiões: **Amazon Bedrock**, **Google Vertex AI**, **Azure AI Foundry**.
    - Produtos de gerenciamento de APIs com políticas para LLM (limites de tokens, cache semântico): **Azure API Management**, **Kong AI Gateway**, **Cloudflare AI Gateway**.

!!! tip "Na entrevista"

    Coloque um gateway de LLM entre todos os serviços e os modelos e cite quatro de suas funções: **roteamento por alias, fallbacks com circuit breakers, cotas de tokens com prioridades e telemetria de custo/latência**. Separe o **TTFT** (SLO interativo, com streaming) do **TPOT** (velocidade) na sua estimativa de latência, e diferencie o **cache de prompt** (seguro, reduz o custo de entrada e o TTFT) do **cache semântico** (arriscado, só para respostas genéricas). Se o entrevistador perguntar sobre hospedar por conta própria, responda com os argumentos de memória do KV cache e de utilização.

!!! success "Boas práticas"

    - **Defina um prazo de TTFT por alias e faça failover por ele** — para um fã olhando uma bolha vazia, um provedor que enfileira é tão ruim quanto um que caiu; por exemplo 3 s no p95 para o alias interativo.
    - **Reserve tokens com prioridades, não só com limites** — o tráfego interativo fica com ~70% do TPM da conta às 10:00 e os jobs em lote param primeiro ([cotas](#quotas)).
    - **Rode a suíte de avaliação em todo modelo da cadeia de fallback** — no BoxOffice o fallback do `claude` é um modelo local de 1,5 bilhão de parâmetros ([lab 12 — `llm.py`](../../../hands-on/12/service/index.md)): ele precisa passar no mesmo golden set, senão o fallback é uma queda de qualidade silenciosa durante um incidente.
    - **Crie alerta para a fração de tokens em cache por funcionalidade** — a entrada em cache é cobrada a uma fração do preço (10% no [exemplo da visão geral](../index.md#numbers)); uma edição de prompt que leva uma variável para o topo multiplica o custo de entrada da noite para o dia.
    - **Atribua o custo por funcionalidade e por tipo de usuário no gateway** — "US$ por conversa" deve ser um painel, não uma investigação. No BoxOffice: `metrics.price()` transforma os tokens de toda resposta em dólares ([lab 12 — Guardrails e métricas](../../../hands-on/12/guardrails/index.md)).

!!! warning "Armadilhas comuns"

    - **Nomes de modelos fixos no código dos serviços** — toda troca de modelo vira um deploy de vários times. Use aliases.
    - **Modelos "latest" sem versão fixada** — a qualidade muda sem deploy, e ninguém sabe por que as avaliações caíram.
    - **Repetir `400`s e recusas**, ou fazer fallback para um modelo com menos proteções após uma recusa.
    - **Limitar a taxa só por requisições** — uma requisição de 100k tokens custa tanto quanto mil pequenas.
    - **Dados variáveis no topo do prompt** — o cache de prompt nunca acerta.
    - **Um cache semântico com chave só pelo vetor** — vaza respostas entre eventos, usuários ou tenants.
    - **Timeouts de ociosidade do proxy menores que o stream mais longo** — respostas cortadas no meio sob carga.

---

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    SVC["assistant, summarizer,<br/>translator, embed job"] --> GW["LLM gateway<br/>routing by alias"]
    GW --> FB["fallbacks + circuit breaker<br/>→ Reliability"]
    GW --> Q["token quotas, priorities<br/>→ API gateway rate limiting"]
    GW --> PC["prompt caching<br/>(stable prefix)"]
    GW --> SC["semantic caching<br/>→ Caching invalidation"]
    GW --> ST["streaming over SSE, TTFT<br/>→ Edge protocols"]
    GW --> CAN["canary by alias<br/>→ Cloud-native delivery"]
    GW --> OBS["tokens, cost, TTFT<br/>→ Safety, Evals & Observability"]
    Q --> BG["background work waits<br/>→ Messaging queues"]
```

**Componentes da paleta:** [`llmgw`](../../../reference/components/ai/index.md#llmgw) · [`apigw`](../../../reference/components/edge/index.md#apigw) (seu primo clássico) · [`thirdparty`](../../../reference/components/external/index.md#thirdparty) (os provedores de modelo por trás dele) · [`cache`](../../../reference/components/storage/index.md#cache) (cache semântico) · [`queue`](../../../reference/components/messaging/index.md#queue) (trabalho em segundo plano esperando cota) · [`metrics`](../../../reference/components/observability/index.md#metrics) e [`tracing`](../../../reference/components/observability/index.md#tracing) (tokens, custo, TTFT). **Cenários:** `ai-assistant`, `cascading-failure` (um provedor lento sem circuit breaker), `rate-limiter` (cotas como limites de taxa). **Continua em:** [Tráfego e Borda — API gateway](../../edge/api-gateway/index.md), [Confiabilidade — padrões](../../reliability/patterns/index.md), [Caching — invalidação](../../caching/invalidation/index.md), [Tráfego e Borda — protocolos](../../edge/protocols/index.md), [Agentes e ferramentas](../agents/index.md).

---

[^1]: CHEN, L.; ZAHARIA, M.; ZOU, J. [FrugalGPT: How to Use Large Language Models While Reducing Cost and Improving Performance](https://arxiv.org/abs/2305.05176){target="_blank"}. arXiv, 2023.
[^2]: ONG, I. et al. [RouteLLM: Learning to Route LLMs with Preference Data](https://arxiv.org/abs/2406.18665){target="_blank"}. arXiv, 2024.
[^3]: OWASP. [Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/){target="_blank"}. LLM10: Unbounded Consumption.
[^4]: YU, G.-I. et al. Orca: A Distributed Serving System for Transformer-Based Generative Models. OSDI, 2022.
[^5]: KWON, W. et al. [Efficient Memory Management for Large Language Model Serving with PagedAttention](https://arxiv.org/abs/2309.06180){target="_blank"}. SOSP, 2023.
[^6]: LEVIATHAN, Y.; KALMAN, M.; MATIAS, Y. [Fast Inference from Transformers via Speculative Decoding](https://arxiv.org/abs/2211.17192){target="_blank"}. ICML, 2023.
[^7]: ZHONG, Y. et al. [DistServe: Disaggregating Prefill and Decoding for Goodput-optimized Large Language Model Serving](https://arxiv.org/abs/2401.09670){target="_blank"}. OSDI, 2024.
