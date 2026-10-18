
A BoxOffice promete aos organizadores que o checkout estará disponível **99,95%** do tempo. Cada equipe relata com orgulho que seu serviço roda com "três noves e meio" — gateway, auth, inventory, order, todos a 99,95%. O contrato do provedor de pagamentos diz 99,9%. E o checkout ainda chama o serviço de e-mail de forma síncrona para enviar o ingresso. No fim do mês, o checkout ficou disponível só **99,2%** do tempo — quase seis horas de falhas — e nenhuma equipe deixou de cumprir sua meta. Esta página é a aritmética que prevê esse resultado de antemão e mostra os movimentos de design que o mudam.

---

## Disponibilidade, MTTF e MTTR

**Disponibilidade** é a fração do tempo — ou das requisições — em que um sistema faz o seu trabalho. Duas formas de medi-la são comuns:

| Tipo | Fórmula | Bom para |
|---|---|---|
| **Baseada em tempo** | tempo no ar / (tempo no ar + tempo fora do ar) | infraestrutura, "está no ar?" |
| **Baseada em requisições** | requisições bem-sucedidas / requisições válidas | serviços; o que os usuários realmente experimentam; a base dos SLOs[^2] |

Para um componente que alterna entre funcionar e estar em reparo, a disponibilidade sai de duas médias:

$$
A = \frac{\text{MTTF}}{\text{MTTF} + \text{MTTR}}
$$

- **MTTF** (*Mean Time To Failure*): quanto tempo ele roda, em média, antes de falhar.
- **MTTR** (*Mean Time To Recovery/Repair*): quanto tempo leva, em média, para **detectar, diagnosticar e restaurar** o serviço.
- **MTBF** (*Mean Time Between Failures*) = MTTF + MTTR.

!!! example "BoxOffice — duas formas de melhorar o serviço de inventário"

    O serviço de inventário falha cerca de uma vez por mês (MTTF ≈ 720 h); a cada vez, leva 2 h até alguém ser acionado, encontrar o problema e reiniciá-lo (MTTR = 2 h).

    A = 720 / 722 ≈ **99,72%**.

    - Tornar as falhas duas vezes mais raras (MTTF = 1.440 h): A = 1.440 / 1.442 ≈ 99,86%.
    - Detectar a falha com um health check e substituir a instância automaticamente em 2 minutos (MTTR ≈ 0,033 h): A = 720 / 720,033 ≈ **99,995%**.

    **Recuperar mais rápido costuma ser a alavanca mais barata.** A automação (health checks, reinícios automáticos, failover) ataca o MTTR; testes e redundância atacam o MTTF.

## Os noves

Metas de disponibilidade são expressas como um número de "noves". A tabela é calculada para várias **janelas** — a mesma porcentagem permite indisponibilidades diferentes dependendo do período em que é medida:

```python exec="1"
def human(seconds):
    for unit, size in (("d", 86400), ("h", 3600), ("min", 60)):
        if seconds >= size:
            return f"{seconds / size:.3g} {unit}"
    return f"{seconds:.3g} s"


windows = [("365.25 d", 365.25), ("30.44 d", 365.25 / 12), ("28 d", 28), ("7 d", 7), ("1 d", 1)]
targets = [0.9, 0.99, 0.995, 0.999, 0.9995, 0.9999, 0.99999, 0.999999]

print("| A | " + " | ".join(name for name, _ in windows) + " |")
print("|---|" + "---|" * len(windows))
for a in targets:
    cells = [human((1 - a) * days * 86400) for _, days in windows]
    print(f"| **{a * 100:.6g}%** | " + " | ".join(cells) + " |")
```

O cabeçalho de cada coluna é a duração da janela (um ano de 365,25 dias, um mês médio, 28 dias, uma semana, um dia); cada célula é a **indisponibilidade permitida** naquela janela.

Cada nove a mais é uma **redução de 10×** na indisponibilidade permitida — e, grosso modo, uma mudança na forma como o sistema precisa ser operado:

| Meta | Permitido por mês | O que exige, grosso modo |
|---|---|---|
| 99% | ~7 h | um servidor, recuperação manual, backups |
| 99,9% | ~44 min | redundância, health checks, humanos de plantão, recuperação ensaiada |
| 99,99% | ~4 min | failover automático (humanos são lentos demais para estar no laço), multi-zona, deploys seguros (canário, rollback instantâneo) |
| 99,999% | ~26 s | multi-região ativo-ativo, tudo automatizado, disciplina extrema de mudanças — muito caro |

Uma conferência de sanidade útil: a 99,99% você não pode se dar ao luxo de **um** incidente de 5 minutos por mês. Se o seu procedimento de recuperação envolve um humano lendo um painel, você não é um sistema de quatro noves.

!!! warning "Números baseados em requisições são números grandes"

    A 2.000 requisições por segundo, "99,9% das requisições têm sucesso" ainda significa **2 requisições falhando a cada segundo**, ~170.000 por dia. Metas de disponibilidade tratam de **taxas**, nunca de "nenhum erro" — 100% não é alcançável nem um objetivo sensato. A diferença até 100% é o **error budget** ([aula 9](../../reliability/index.md)).

---

## Componentes em série

Quando uma requisição precisa que **todos** os componentes de uma cadeia funcionem (uma cadeia de dependências síncronas), o sistema só funciona se todos funcionarem. Se as falhas forem independentes, as disponibilidades se **multiplicam**:

$$
A_{series} = a_1 \times a_2 \times \dots \times a_n = \prod_{i=1}^{n} a_i
$$

A cadeia é sempre **pior que seu elo mais fraco**, e cada dependência síncrona a mais baixa o teto. O gráfico mostra $a^n$ para n componentes idênticos:

```python exec="1" html="1"
from io import StringIO

import matplotlib.pyplot as plt
import numpy as np

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "axes.edgecolor": "#888",
                     "xtick.color": "#888", "ytick.color": "#888", "font.size": 10})

n = np.arange(1, 31)
fig, ax = plt.subplots(figsize=(8, 4.2))
for a, color in [(0.999, "#ef4444"), (0.9995, "#f59e0b"), (0.9999, "#3b82f6"), (0.99999, "#10b981")]:
    ax.plot(n, 100 * a ** n, "o-", ms=3, color=color, lw=2, label=f"a = {a * 100:g}%")
ax.axhline(99.9, color="#888", ls=":", lw=1)
ax.text(1.3, 99.9, "99.9%", va="bottom")
ax.set_xlim(1, 30)
ax.set_ylim(97, 100.05)
ax.set_xlabel("n")
ax.set_ylabel("A = aⁿ (%)")
ax.grid(alpha=0.2)
ax.legend(frameon=False, loc="lower left")
for side in ("top", "right"):
    ax.spines[side].set_visible(False)
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

Dez componentes a 99,9% dão 99,0%; trinta dão 97,0%. Uma arquitetura de microsserviços em que uma requisição atravessa dez serviços de forma síncrona precisa que cada um deles seja **muito** melhor que a meta do todo.

## Componentes em paralelo

Quando **qualquer um** de n componentes redundantes e independentes basta (réplicas atrás de um load balancer, um primário com um standby, dois provedores de pagamento), o sistema só falha se **todos** falharem ao mesmo tempo:

$$
A_{parallel} = 1 - \prod_{i=1}^{n} (1 - a_i) \qquad \text{(idênticos: } 1 - (1 - a)^n \text{)}
$$

| Uma réplica | Duas réplicas | Três réplicas |
|---|---|---|
| 99% | 1 − 0,01² = **99,99%** | 1 − 0,01³ = 99,9999% |
| 99,5% | 1 − 0,005² = 99,9975% | 1 − 0,005³ ≈ 99,99999% |

A redundância transforma componentes medíocres em sistemas muito disponíveis — **se as falhas forem independentes** (veja abaixo) e **se o failover realmente funcionar** (o load balancer percebe a falha e para de enviar tráfego, o standby de fato assume).

### k-de-n: quóruns

Alguns sistemas precisam de **uma maioria** das réplicas, não de apenas uma — protocolos de consenso e bancos replicados por quórum ([aula 3](../../distributed/index.md)). Com 3 réplicas de disponibilidade a, um quórum de 2-de-3 está disponível quando as 3, ou exatamente 2, estão no ar:

$$
A_{2\text{-de-}3} = a^3 + 3a^2(1 - a)
$$

Com a = 99%: 0,970299 + 0,029403 = **99,97%** — melhor que um nó, pior que "qualquer uma das três" (99,9999%). O preço da consistência é pago em disponibilidade, até na aritmética.

---

## O checkout da BoxOffice, calculado

O caminho do checkout, como descrito no início da página (as disponibilidades são premissas ilustrativas):

``` mermaid-sim
flowchart LR
    fan([Fã]) --> edge["Borda + gateway<br/>99,99%"]
    edge --> auth["auth<br/>99,95%"]
    auth --> order["order<br/>99,95%"]
    order --> inv["inventory<br/>99,95%"]
    inv --> db[("banco do inventory<br/>99,95%")]
    order --> pay["provedor de pagamento<br/>99,9%"]
    order --> mail["e-mail (síncrono)<br/>99,5%"]
```

| Design | Cálculo | Disponibilidade | Falhas a cada 30 dias |
|---|---|---|---|
| **Ingênuo** (tudo síncrono, em série) | 0,9999 × 0,9995⁴ × 0,999 × 0,995 | **99,19%** | ~5,8 h |
| **E-mail assíncrono** (fila + worker; fora do caminho crítico) | 0,9999 × 0,9995⁴ × 0,999 | 99,69% | ~2,2 h |
| **+ segundo provedor de pagamento** (failover quando o primeiro cai) | 0,9999 × 0,9995⁴ × (1 − 0,001²) | 99,79% | ~1,5 h |
| **+ todo componente interno a 99,99%** (réplicas, failover automático, deploys seguros) | 0,9999⁵ × (1 − 0,001²) | **99,95%** | ~22 min |

Três lições, em ordem decrescente de custo-benefício:

1. **Tire dependências do caminho crítico.** Tornar o e-mail assíncrono ganhou mais que qualquer outra mudança isolada — e não custou quase nada. Se o usuário não precisa que algo termine *antes* da resposta, isso não deveria estar na cadeia.
2. **Acrescente redundância onde uma dependência é fraca e crítica.** Um segundo provedor de pagamento transforma uma dependência de 99,9% numa efetivamente de 99,9999% (se as falhas deles forem independentes).
3. **Faça cada elo restante ser melhor que a meta.** Uma cadeia de cinco componentes só cumpre 99,95% se cada um estiver em torno de 99,99%. Essa é a "**regra do nove extra**": as dependências críticas de um serviço devem ter, cada uma, aproximadamente um nove a mais de disponibilidade que o próprio serviço[^1].

!!! tip "Dependências suaves não entram na cadeia"

    Uma dependência cuja falha o serviço consegue **tolerar** — servindo um valor em cache, um padrão ou uma página parcial — não se multiplica na disponibilidade do caminho crítico. Recomendações, contadores de visualização e o assistente de IA devem ser todos dependências *suaves* do checkout: se falharem, o checkout continua funcionando. Transformar dependências rígidas em suaves (fallbacks, caches, assíncrono) é uma habilidade de design que você vai praticar na [aula 9](../../reliability/index.md).

---

## A premissa da independência

Todas as fórmulas acima supõem que os componentes falham de forma **independente**. Falhas reais costumam ser **correlacionadas**, e a correlação destrói a fórmula do paralelo:

- Duas réplicas no **mesmo host, rack ou zona de disponibilidade** caem junto com ele.
- Duas réplicas rodando a **mesma versão com bug** quebram com a mesma entrada.
- Uma **configuração ruim** aplicada em todo lugar de uma vez quebra todas as réplicas de uma vez.
- Uma dependência compartilhada — o mesmo provedor de DNS, o mesmo certificado que expira, o mesmo banco — é um **ponto único de falha** escondido atrás de uma redundância aparente.
- Sobrecarga: quando uma réplica morre, seu tráfego vai para as outras, que podem falhar também (uma falha em cascata).

!!! example "BoxOffice — três réplicas, uma queda"

    O serviço de inventário roda 3 réplicas, cada uma 99,5% disponível sozinha: a fórmula do paralelo promete 1 − 0,005³ ≈ 99,99999%. Na prática, a pior queda do ano veio de uma versão com uma configuração errada do pool de conexões, implantada nas três réplicas em 2 minutos. As três falharam juntas, por 40 minutos, até o rollback. **A redundância não ajudou, porque a falha não era independente.** As correções não são mais réplicas, e sim *diversidade no tempo e no espaço*: deploys canário (uma réplica primeiro, observar, depois o resto), réplicas espalhadas por zonas e rollback rápido (MTTR menor).

Projetar para a independência — domínios de falha separados (zonas, regiões), implantações graduais, nenhuma dependência compartilhada escondida — é tão importante quanto acrescentar réplicas.

---

## Tempo de detecção e de failover

A redundância só ajuda depois que a falha é **detectada** e o tráfego é **movido**. Se um load balancer verifica a saúde a cada 10 s e precisa de 3 falhas seguidas para marcar uma réplica como fora, os usuários atingem a réplica com falha por até ~30 s a cada vez. Com falhas pequenas e frequentes, isso importa:

$$
\text{indisponibilidade por ano} \approx \text{falhas por ano} \times (\text{tempo de detecção} + \text{tempo de failover})
$$

Dez failovers por ano a 30 s + 30 s cada dão 10 minutos: tudo bem para 99,99% (52 minutos por ano), mas consome um quinto do orçamento. Health checks mais rápidos, novas tentativas do lado do cliente para outra réplica e drenagem de conexões reduzem esse tempo.

??? question "Pense antes: uma segunda região vale a pena?"

    A BoxOffice roda em uma região com três zonas de disponibilidade. A documentação do provedor sugere que a queda de uma região inteira é rara, mas, quando acontece, pode durar horas. Uma segunda região (ativo-passivo, com failover por DNS) dobraria aproximadamente o custo de infraestrutura. Como você decidiria?

    **Esboço de resposta**: estime o **custo esperado da indisponibilidade** contra o custo da segunda região. Se uma queda regional de ~4 h acontece mais ou menos uma vez a cada dois anos (uma premissa a validar com o histórico do seu provedor), a indisponibilidade esperada é de ~2 h/ano — quase metade das ~4,4 h/ano que uma meta de 99,95% permite, antes de qualquer outro incidente. Depois considere *quando* ela acontece: uma queda regional durante a abertura de vendas de um estádio custa ao negócio muito mais que uma às 4 da manhã de uma terça-feira. Se o SLA com os organizadores prevê multas, ou se uma abertura de vendas perdida custa mais que um ano de uma segunda região, vale a pena — e aí a parte difícil são os dados (aula 3 e aula 9), não os servidores.

!!! tip "Na entrevista"

    Ao desenhar um design de alto nível, faça o cálculo em série **em voz alta** para o caminho crítico: "a requisição atravessa cinco componentes; a 99,9% cada, isso dá cerca de 99,5%, então, para prometer 99,9% no todo, preciso de redundância em cada um e tiraria o e-mail do caminho." Depois mencione falhas correlacionadas — "réplicas em zonas diferentes, deploys canário" —, o que mostra que você sabe onde as fórmulas deixam de valer. Fale de indisponibilidade com uma janela: "quatro noves são cerca de quatro minutos por mês".

!!! warning "Armadilhas comuns"

    - **Citar uma meta sem janela**: 99,9% são 43,8 min num mês médio, mas 40,3 min em 28 dias.
    - **Ignorar a cadeia**: cada equipe cumpre sua meta e o produto perde a dele.
    - **Supor independência**: réplicas na mesma zona, na mesma versão, atrás do mesmo DNS.
    - **Contar redundância sem failover**: um standby que nunca é testado não é redundância.
    - **Perseguir noves em toda parte**: caminhos diferentes merecem metas diferentes; cinco noves para o widget de recomendações é dinheiro jogado fora.

---

## Como se conecta { #how-it-connects }

``` mermaid
flowchart LR
    MT["A = MTTF / (MTTF + MTTR)"] --> NINES["noves numa janela<br/>→ SLOs de Confiabilidade"]
    SER["série: ∏ aᵢ"] --> CHAIN["caminho crítico: borda, auth,<br/>order, inventory, provedor"]
    CHAIN --> ASYNC["tirar dependências do caminho<br/>queue + worker → Mensageria"]
    PAR["paralelo: 1 − ∏(1 − aᵢ)"] --> RED["réplicas,<br/>um segundo provedor"]
    QUO["quóruns k-de-n<br/>→ Distribuídos"] --> RED
    RED --> IND["independentes? zonas,<br/>versões, configuração"]
    IND --> DR["multi-AZ, multirregião<br/>→ Confiabilidade"]
    MT --> DET["tempo de detecção + failover<br/>health checks"]
    DET --> RED
```

**Componentes da paleta:** [`lb`](../../../reference/components/edge/index.md#lb) · [`healthcheck`](../../../reference/components/observability/index.md#healthcheck) (tempo de detecção = intervalo × falhas para marcar como fora) · [`app`](../../../reference/components/compute/index.md#app) (réplicas em paralelo, se as falhas forem independentes) · [`sql`](../../../reference/components/storage/index.md#sql) (primário + standby com failover automático) · [`payment`](../../../reference/components/external/index.md#payment) (uma dependência de 99,9%; um segundo provedor) · [`email`](../../../reference/components/external/index.md#email) (retirado do caminho crítico) · [`queue`](../../../reference/components/messaging/index.md#queue) · [`worker`](../../../reference/components/compute/index.md#worker) (o caminho assíncrono) · [`dns`](../../../reference/components/edge/index.md#dns) (failover multirregião). **Cenários:** `scale-out`, `multi-region`, `payment-system`, `notification-system`. **Continua em:** [Distribuídos — consenso](../../distributed/consensus/index.md) (quóruns), [Confiabilidade — SLOs](../../reliability/slo/index.md), [Confiabilidade — multi-AZ e multirregião](../../reliability/disaster-recovery/index.md#multi-region), [Compute — quedas do provedor](../../compute/integrations/index.md#provider-outages), [Exercício: design doc](../../../exercises/design-doc/index.md).

## Pontos-chave

- A = **MTTF / (MTTF + MTTR)**; reduzir o MTTR com automação costuma ser a alavanca mais barata.
- Cada nove é **10× menos indisponibilidade**; sempre diga a **janela**.
- Em **série**, multiplica (pior que o elo mais fraco); em **paralelo**, dá 1 − ∏(1 − aᵢ); quóruns ficam no meio.
- Melhore uma cadeia **tirando dependências rígidas** do caminho crítico, acrescentando **redundância** aos elos fracos e fazendo cada elo ter ~**um nove a mais** que a meta.
- As fórmulas supõem falhas **independentes**; falhas correlacionadas (mesma zona, mesma versão, mesma configuração) são o que de fato derruba sistemas.

---

[^1]: TREYNOR, B.; DAHLIN, M.; RAU, V.; BEYER, B. The Calculus of Service Availability. *ACM Queue*, 15(2), 2017.
[^2]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/books/){target="_blank"}. Google / O'Reilly, 2016. Chapter 3 (embracing risk).
