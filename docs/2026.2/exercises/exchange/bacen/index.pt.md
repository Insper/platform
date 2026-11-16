Algumas APIs gratuitas de câmbio bloqueiam requisições vindas de provedores de nuvem: o serviço responde no seu notebook e falha quando roda na AWS. A **PTAX** do Banco Central do Brasil (BCB) é uma API pública, sem chave nem cadastro, que cota as principais moedas em reais (BRL). Esta página traz o microsserviço de câmbio inteiro, em Python com FastAPI, apoiado na PTAX: **a sua parte é o contêiner** e a integração dele à plataforma.

!!! objectives "Objetivos de aprendizagem"

    Ao final desta página você deve ser capaz de:

    - **Conteinerizar** um serviço Python gerenciado pelo uv, com um arquivo de *lock* reprodutível.
    - **Integrar** um novo microsserviço à pilha do Compose e atrás do gateway.
    - **Explicar** como uma taxa cruzada (USD → EUR) sai de cotações que estão todas em BRL.

!!! info "Opcional"

    Usar este serviço é uma **opção** do exercício [API de Câmbio](../index.md): você ainda pode escrever o seu próprio serviço sobre qualquer API de terceiros. Se escolher este, informe no README do seu repositório.

## Como funciona { #how-it-works }

O gateway descobre quem está chamando e repassa a requisição com o header `id-account`. O serviço pede à PTAX a última cotação de cada moeda em BRL (os últimos 7 dias, pois fins de semana e feriados não têm cotação), guarda-a em memória por 5 minutos e divide uma pela outra. Só uma requisição por moeda atualiza o cache de cada vez: as outras esperam por ela em vez de chamarem todas juntas o BCB. Quando a PTAX falha e há uma taxa antiga em memória, o serviço responde com ela.

``` mermaid-sim
sequenceDiagram
    participant G as gateway
    participant E as exchange
    participant P as PTAX (BCB)
    G->>E: GET /exchange/USD/EUR + id-account
    E->>P: CotacaoMoedaPeriodo USD, últimos 7 dias
    P-->>E: compra/venda em BRL, todos os boletins
    E->>P: CotacaoMoedaPeriodo EUR, últimos 7 dias
    P-->>E: compra/venda em BRL, todos os boletins
    E->>E: taxa cruzada via BRL, cache de 5 min
    E-->>G: {"sell", "buy", "date", "id-account"}
```

A PTAX só cota contra o real, então USD → EUR passa pelo BRL. Com $c$ (compra) e $v$ (venda) as cotações da PTAX em BRL:

$$
\text{buy} = \frac{c_\text{USD}}{v_\text{EUR}} \qquad\qquad \text{sell} = \frac{v_\text{USD}}{c_\text{EUR}}
$$

`buy` é quanto o mercado paga por 1 USD, em euros (ele compra os seus dólares e vende euros a você); `sell` é quanto ele cobra. O próprio BRL vale 1, então `GET /exchange/USD/BRL` é a cotação PTAX do dólar.

## O projeto { #the-project }

```text
exchange/
├── pyproject.toml
├── uv.lock          # created by uv lock: commit it
└── main.py
```

=== "pyproject.toml"

    ``` { .toml .copy .select linenums="1" }
    --8<-- "docs/2026.2/exercises/exchange/bacen/code/pyproject.toml"
    ```

=== "main.py"

    ``` { .python .copy .select linenums="1" }
    --8<-- "docs/2026.2/exercises/exchange/bacen/code/main.py"
    ```

| Endpoint | Retorna |
|---|---|
| `GET /exchange/{from}/{to}` | a taxa de uma moeda para outra (também responde em `/exchanges/...`, como o enunciado do exercício escreve) |
| `GET /exchange/currencies` | as moedas que a PTAX cota, além do BRL |
| `GET /health` | `{"status": "ok"}`, para o *health check* do contêiner |

Toda resposta de taxa traz o header `X-Cache`: `miss` (a PTAX foi chamada), `hit` (taxa da memória) ou `stale` (a PTAX falhou e uma taxa vencida foi servida). As configurações vêm de variáveis de ambiente, então o contêiner as muda sem uma nova imagem:

| Variável | Padrão | O que define |
|---|---|---|
| `PTAX_URL` | o endereço do BCB | URL base da API PTAX |
| `PTAX_TIMEOUT` | `3` | segundos de espera pela PTAX |
| `CACHE_SECONDS` | `300` | por quanto tempo uma taxa é reutilizada antes de perguntar de novo à PTAX |
| `RETRY_SECONDS` | `30` | depois de uma chamada que falhou, por quanto tempo a taxa antiga é servida antes de tentar de novo |

## Rode localmente { #run-it-locally }

Na pasta `exchange/`:

``` { .bash .copy }
uv lock                                   # creates uv.lock from pyproject.toml
uv run uvicorn main:app --reload --port 8000
```

Em outro terminal:

``` { .bash .copy }
curl -H "id-account: 0195ae95-5be7-7dd3-b35d-7a7d87c404fb" localhost:8000/exchange/USD/EUR
```

Você deve ver algo como:

``` { .json }
{"sell":0.906885,"buy":0.9066,"date":"2026-11-13 13:03:27","id-account":"0195ae95-5be7-7dd3-b35d-7a7d87c404fb"}
```

O `date` é o boletim da PTAX usado: num fim de semana ou antes das 10h (Brasília) é o último dia útil. Sem o header o serviço responde `422`; uma moeda desconhecida (`/exchange/XYZ/BRL`) responde `404`.

## Sua tarefa: o contêiner { #your-task-the-container }

1. Escreva o `Dockerfile` do serviço:
    - imagem base `python:3.12-slim`, com o binário `uv` copiado de `ghcr.io/astral-sh/uv`[^1];
    - copie `pyproject.toml` e `uv.lock` **antes** do `main.py` e rode `uv sync --frozen`, para que uma mudança no código não reinstale as dependências;
    - inicie `uvicorn main:app` em `0.0.0.0:8000`.
1. Adicione o serviço `exchange` ao `compose.yaml` da plataforma (sem porta publicada: só o gateway chega até ele).
1. Adicione a rota do gateway `Path=/exchange/**` → `http://exchange:8000`, atrás da autenticação como as outras rotas de negócio.
1. Verifique pelo gateway: faça login e então `GET /exchange/USD/EUR` com o token devolve a taxa e o seu `id-account`.
1. Na nuvem: de um pod do cluster, rode `curl` na URL da PTAX uma vez para confirmar que o provedor responde a partir da AWS.

!!! warning "Limites da PTAX"

    - Só há cotação em dias úteis, entre cerca de 10h e 13h (Brasília); fora dessa janela o serviço devolve o último boletim.
    - O cache vive na memória do processo: um contêiner reiniciado pergunta de novo à PTAX e, se o BCB não responder e não houver taxa em cache, o serviço responde `502`.
    - A PTAX é um serviço público do BCB: não faça teste de carga nela. Mantenha o cache ligado; um teste de carga contra o seu gateway deve causar só algumas chamadas à PTAX (conte os `X-Cache: miss`).

[^1]: [Usando o uv no Docker](https://docs.astral.sh/uv/guides/integration/docker/){target="_blank"}.
