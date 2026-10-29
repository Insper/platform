Antes da primeira linha de código, a sua equipe combina **o que** vai construir, **de que tamanho** precisa ser, **como saberá que funciona** e **quais decisões** está tomando. Esse acordo é o design doc do marco **M1**. Ele não é escrito uma vez e esquecido: é o mapa que o projeto inteiro segue, é atualizado a cada marco, e a sua versão final (M8) é o que vocês defendem na apresentação.

!!! abstract "Objetivos"

    Com o M1 a sua equipe terá:

    - **Escolhido** uma opção de sistema e a transformado em requisitos, uma escala de projeto e uma escala de teste.
    - **Definido** SLOs com os seus SLIs e **como cada um será medido** (k6, OpenTelemetry).
    - **Estimado** a carga e **dimensionado** cada serviço com a Lei de Little e uma capacidade por instância.
    - **Desenhado** a arquitetura com componentes da paleta e **atribuído** a propriedade dos dados por serviço.
    - **Registrado** as primeiras ADRs, um registro de riscos, um esboço do plano de testes e a tabela de responsabilidades.

## O que entregar { #what-to-deliver }

**Prazo: semana 5, tag `m1`, peso 10%.** Uma seção *Design doc* no site de documentação da equipe contendo o [template de design doc do exercício](../../design-doc/index.md#templates) — com todas as seções preenchidas — **mais** os complementos do projeto abaixo. As ADRs usam o [template de ADR](../../design-doc/index.md#templates), numeradas `ADR-001`, `ADR-002`, …

Os complementos do projeto:

| Complemento | O que precisa conter |
|-|-|
| Opção e escalas | A [opção de sistema](../index.md#system-options), a sua escala de projeto e a de teste (copie a tabela e adapte-a se combinado com o professor) |
| Tabela de SLOs | Cada SLO com o seu SLI, o ponto de medição (lado do cliente no k6, gateway, serviço), a ferramenta (threshold do k6, métrica OTel, verificação SQL) e a janela de tempo |
| Planilha de estimativas | Como no [exercício de estimativas](../../estimation/index.md), para a escala de projeto **e** a de teste |
| Arquitetura | Diagrama de alto nível com **ids da paleta**, os dois fluxos principais percorridos, arestas síncronas vs assíncronas marcadas |
| Propriedade dos dados | Uma tabela: serviço → dados de que é dono → armazenamento → quem pode lê-los (e como: API, eventos) |
| Contratos de API | Link para o arquivo OpenAPI de cada serviço (mesmo que os endpoints ainda não estejam implementados) e os schemas dos eventos |
| Modelo de capacidade | Por serviço: req/s esperadas na escala de teste, capacidade suposta por instância, réplicas = ⌈λ ÷ (capacidade × 0,7)⌉, concorrência L = λ × W |
| Registro de riscos | Os principais riscos (técnicos e da equipe), probabilidade, impacto, mitigação, responsável |
| Esboço do plano de testes | Quais cenários k6 vão provar quais SLOs; quais experimentos de caos estão planejados para o game day |
| Tabela de responsabilidades | Membro → serviços → área transversal |
| Changelog | Vazio no M1; a cada marco, uma linha por mudança de design com link para a ADR |

## Critérios de aceitação { #acceptance-criteria }

- [ ] **(obrigatório)** Todas as seções do template de design doc estão preenchidas (ou marcadas "não se aplica — porque …").
- [ ] **(obrigatório)** Pelo menos **três ADRs**; temas sugeridos: o broker (Kafka vs uma fila), a consistência da escrita crítica (por exemplo, reserva de assento com `SELECT … FOR UPDATE` vs lock otimista), a estratégia de cache.
- [ ] **(obrigatório)** Tabela de SLOs com SLIs, ponto de medição, ferramenta e janela — todo SLO da escala de teste é **mensurável** com as ferramentas do curso.
- [ ] Estimativas para a escala de projeto e a de teste, com fórmulas.
- [ ] Diagrama de arquitetura com ids da paleta, cobrindo todos os [componentes obrigatórios](../index.md#mandatory-components) (mesmo que alguns cheguem em marcos posteriores — marque-os).
- [ ] Propriedade dos dados: nenhuma tabela é escrita por dois serviços.
- [ ] O modelo de capacidade dá um número de réplicas para cada serviço na escala de teste.
- [ ] Registro de riscos com pelo menos cinco riscos, cada um com mitigação e responsável.
- [ ] Tabela de responsabilidades: todo membro é dono de um serviço e de uma área transversal.
- [ ] Seção *Uso de IA*.

## Passo a passo { #step-by-step }

1. **Escolham a opção juntos** (semana 3) e leiam o seu estudo de caso e o seu cenário no playground.
2. **Escrevam primeiro os requisitos e as escalas.** Combinem o que está fora do escopo — isso protege o cronograma.
3. **Transformem cada SLO em uma medição.** "p99 de `POST /holds` < 500 ms" vira "threshold do k6 `http_req_duration{name:POST /holds}` `p(99)<500` a 100 reservas/s por 10 min". Se vocês não sabem dizer como vão medir, ainda não é um SLO.
4. **Estimem e dimensionem.** Usem as fórmulas do exercício de estimativas; tirem as capacidades por instância das suas medições do ex2 quando as tiverem, e marquem as premissas.
5. **Desenhem a arquitetura e percorram os fluxos.** Depois confiram com a tabela de componentes obrigatórios.
6. **Dividam a propriedade** dos dados e dos serviços; escrevam os contratos de API e os schemas dos eventos.
7. **Escrevam as ADRs** das decisões que são caras de mudar depois.
8. **Façam um protótipo no playground** (opcional, mas recomendado) e anexem o JSON exportado.
9. **Revisem em equipe** e depois peçam a outra equipe que leia por 10 minutos e anote as suas perguntas — respondam-nas no documento.

!!! tip "Experimente — prototipe antes de construir"

    Parta do cenário `blank` no [playground completo](../../../../playground/index.md), monte a sua arquitetura com os mesmos ids da paleta do seu diagrama, aplique a carga da escala de teste e veja qual nó satura primeiro. Exporte o JSON e versione-o como `docs/design/playground.json`. A visão compacta abaixo apenas executa um design; monte o seu no playground completo.

<div class="sdp" data-scenario="blank" data-mode="compact" data-height="520"></div>

### Uma linha de SLO resolvida (BoxOffice) { #a-worked-slo-row-boxoffice }

| SLO | SLI | Medido em | Ferramenta | Janela |
|-|-|-|-|-|
| p99 da reserva de assento < 500 ms a 100 reservas/s | Latência de `POST /holds` | Cliente (k6) | threshold do k6 `http_req_duration{name:POST /holds}` | 10 min em regime |
| Nenhuma venda duplicada | Assentos com mais de um pedido confirmado | Banco de dados | Verificação SQL depois de cada teste | Teste inteiro |
| E-mail do ingresso p95 < 30 s | Tempo do pedido confirmado ao e-mail registrado | Serviços | Duração de span OTel / timestamps no SQL | Teste inteiro |
| Taxa de erro < 0,1% (sem contar 429) | Não 2xx exceto 429 ÷ todas as requisições | Gateway | Métrica OTel `http.server.request.duration` por status | 10 min em regime |

## Templates

Os complementos do projeto, para acrescentar ao template de design doc do exercício:

=== "English"

    ~~~markdown
    ## Project additions

    ### Option and targets
    Option: ... · Design target: ... · Test target: ... (agreed on <date>)

    ### SLOs
    | SLO | SLI | Measured at | Tool | Window |
    |-|-|-|-|-|

    ### Capacity model (test target)
    | Service | λ (req/s) | W (s) | L = λW | Capacity/instance | Replicas |
    |-|-|-|-|-|-|

    ### Data ownership
    | Service | Owns | Store | Read by others via |
    |-|-|-|-|

    ### API contracts and events
    - <service>: link to openapi.yaml
    - Events: <name> v1 — fields ...

    ### Risk register
    | # | Risk | Likelihood | Impact | Mitigation | Owner |
    |-|-|-|-|-|-|

    ### Test plan sketch
    | SLO | k6 scenario | Chaos experiment |
    |-|-|-|

    ### Ownership
    | Member | Services | Cross-cutting area |
    |-|-|-|

    ### Changelog
    | Milestone | Change | ADR |
    |-|-|-|
    ~~~

=== "Português"

    ~~~markdown
    ## Complementos do projeto

    ### Opção e escalas
    Opção: ... · Escala de projeto: ... · Escala de teste: ... (combinada em <data>)

    ### SLOs
    | SLO | SLI | Medido em | Ferramenta | Janela |
    |-|-|-|-|-|

    ### Modelo de capacidade (escala de teste)
    | Serviço | λ (req/s) | W (s) | L = λW | Capacidade/instância | Réplicas |
    |-|-|-|-|-|-|

    ### Propriedade dos dados
    | Serviço | É dono de | Armazenamento | Outros leem via |
    |-|-|-|-|

    ### Contratos de API e eventos
    - <serviço>: link para o openapi.yaml
    - Eventos: <nome> v1 — campos ...

    ### Registro de riscos
    | # | Risco | Probabilidade | Impacto | Mitigação | Responsável |
    |-|-|-|-|-|-|

    ### Esboço do plano de testes
    | SLO | Cenário k6 | Experimento de caos |
    |-|-|-|

    ### Responsabilidades
    | Membro | Serviços | Área transversal |
    |-|-|-|

    ### Changelog
    | Marco | Mudança | ADR |
    |-|-|-|
    ~~~

## Rubrica { #rubric }

Níveis conforme definidos em [Como os exercícios são avaliados](../../index.md#how-the-exercises-are-graded).

| Critério | I | D | C | B | A |
|-|-|-|-|-|-|
| Completude **(obrigatório)** | Não entregue | Faltam seções do template ou complementos | Tudo presente | — | — |
| Requisitos, escalas e SLOs **(obrigatório)** | Ausentes | SLOs não mensuráveis | SLOs mensuráveis com SLI, ponto, ferramenta e janela | SLOs priorizados e ligados à experiência do usuário | Orçamento de erros e o que a equipe faz quando ele se esgota |
| Estimativas e capacidade | Ausentes | Inconsistentes | As duas escalas estimadas; réplicas por serviço | Capacidades a partir de medições próprias (ex2) | Sensibilidade: a estimativa que mudaria o design |
| Arquitetura e dados | Ausentes | Diagrama sem fluxos ou sem propriedade | Ids da paleta, dois fluxos, tabela de propriedade, contratos | Cada componente justificado; fronteiras síncrono/assíncrono argumentadas | Caminho de evolução marco a marco |
| ADRs **(obrigatório)** | Nenhuma | Menos de três | Três com opções e consequências | Negativos honestos e critérios de confirmação | ADRs reutilizadas e atualizadas ao longo do projeto (changelog) |
| Riscos e plano de testes | Ausentes | Genéricos | Cinco riscos com responsáveis; relação SLO ↔ teste | Riscos incluem equipe/cronograma com mitigações reais | Um protótipo cedo elimina o principal risco técnico |

## FAQ

??? question "Precisamos implementar tudo o que está no diagrama?"

    Vocês precisam implementar os [componentes obrigatórios](../index.md#mandatory-components). O diagrama pode mostrar mais (por exemplo, uma CDN ou uma segunda região) se isso estiver claramente marcado como "só na escala de projeto" e com custo no M8.

??? question "Podemos mudar o design depois do M1?"

    Sim — e vão mudar. Registrem cada mudança no changelog com uma ADR (nova, ou substituindo uma antiga). Um design doc que nunca muda depois da semana 5 geralmente significa que a equipe parou de lê-lo.

??? question "Ainda não sabemos a capacidade de uma instância."

    Suponham a partir do [cheat sheet de números](../../../reference/numbers/index.md) ou dos labs, marquem como premissa e troquem pela sua medição no M3. Mostrar como o número de réplicas mudou é um bom sinal.

??? question "Quão detalhada precisa ser a API?"

    O suficiente para outra equipe chamar o seu serviço: caminhos, métodos, campos principais, códigos de status, chaves de idempotência. Um arquivo OpenAPI gerado a partir de stubs basta no M1.

??? question "O que é um bom risco?"

    Específico e acionável: "ninguém da equipe já rodou Kafka no Kubernetes — mitigação: protótipo na semana 6, alternativa com uma fila gerenciada, responsável: Ana". "O projeto pode atrasar" não é uma entrada de risco.
