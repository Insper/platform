O serviço de câmbio do [exercício 8](../index.md), pronto para rodar: Python com FastAPI, apoiado na **PTAX** do Banco Central do Brasil (BCB). A PTAX é uma API pública, sem chave nem cadastro, que cota as principais moedas em reais (BRL). Algumas APIs gratuitas de câmbio bloqueiam requisições vindas de provedores de nuvem; a PTAX é a padrão aqui porque não exige conta, mas continua sendo um provedor que não é seu, e o exercício trata justamente de conviver com isso.

!!! objectives "Objetivos de aprendizagem"

    Ao final desta página você deve ser capaz de:

    - **Ler** um serviço pequeno que chama um provedor externo através de um cache, um *timeout* e um *fallback* com taxa vencida.
    - **Explicar** como uma taxa cruzada (USD → EUR) sai de cotações que estão todas em BRL.
    - **Rodar** o serviço com o uv e ler o header `X-Cache` de cada resposta.

## Como funciona { #how-it-works }

O serviço pede à PTAX a última cotação de cada moeda em BRL (os últimos 7 dias, pois fins de semana e feriados não têm cotação), guarda-a em memória por `CACHE_SECONDS` e divide uma pela outra. Só uma requisição por moeda atualiza o cache de cada vez; as outras esperam por ela em vez de chamarem todas juntas o BCB. Quando a PTAX falha e há uma taxa antiga em memória, o serviço responde com ela e só tenta de novo depois de `RETRY_SECONDS`.

``` diagram-sim
sequenceDiagram
    participant G as gateway
    participant E as exchange
    participant P as PTAX (BCB)
    G->>E: GET /exchange/USD/EUR
    E->>P: CotacaoMoedaPeriodo USD, últimos 7 dias
    P-->>E: compra/venda em BRL, todos os boletins
    E->>P: CotacaoMoedaPeriodo EUR, últimos 7 dias
    P-->>E: compra/venda em BRL, todos os boletins
    E->>E: taxa cruzada via BRL, guarda as duas cotações
    E-->>G: 200 taxa, X-Cache miss
    G->>E: GET /exchange/USD/EUR (dentro de CACHE_SECONDS)
    E-->>G: 200 taxa, X-Cache hit (PTAX não chamada)
```

A PTAX só cota contra o real, então USD → EUR passa pelo BRL. Com $c$ (compra) e $v$ (venda) as cotações da PTAX em BRL:

$$
\text{buy} = \frac{c_\text{USD}}{v_\text{EUR}} \qquad\qquad \text{sell} = \frac{v_\text{USD}}{c_\text{EUR}}
$$

`buy` é quanto o mercado paga por 1 USD, em euros (ele compra os seus dólares e vende euros a você); `sell` é quanto ele cobra. O próprio BRL vale 1, então `GET /exchange/USD/BRL` é a cotação PTAX do dólar.

| Peça | O que ela protege |
|---|---|
| Cache de `CACHE_SECONDS` (300) por moeda | A PTAX publica poucos boletins por dia: milhares de fãs pedindo a taxa custam poucas chamadas |
| Uma atualização por moeda de cada vez (`asyncio.Lock`) | Um cache frio ou vencido sob carga não vira uma rajada de chamadas idênticas ao provedor |
| *Timeout* de `PTAX_TIMEOUT` (3 s) | Um provedor lento não segura uma requisição por mais tempo do que um fã esperaria |
| Taxa vencida por `RETRY_SECONDS` (30) depois de uma falha | O provedor caiu ou está nos bloqueando: uma taxa antiga é melhor que um erro e não tentamos de novo a cada requisição |
| `X-Cache: miss / hit / stale` | Dá para contar, de fora, quantas vezes o provedor foi chamado e quantas vezes falhou |

## O projeto { #the-project }

No repositório do BoxOffice o serviço fica em `services/exchange/`:

```text
services/exchange/
├── pyproject.toml
├── uv.lock          # created by uv lock: commit it
├── main.py
└── Dockerfile       # your part (exercise 8, step 2)
```

=== "pyproject.toml"

    ``` { .toml .copy .select linenums="1" }
    --8<-- "docs/2027.1/exercises/exchange/service/code/pyproject.toml"
    ```

=== "main.py"

    ``` { .python .copy .select linenums="1" }
    --8<-- "docs/2027.1/exercises/exchange/service/code/main.py"
    ```

| Endpoint | Retorna |
|---|---|
| `GET /exchange/{from}/{to}` | a taxa de uma moeda para outra, com o header `X-Cache` |
| `GET /exchange/currencies` | as moedas que a PTAX cota, além do BRL |
| `GET /health` | `{"status": "ok"}`, para o *health check* do contêiner |

As configurações vêm de variáveis de ambiente, então o Compose ou o Kubernetes as mudam sem uma nova imagem:

| Variável | Padrão | O que define |
|---|---|---|
| `PTAX_URL` | o endereço do BCB | URL base da API PTAX |
| `PTAX_TIMEOUT` | `3` | segundos de espera pela PTAX |
| `CACHE_SECONDS` | `300` | por quanto tempo uma taxa é reutilizada antes de perguntar de novo à PTAX |
| `RETRY_SECONDS` | `30` | depois de uma chamada que falhou, por quanto tempo a taxa antiga é servida antes de tentar de novo |

## Rode localmente { #run-it-locally }

Em `services/exchange/`:

``` { .bash .copy }
uv lock                                   # creates uv.lock from pyproject.toml
uv run uvicorn main:app --reload --port 8000
```

Em outro terminal, duas vezes:

``` { .bash .copy }
curl -i localhost:8000/exchange/USD/EUR
```

Você deve ver `x-cache: miss` na primeira resposta e `x-cache: hit` na segunda, com o mesmo corpo:

``` { .json }
{"from":"USD","to":"EUR","sell":0.906885,"buy":0.9066,"date":"2026-11-13 13:03:27"}
```

O `date` é o boletim da PTAX usado: num fim de semana ou antes das 10h (Brasília) é o último dia útil. Uma moeda desconhecida (`/exchange/XYZ/BRL`) responde `404`; a PTAX inacessível sem nada em memória responde `502`.

!!! warning "A PTAX não é sua para teste de carga"

    - Só há cotação em dias úteis, entre cerca de 10h e 13h (Brasília); fora dessa janela o serviço devolve o último boletim.
    - A PTAX é um serviço público do BCB, compartilhado por todos os alunos da turma. **Nunca rode um teste de carga com o cache desligado** (`CACHE_SECONDS=0`): uma execução do k6 a 100 requisições/s mandaria ao BCB 200 chamadas por segundo, e um provedor que vê isso vindo de um endereço o bloqueia. Com o cache ligado, a execução inteira do exercício 8 custa poucas chamadas.
