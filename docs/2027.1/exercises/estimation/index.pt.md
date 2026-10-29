Às 09:55 o time da BoxOffice está olhando para um dashboard. Em cinco minutos começa a venda de um show em estádio: **2 milhões de fãs para 60 mil lugares**. Quantas requisições por segundo vão chegar ao catálogo? Quantas reservas de assento por segundo o banco vai receber? O mapa de assentos cabe em memória? Quantos servidores de aplicação precisamos? As respostas decidem a arquitetura — e dá para obtê-las **antes de escrever uma linha de código**, com uma folha de papel e algumas fórmulas. É isso que este exercício treina.

!!! abstract "Objetivos de aprendizagem"

    Ao final deste exercício você será capaz de:

    - **Estimar** usuários ativos diários, QPS médio e de pico, proporção leitura/escrita, armazenamento, banda e tamanho de cache a partir de um enunciado curto.
    - **Aplicar** a Lei de Little, fatores de pico e a matemática de disponibilidade (série/paralelo) para dimensionar um sistema.
    - **Explicitar** premissas, manter as unidades corretas e arredondar com a precisão útil.
    - **Derivar** consequências de design a partir dos números ("isso obriga a ter uma CDN", "um único primário SQL basta").
    - **Verificar a sanidade** de uma estimativa comparando-a com um número de referência conhecido.

## Contexto { #context }

A estimativa de guardanapo (*back-of-the-envelope*) é o segundo passo do [roteiro de entrevista](../../classes/intro/interview-framework/index.md) e a primeira coisa que um revisor procura em um design doc[^1]. O objetivo é **a ordem de grandeza certa**, não três algarismos significativos: 12 mil ou 15 mil requisições por segundo levam ao mesmo design; 1,2 mil ou 120 mil, não.

As ferramentas vêm da [Aula 2 — Estimativas](../../classes/estimation/index.md): potências de dois e de dez, os [números de latência e vazão](../../reference/numbers/index.md)[^2], a Lei de Little, utilização, percentis e matemática de disponibilidade. No [Lab 2](../../hands-on/2/index.md) você vai conferir alguns desses números em um serviço real.

### Fórmulas que você vai usar { #formulas-you-will-use }

| Grandeza | Fórmula | Premissa típica |
|-|-|-|
| Segundos em um dia | 86.400 ≈ 10⁵ s | arredonde para 10⁵ para fazer de cabeça |
| QPS médio | requisições por dia ÷ 86.400 | — |
| QPS de pico | média × fator de pico | 2–3× para picos diários; muito mais em eventos |
| Armazenamento | itens por dia × tamanho × retenção × replicação | fator de replicação 3 em armazenamentos duráveis |
| Banda | QPS × tamanho da carga | separe entrada (escritas) e saída (leituras) |
| Tamanho do cache | fração quente × itens distintos por dia × tamanho do item | "80/20": 20% dos itens recebem 80% das leituras |
| Concorrência (Lei de Little) | L = λ × W | λ em req/s, W em segundos |
| Servidores | QPS de pico ÷ (capacidade por servidor × utilização-alvo) | utilização-alvo de 0,6–0,7 |
| Disponibilidade em série | A = A₁ × A₂ × … | cada salto multiplica |
| Disponibilidade em paralelo | A = 1 − (1 − Aᵢ)ⁿ | n réplicas independentes |

## Tarefa { #task }

Preencha uma **planilha de estimativas** para **cinco sistemas**:

1. **Venda relâmpago da BoxOffice** — obrigatória para todos (fatos abaixo).
2. **Quatro sistemas** escolhidos entre as [fichas](#fact-sheets) abaixo (pelo menos um com muita leitura e um com muita escrita).

Para cada sistema, estime as grandezas do [template](#templates), mostre as contas e termine com **três consequências de design** derivadas dos seus números.

### Fatos da BoxOffice { #boxoffice-facts }

- A venda de um show em estádio começa às 10:00; **2 M de fãs** chegam nos primeiros **10 minutos**; há **60 mil lugares**, no máximo 4 por pedido.
- Um fã navegando faz, em média, uma requisição a cada 3 segundos (catálogo, mapa de assentos, consulta de disponibilidade).
- Uma **sala de espera** admite fãs no fluxo de compra a uma taxa que você deve escolher para que a venda dure cerca de **15 minutos**.
- Uma reserva de assento dura 5 minutos; cerca de 30% das reservas expiram sem pagamento.
- Um registro de pedido tem cerca de 1 KB; um e-mail de ingresso, cerca de 50 KB; o mapa de assentos do local, cerca de 200 KB de JSON.
- Fora das vendas, a BoxOffice atende 5 M de usuários ativos por dia, que navegam ~20 páginas cada.

### Fichas { #fact-sheets }

Todos os fatos abaixo são **premissas ilustrativas** para o exercício — use-os como dados e acrescente suas próprias premissas onde for preciso.

| Sistema | Fatos |
|-|-|
| Chat em tempo real | 50 M de DAU; 40 mensagens enviadas por usuário por dia; 100 bytes por mensagem; 25% dos usuários online no pico; histórico mantido por 5 anos |
| Despacho de corridas | 2 M de motoristas ativos no pico enviando a localização a cada 4 s; 10 M de corridas por dia; uma atualização de localização tem 100 bytes; corridas mantidas por 3 anos |
| Feed social | 200 M de DAU; 2 posts e 50 leituras de timeline por usuário por dia; 30% dos posts têm uma imagem de 500 KB; uma página de timeline tem 20 posts |
| Plataforma de vídeo | 500 mil uploads por dia, 5 min em média, 4 resoluções somando 1 GB por vídeo; 1 B de visualizações por dia de 4 min em média a 2 Mbit/s |
| Assistente de suporte com IA | 1 M de conversas por dia, 6 turnos cada; 1.500 tokens de entrada (com contexto do RAG) e 300 tokens de saída por turno; saída a 50 tokens/s |
| Sistema de notificações | 100 M de usuários; 5 notificações por usuário por dia; 30% push, 60% e-mail, 10% SMS; rajadas de 10× durante campanhas |
| Autocompletar de busca | 100 M de DAU; 6 buscas por usuário por dia; uma requisição por caractere digitado a partir do 2º, consulta média de 10 caracteres |
| Plataforma de métricas | 50 mil hosts; 500 séries temporais por host; uma amostra a cada 10 s; 16 bytes por amostra; dados brutos mantidos 15 dias, agregados de 1 minuto por 1 ano |

## Requisitos { #requirements }

- [ ] **(obrigatório)** Cinco planilhas completas: BoxOffice + quatro fichas (pelo menos uma com muita leitura e uma com muita escrita).
- [ ] **(obrigatório)** Todo número tem **unidade** e todo número derivado mostra sua **fórmula** (nada de resultados soltos).
- [ ] **(obrigatório)** As premissas estão em uma tabela, separadas dos fatos dados.
- [ ] QPS médio **e** de pico, separados em leituras e escritas.
- [ ] Armazenamento por ano (com replicação) e banda (entrada e saída).
- [ ] Tamanho do cache para o conjunto quente, e se ele cabe em um nó.
- [ ] Número de servidores para o caminho mais quente, usando a **Lei de Little** para a concorrência e uma utilização-alvo.
- [ ] Disponibilidade do caminho principal (série/paralelo) comparada com um SLO-alvo.
- [ ] Uma **verificação de sanidade** por sistema contra um número de referência (por exemplo, do [cheat sheet de números](../../reference/numbers/index.md)).
- [ ] **Três consequências de design** por sistema, cada uma apontando para um número da planilha.
- [ ] Seção *Uso de IA* (veja a [política](../index.md#use-of-ai-tools)).

## Entregáveis { #deliverables }

- Uma página `estimation` no site da sua documentação com as cinco planilhas (tag `ex1`).
- Opcional: a planilha eletrônica ou o script que você usou (versionado no repositório) — a página ainda precisa mostrar as fórmulas.

## Passo a passo { #step-by-step }

1. **Leia os fatos e escreva a pergunta.** "Quantas reservas de assento por segundo no pico?" é uma pergunta; "estime a BoxOffice" não é.
2. **Liste as premissas antes de calcular.** Escreva o que você supõe e por quê (por exemplo, "fator de pico 3, de uma curva diária típica").
3. **Calcule as médias, depois os picos.** Requisições por dia ÷ 10⁵ dá o QPS médio; multiplique pelo fator de pico. Em eventos (vendas, campanhas), calcule o pico **diretamente** a partir do evento: usuários × taxa de requisições.
4. **Separe leituras e escritas.** Elas atingem componentes diferentes (cache/CDN vs banco primário).
5. **Dimensione os dados.** Itens × tamanho × retenção × replicação. Depois, o conjunto quente para o cache.
6. **Dimensione a computação.** A Lei de Little dá as requisições em andamento; a capacidade por servidor e uma utilização-alvo dão o número de servidores.
7. **Verifique a disponibilidade.** Multiplique as disponibilidades ao longo do caminho principal; acrescente réplicas onde o resultado ficar abaixo do SLO.
8. **Verifique a sanidade.** Compare com algo que você conhece (um número da aula, um blog de engenharia público, o cheat sheet).
9. **Escreva as consequências.** Cada consequência é uma decisão justificada por um número.

### Exemplo resolvido: encurtador de URL { #worked-example-url-shortener }

**Fatos (ilustrativos):** 100 M de URLs curtas novas por mês; proporção leitura/escrita de 100:1; registros mantidos por 5 anos; 500 bytes por registro.

| Grandeza | Conta | Resultado |
|-|-|-|
| Escritas, média | 100 M ÷ (30 × 86.400 s) ≈ 100 M ÷ 2,6 M s | ≈ 40 escritas/s |
| Escritas, pico (×3) | 40 × 3 | ≈ 120 escritas/s |
| Leituras, média | 40 × 100 | ≈ 4.000 leituras/s |
| Leituras, pico (×3) | 4.000 × 3 | ≈ 12.000 leituras/s |
| Registros em 5 anos | 100 M × 12 × 5 | 6 B de registros |
| Armazenamento | 6 B × 500 B = 3 TB; × 3 réplicas | ≈ 9 TB |
| Tamanho da chave | 62⁷ ≈ 3,5 × 10¹² > 6 × 10⁹ | 7 caracteres base-62 |
| Banda de saída | 4.000 leituras/s × 500 B | ≈ 2 MB/s |
| Cache (20% das leituras de um dia) | 4.000 × 86.400 ≈ 350 M leituras/dia; 20% × 500 B | ≈ 35 GB → um nó grande ou um cluster pequeno |
| Concorrência no pico | L = 12.000 req/s × 0,02 s | ≈ 240 requisições em andamento |
| Servidores de aplicação | 12.000 ÷ (1.000 req/s por instância × 0,7) | ≈ 18 instâncias (+2 para N+2) |
| Disponibilidade | LB 99,99% × app (2 réplicas de 99,9%: 1 − 0,001² ≈ 99,9999%) × BD 99,95% | ≈ 99,94% |

**Verificação de sanidade:** 2 MB/s de saída é pouquíssimo — uma única placa de rede de 1 Gbit/s move ~125 MB/s. O gargalo não é a banda.

**Consequências de design:**

1. 12 mil leituras/s vs 120 escritas/s → **muita leitura**: um cache na frente do banco (uma taxa de acerto acima de 90% elimina a maior parte das leituras no banco).
2. 9 TB em 5 anos → cabe em um cluster SQL, mas um armazenamento chave-valor particionado pela chave curta mantém o crescimento simples; nenhum join é necessário.
3. 99,94% < meta de 99,99% → o banco é o elo mais fraco: acrescente um standby com failover automático (ou aceite o SLO).

!!! example "BoxOffice — por onde começar"

    Comece pelo evento, não pelo dia: 2 M de fãs em 10 minutos, uma requisição a cada 3 s cada um. Quantos fãs estão navegando ao mesmo tempo (Lei de Little de novo: taxa de chegada × tempo de permanência)? Isso dá o QPS do catálogo. Depois, a sala de espera: se a venda deve durar ~15 minutos para 60 mil lugares e um pedido tem em média 2,5 lugares, quantos compradores por minuto precisam ser admitidos? Esse número dimensiona o caminho da reserva de assentos — e mostra por que a sala de espera existe.

### Um pequeno ajudante (opcional) { #a-tiny-helper-optional }

Escrever as contas como código mantém as unidades honestas. Você pode adaptar este script; a página ainda precisa mostrar as fórmulas.

```python title="estimate.py"
DAY = 86_400  # seconds


def qps(per_day: float, peak_factor: float = 3.0) -> tuple[float, float]:
    """Average and peak requests per second."""
    avg = per_day / DAY
    return avg, avg * peak_factor


def servers(peak_qps: float, per_server: float, target_util: float = 0.7, spare: int = 2) -> int:
    """Instances needed at the target utilization, plus spare capacity (N+spare)."""
    from math import ceil
    return ceil(peak_qps / (per_server * target_util)) + spare


def series(*avail: float) -> float:
    """Availability of components in series."""
    out = 1.0
    for a in avail:
        out *= a
    return out


def parallel(a: float, n: int) -> float:
    """Availability of n independent replicas."""
    return 1 - (1 - a) ** n


if __name__ == "__main__":
    writes = 100e6 / 30          # URL shortener: writes per day
    w_avg, w_peak = qps(writes)
    r_avg, r_peak = w_avg * 100, w_peak * 100
    print(f"writes {w_avg:,.0f}/s avg, {w_peak:,.0f}/s peak")
    print(f"reads  {r_avg:,.0f}/s avg, {r_peak:,.0f}/s peak")
    print(f"in flight at peak: {r_peak * 0.020:,.0f}")
    print(f"app servers: {servers(r_peak, 1_000)}")
    print(f"availability: {series(0.9999, parallel(0.999, 2), 0.9995):.4%}")
```

## Templates

Copie uma planilha por sistema para a sua página.

=== "English"

    ~~~markdown
    ## System: <name>

    ### Given facts
    | Fact | Value |
    |-|-|
    | ... | ... |

    ### Assumptions
    | # | Assumption | Value | Why |
    |-|-|-|-|
    | A1 | Peak factor | 3× | daily curve with an evening peak |
    | A2 | Capacity per app instance | 1,000 req/s | measured in Lab 2 / cheat sheet |

    ### Estimates
    | Quantity | Formula | Result | Unit |
    |-|-|-|-|
    | Reads, average | | | req/s |
    | Reads, peak | | | req/s |
    | Writes, average | | | req/s |
    | Writes, peak | | | req/s |
    | Storage per year (with replication) | | | TB |
    | Ingress bandwidth | | | MB/s |
    | Egress bandwidth | | | MB/s |
    | Cache (hot set) | | | GB |
    | Concurrency at peak (L = λW) | | | requests |
    | Servers for the hottest path | | | instances |
    | Availability of the main path | | | % |

    ### Sanity check
    <compare one number with a known reference>

    ### Design consequences
    1. <decision> — because <number from the sheet>
    2. ...
    3. ...
    ~~~

=== "Português"

    ~~~markdown
    ## Sistema: <nome>

    ### Fatos dados
    | Fato | Valor |
    |-|-|
    | ... | ... |

    ### Premissas
    | # | Premissa | Valor | Por quê |
    |-|-|-|-|
    | P1 | Fator de pico | 3× | curva diária com pico à noite |
    | P2 | Capacidade por instância da aplicação | 1.000 req/s | medido no Lab 2 / cheat sheet |

    ### Estimativas
    | Grandeza | Fórmula | Resultado | Unidade |
    |-|-|-|-|
    | Leituras, média | | | req/s |
    | Leituras, pico | | | req/s |
    | Escritas, média | | | req/s |
    | Escritas, pico | | | req/s |
    | Armazenamento por ano (com replicação) | | | TB |
    | Banda de entrada | | | MB/s |
    | Banda de saída | | | MB/s |
    | Cache (conjunto quente) | | | GB |
    | Concorrência no pico (L = λW) | | | requisições |
    | Servidores no caminho mais quente | | | instâncias |
    | Disponibilidade do caminho principal | | | % |

    ### Verificação de sanidade
    <compare um número com uma referência conhecida>

    ### Consequências para o design
    1. <decisão> — porque <número da planilha>
    2. ...
    3. ...
    ~~~

## Rubrica { #rubric }

Níveis conforme definidos em [Como os exercícios são avaliados](../index.md#how-the-exercises-are-graded).

| Critério | I | D | C | B | A |
|-|-|-|-|-|-|
| Completude **(obrigatório)** | Não entregue | Menos de cinco planilhas ou grandezas faltando | Cinco planilhas, todas as grandezas presentes | — | — |
| Premissas | Nenhuma | Misturadas aos fatos, sem justificativa | Listadas, separadas dos fatos | Justificadas (fonte ou raciocínio) | Sensibilidade indicada: qual premissa muda o design se estiver errada |
| Contas e unidades **(obrigatório)** | Números soltos | Erros de unidade ou de ordem de grandeza | Ordens de grandeza corretas, unidades em tudo | Fórmulas mostradas e arredondamento consistente | Conferidas de dois jeitos (por exemplo, por usuário e por segundo) |
| Uso das fórmulas | — | Falta a Lei de Little ou a disponibilidade | Pico, Lei de Little e disponibilidade aplicados | Aplicados ao caminho certo (o mais quente, o crítico) | Explica o efeito da utilização na latência (o joelho) |
| Verificações de sanidade | — | Nenhuma | Uma por sistema | Referência relevante com fonte | Encontra e corrige um erro próprio pela verificação |
| Consequências de design | — | Genéricas ("use um cache") | Três por sistema | Cada uma ligada a um número | Ordena por importância e diz o que mudaria com 10× |

## FAQ

??? question "Quão precisos os números precisam ser?"

    Um algarismo significativo costuma bastar. Arredonde sem medo (86.400 ≈ 10⁵), mas diga que arredondou. O que importa é a ordem de grandeza e que um leitor consiga acompanhar as contas.

??? question "De onde tiro a capacidade de um servidor?"

    Use os números da aula e o [cheat sheet de números](../../reference/numbers/index.md) ou — melhor — o que você mediu no [Lab 2](../../hands-on/2/index.md). Diga sempre qual usou.

??? question "Posso mudar os fatos dados?"

    Não. Os fatos são os mesmos para todos para que as planilhas possam ser comparadas. Acrescente premissas para tudo o que os fatos não dizem.

??? question "Qual é um bom fator de pico?"

    Para tráfego diário, 2–3× a média é comum. Em eventos (uma venda, uma campanha, um gol numa final), calcule o pico a partir do próprio evento em vez de multiplicar a média diária.

??? question "A IA me deu uma planilha completa em segundos. Posso usar?"

    Você pode usar IA para conferir suas contas ou discutir premissas, e deve declarar o uso. Mas a verificação oral deste exercício é simples: você vai refazer uma linha de uma planilha no quadro com um fato alterado. Pratique fazendo sozinho.

??? question "Preciso incluir o tráfego normal (fora da venda) da BoxOffice?"

    Sim, brevemente: ele mostra o quanto o pico da venda é diferente de um dia normal — que é exatamente o motivo de a BoxOffice precisar de uma sala de espera e de capacidade elástica.

[^1]: Alex Xu, *System Design Interview — An Insider's Guide*, vol. 1, cap. 2 "Back-of-the-envelope estimation", 2020.
[^2]: Jeff Dean, "Numbers Everyone Should Know", em *Designs, Lessons and Advice from Building Large Distributed Systems*, LADIS 2009.
