Saber o que *é* um cache, uma fila ou um circuit breaker não é o mesmo que saber **de quais um sistema precisa, onde e quantos**. Neste exercício você recebe três designs que falham sob carga no [System Design Playground](../../../playground/index.md) — uma venda relâmpago da BoxOffice, uma cascata causada por uma dependência lenta e um assistente de IA lento e caro demais — e precisa fazer cada um **atingir suas metas dentro do orçamento**, explicar por que o seu design funciona com as fórmulas do curso e mostrar que ele continua funcionando quando os dados são lançados de novo.

!!! abstract "Objetivos de aprendizagem"

    Ao final deste exercício você será capaz de:

    - **Diagnosticar** um design que falha a partir das métricas e do relatório de teste (qual meta falha, qual nó é o gargalo, por quê).
    - **Compor** componentes da paleta e ajustar seus parâmetros para atingir metas de latência, erros, disponibilidade e custo.
    - **Justificar** números de réplicas, timeouts e tamanhos de cache com contas de utilização, Lei de Little, taxa de acerto e custo.
    - **Avaliar** robustez: distinguir um design que passa por sorte de um que passa sob falhas aleatórias.
    - **Comparar** alternativas e defender um trade-off entre custo e confiabilidade.

## Contexto

O playground simula um design sob um perfil de carga (o mesmo vocabulário do k6: `smoke`, `load`, `stress`, `spike`, `soak`, `breakpoint`, `chaos`). O que você precisa para este exercício (o manual completo está na [página do playground](../../../playground/index.md), e as lições de cada cenário no [guia de cenários](../../../playground/scenarios/index.md)):

- **Cenário** — um design inicial mais um enunciado, um perfil de carga e **metas** (por exemplo, p99 abaixo de um limite, taxa de erro, disponibilidade, atraso do consumidor), incluindo uma **meta de custo** (US$/mês, preços marcados como *ilustrativos*). O enunciado e as metas aparecem no inspetor quando nada está selecionado.
- **Seed** — todo número aleatório (chegadas, latências, falhas) vem de um único gerador com semente. **Mesma seed + mesmo design + mesmo perfil ⇒ execução idêntica.** A seed fica na barra de ferramentas; o botão 🎲 sorteia uma nova.
- **Nível de caos** — `off`, `low`, `medium`, `high`: com que frequência acontecem eventos aleatórios (queda de réplicas, degradação de latência de uma dependência, picos de tráfego, chaves quentes, cache esvaziado, queda de zona, queda de terceiros, deploy ruim…).
- **Relatório** — quando uma execução termina, a aba *Report* mostra o perfil, a seed, a duração, p50/p95/p99/p999, taxa de erro, disponibilidade, custo, o **gargalo** (o primeiro nó a saturar, com uma explicação), os eventos que aconteceram e **passou/falhou para cada meta**.
- **Exportar / importar JSON** — a barra de ferramentas salva o design atual como um arquivo JSON e o carrega de volta. Há também um *link de compartilhamento* (o design codificado na URL depois de `#sdp=`).

Projete no **playground completo** (paleta + inspetor). As incorporações desta página são *compactas*: mostram o cenário e o executam, mas não permitem acrescentar componentes.

## Tarefa

### Parte A — Três desafios

Para cada cenário abaixo, parta do cenário como ele é carregado (**não** mude o perfil, a carga-alvo, a proporção de leituras nem as metas) e mude o **design** até que **todas as metas passem** com a seed padrão do cenário e o caos definido pelo cenário.

#### Desafio 1 — `flash-sale`

A venda da BoxOffice às 10:00: um pico de fãs atinge o catálogo e o inventário de assentos, e os pagamentos vão para um provedor externo.

**Experimente:** aperte ▶ e observe qual nó fica vermelho primeiro, e quando. Veja o relatório: qual meta falha, e o que diz a explicação do gargalo? Depois pergunte: quantas requisições por segundo o banco do inventário realmente aceita, e quem decide quantos fãs chegam até ele?

<div class="sdp" data-scenario="flash-sale" data-mode="compact" data-height="520"></div>

Pontos para pensar (não é uma receita): o que pode ser servido sem tocar no inventário (conteúdo estático, o catálogo, a disponibilidade de assentos que pode estar alguns segundos desatualizada); que taxa de admissão o inventário sustenta (utilização abaixo de ~0,7); o que acontece com os fãs ainda não admitidos (uma sala de espera é uma fila, e uma fila tem backlog); onde vai parar a latência do provedor de pagamento.

#### Desafio 2 — `cascading-failure`

Uma dependência de terceiros fica lenta; sem timeouts, as threads se acumulam e um serviço saudável cai.

**Experimente:** execute e observe a utilização dos servidores de aplicação *e* das suas threads. A CPU está baixa, mas as requisições falham — por quê? Aplique a Lei de Little: quanto vale `L = λ × W` quando `W` passa de 150 ms para 3 s?

<div class="sdp" data-scenario="cascading-failure" data-mode="compact" data-height="520"></div>

Pontos para pensar: um valor de timeout derivado do p99 normal da dependência (não um chute); o que um circuit breaker traz e quanto custa; se um fallback (resposta degradada) é aceitável para essa chamada; se retentativas ajudam ou pioram (veja [`retry-storm`](../../../playground/scenarios/index.md)).

#### Desafio 3 — `ai-assistant`

O assistente de suporte da BoxOffice: um orquestrador chama um LLM através de um gateway, recupera contexto de uma memória (RAG) e chama ferramentas. Ele é lento e caro.

**Experimente:** execute e abra o indicador de custo. Para onde vai o dinheiro? Quantas chamadas sequenciais ao LLM uma requisição de usuário faz, e o que isso causa na latência?

<div class="sdp" data-scenario="ai-assistant" data-mode="compact" data-height="520"></div>

Pontos para pensar: o número de passos do agente (cada passo é uma chamada sequencial ao LLM); um cache semântico no gateway de LLM (que taxa de acerto é realista para perguntas de suporte?); rotear perguntas simples para um modelo mais barato; onde fica a safety mesh no caminho; tokens × preço = custo por requisição.

### Parte B — Robustez com aleatoriedade

Um design que passa com uma seed pode passar por sorte. Execute o seu design **final** de cada desafio com **5 seeds** e nível de caos **`medium`**, mantendo todo o resto como na Parte A:

- As seeds são publicadas pelo professor no Blackboard. Se não forem publicadas, use os cinco últimos dígitos da sua matrícula `S` e as seeds `S, S+1, S+2, S+3, S+4`.
- Um desafio é **robusto** quando todas as metas passam em **pelo menos 4 das 5 seeds**.
- Para cada seed que falhar, leia o log de eventos e explique o que aconteceu (qual evento aleatório, qual meta, por que o seu design não o absorveu).

A incorporação abaixo mostra o mesmo cenário com uma seed fixa e caos médio — as configurações que você vai usar no playground completo:

<div class="sdp" data-scenario="flash-sale" data-mode="compact" data-height="520" data-seed="12345" data-chaos="medium"></div>

### A física não muda

Você muda a **arquitetura**, não as leis da natureza. A menos que você justifique no texto (e a justificativa seja aceita), **não** edite:

- capacidade por réplica, tempo de serviço (`latencyMs`) e variabilidade (`sigma`) de qualquer tipo de componente;
- preços, e a latência, a cota (`rateLimit`) ou o comportamento de queda dos componentes externos (`payment`, `thirdparty`, `email`) e do LLM;
- as metas, o perfil, o RPS-alvo e a proporção de leituras do cenário.

Taxas de acerto de cache e CDN acima de **0,95**, e de cache semântico acima de **0,4**, precisam de justificativa baseada na carga (popularidade das chaves, repetição das perguntas).

!!! warning "O botão *Show a possible solution*"

    Cada cenário tem uma solução de referência. Você pode carregá-la e estudá-la. Uma entrega **idêntica (ou quase idêntica) à solução de referência fica limitada a C**. Para chegar a B ou A, o design precisa ser seu e ser **mais barato** que a referência com as mesmas metas ou **mais robusto** (passa em mais seeds em `medium`, ou passa em `high`), e você precisa explicar por quê.

## Requisitos

- [ ] **(obrigatório)** Para cada um dos três desafios, o JSON exportado é importado no playground e, com a seed padrão, **todas as metas passam** (inclusive a de custo).
- [ ] **(obrigatório)** As regras da física acima são respeitadas (ou cada exceção é justificada).
- [ ] **(obrigatório)** Parte B: cada desafio passa em **≥ 4 de 5 seeds** com caos `medium`; uma tabela mostra os resultados seed × meta.
- [ ] Para cada desafio, o relatório **inicial** (falhando) e o **final** (passando), ambos mostrando a seed.
- [ ] Uma justificativa por desafio com: diagnóstico, mudanças numeradas com o efeito medido (registro de iterações), as contas que justificam réplicas / timeouts / cache (utilização, Lei de Little, taxa de acerto, custo) e pelo menos uma alternativa testada ou descartada.
- [ ] Para cada seed que falhou na Parte B, uma explicação a partir do log de eventos.
- [ ] Uma comparação com a solução de referência (custo, robustez, estrutura).
- [ ] Seção *Uso de IA* (veja a [política](../index.md#use-of-ai-tools)).

## Entregáveis

No seu repositório (tag `ex6`):

```text
playground/
├── flash-sale.json
├── cascading-failure.json
├── ai-assistant.json
└── reports/
    ├── flash-sale-initial.png
    ├── flash-sale-final-seed<seed>.png
    ├── flash-sale-medium-seed<seed>.png   # one per seed of Part B
    └── ...                                # same for the other two scenarios
```

Os relatórios podem ser capturas de tela (`.png`) ou o texto do relatório copiado para um arquivo `.txt` — o que importa é que **a seed, o perfil, o nível de caos e os resultados das metas estejam visíveis**. No site da sua documentação, uma página `playground-design` com uma seção por desafio e a tabela da Parte B. Links de compartilhamento (`#sdp=…`) ao lado de cada design são um extra bem-vindo.

## Passo a passo

1. **Leia o enunciado e as metas.** Anote-os na sua página: meta, limite e o orçamento.
2. **Execute o cenário como ele está** e guarde o relatório inicial. Anote a primeira meta que falha e o gargalo apontado.
3. **Formule uma hipótese com números.** Exemplo: "o BD do inventário recebe 4.000 escritas/s e sua capacidade é 2.500 escritas/s, então ρ = 1,6: não funciona com latência nenhuma." Ou: "W passou de 0,15 s para 3 s, então cada réplica precisa de 20× mais threads."
4. **Mude uma coisa de cada vez** e execute de novo com a **mesma seed**. Mantenha um registro de iterações: mudança → efeito na meta que falhava → efeito no custo. Como a execução é determinística, uma diferença entre duas execuções é causada pela sua mudança.
5. **Pare quando todas as metas passarem** e então **tente cortar custo**: menos réplicas, componentes menores, autoscaling em vez de capacidade fixa. Cada corte precisa manter todas as metas passando.
6. **Exporte o JSON**, importe-o de volta em uma página nova e execute de novo para conferir que o relatório é o mesmo.
7. **Parte B:** coloque o caos em `medium`, execute as 5 seeds, preencha a tabela, leia o log de eventos de cada falha. Se menos de 4 passarem, melhore o design (redundância, autoscaling, timeouts, fallbacks) e **refaça a Parte A** — o design final precisa passar nas duas partes.
8. **Compare com a solução de referência** e escreva a justificativa.

!!! example "Conta resolvida — dimensionando um nó"

    Suponha que o relatório mostre que o nó `sql` recebe 1.800 req/s e uma réplica atende 1.000 req/s. Com utilização-alvo de 0,7, `réplicas = ⌈1.800 ÷ (1.000 × 0,7)⌉ = 3`. Se um cache na frente dele tiver taxa de acerto `h = 0,9`, o banco recebe `(1 − 0,9) × 1.800 = 180 req/s` e uma réplica basta (`ρ = 0,18`) — se o cache compensa passa a ser uma questão de custo e da consistência que você pode aceitar.

## Templates

=== "English"

    ~~~markdown
    ## Challenge: <scenario id>

    **Goals (from the brief):** p99 < ... ms · error rate < ...% · ... · cost < US$ .../month

    ### 1. Diagnosis (initial run, seed <seed>)
    - Failing goals: ...
    - Reported bottleneck: <node> — <explanation>
    - My reading of the numbers: λ = ... req/s, μ = ... req/s, ρ = ...; L = λ × W = ...

    ### 2. Iteration log
    | # | Change | Failing goal before → after | Cost before → after | Why it worked (or not) |
    |-|-|-|-|-|
    | 1 | | | | |
    | 2 | | | | |

    ### 3. Final design
    - Diagram: (screenshot or `export Mermaid`)
    - Final report (seed <seed>): all goals pass — p99 ..., errors ..., availability ..., cost ...
    - Sizing arithmetic: ...

    ### 4. Alternatives
    | Alternative | Result | Why rejected |
    |-|-|-|

    ### 5. Robustness (chaos = medium)
    | Seed | Goal 1 | Goal 2 | Goal 3 | Cost | Pass? | Events that hurt |
    |-|-|-|-|-|-|-|
    | | | | | | | |
    Passed in .../5 seeds. Explanation of each failure: ...

    ### 6. Compared with the reference solution
    Cost: ... vs ... · Robustness: ... vs ... · Main structural difference: ...
    ~~~

=== "Português"

    ~~~markdown
    ## Desafio: <id do cenário>

    **Metas (do enunciado):** p99 < ... ms · taxa de erro < ...% · ... · custo < US$ .../mês

    ### 1. Diagnóstico (execução inicial, seed <seed>)
    - Metas que falham: ...
    - Gargalo apontado: <nó> — <explicação>
    - Minha leitura dos números: λ = ... req/s, μ = ... req/s, ρ = ...; L = λ × W = ...

    ### 2. Registro de iterações
    | # | Mudança | Meta que falhava antes → depois | Custo antes → depois | Por que funcionou (ou não) |
    |-|-|-|-|-|
    | 1 | | | | |
    | 2 | | | | |

    ### 3. Design final
    - Diagrama: (captura de tela ou `export Mermaid`)
    - Relatório final (seed <seed>): todas as metas passam — p99 ..., erros ..., disponibilidade ..., custo ...
    - Contas de dimensionamento: ...

    ### 4. Alternativas
    | Alternativa | Resultado | Por que foi descartada |
    |-|-|-|

    ### 5. Robustez (chaos = medium)
    | Seed | Meta 1 | Meta 2 | Meta 3 | Custo | Passou? | Eventos que atrapalharam |
    |-|-|-|-|-|-|-|
    | | | | | | | |
    Passou em .../5 seeds. Explicação de cada falha: ...

    ### 6. Comparação com a solução de referência
    Custo: ... vs ... · Robustez: ... vs ... · Principal diferença estrutural: ...
    ~~~

## Rubrica

Níveis conforme definidos em [Como os exercícios são avaliados](../index.md#how-the-exercises-are-graded). O professor reimporta seus arquivos JSON e os executa de novo com as seeds que você informar.

| Critério | I | D | C | B | A |
|-|-|-|-|-|-|
| Metas com a seed padrão **(obrigatório)** | Não entregue, ou o JSON não importa | Uma meta falha em pelo menos um desafio | Todas as metas passam nos três desafios | — | — |
| Regras da física **(obrigatório)** | Metas atingidas editando a física | Edições sem justificativa | Respeitadas | — | Exceção justificada e bem argumentada |
| Robustez (Parte B) **(obrigatório)** | Não feita | < 4/5 seeds em algum desafio | ≥ 4/5 seeds em todos os desafios | Cada falha explicada pelo log de eventos | 5/5 em tudo, ou passa em ≥ 4/5 com `high` |
| Eficiência de custo | — | Acima do orçamento | Dentro do orçamento | Claramente abaixo do orçamento, cortes justificados | Mais barato que a solução de referência com as mesmas metas |
| Justificativa com números | — | Só narrativa | Diagnóstico + registro de iterações | Contas de utilização / Lei de Little / taxa de acerto / custo justificam o dimensionamento | Prevê um resultado antes de executar e confere a previsão |
| Originalidade e alternativas | Copiado | Idêntico à referência (limite C) | Uma alternativa discutida | Design próprio, alternativas comparadas | Uma percepção que a solução de referência não tem |

## FAQ

??? question "Posso mudar o perfil de carga, o RPS-alvo ou as metas?"

    Não. Eles definem o problema. Você muda apenas o design: componentes, conexões e seus parâmetros (dentro das regras da física).

??? question "Meu design passa com a seed 42 mas falha com a 43. O simulador está com defeito?"

    Provavelmente não. Seeds diferentes significam chegadas, latências e eventos aleatórios diferentes. Veja o log de eventos da execução que falhou: uma réplica caiu e só sobrou uma, uma chave quente, uma dependência lenta sem timeout… É exatamente disso que trata a Parte B.

??? question "Se eu executar a mesma seed duas vezes, recebo o mesmo relatório?"

    Sim — mesma seed, mesmo design, mesmo perfil e mesmo nível de caos dão uma execução idêntica. É isso que dá sentido ao seu registro de iterações e permite ao professor reproduzir seus resultados. Se aparecer uma diferença, confira se o design é mesmo o mesmo (importe o JSON de novo).

??? question "Posso simplesmente subir a taxa de acerto do cache para 0,99?"

    Não sem um motivo. A taxa de acerto depende da carga (o quão concentrada é a popularidade das chaves, com que frequência os dados mudam). Acima de 0,95 para caches e CDNs, ou acima de 0,4 para um cache semântico, você precisa justificar — caso contrário é editar a física.

??? question "Onde fica salvo o meu design? Fechei a aba."

    O playground salva automaticamente o design atual de cada cenário no seu navegador, mas o armazenamento do navegador pode ser apagado. **Exporte o JSON com frequência** e faça commit dos arquivos.

??? question "Acho que o simulador tem um bug."

    Envie ao professor o JSON, a seed, o perfil e o nível de caos, e descreva o que você esperava e o que viu. Se for um bug, o exercício será ajustado para todos.

??? question "Posso usar IA para encontrar um design?"

    Você pode discutir ideias com uma IA e deve declarar o uso. Mas a verificação oral vai pedir que você mude um parâmetro e preveja o efeito antes de executar — só o seu próprio entendimento de utilização, Lei de Little e custos resolve isso.
