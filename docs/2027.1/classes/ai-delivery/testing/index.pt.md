A suíte de testes da BoxOffice cresceu para cerca de 4.000 testes. Uma execução completa do CI leva 25 minutos, mais ou menos uma execução em cada trinta falha por motivos que ninguém entende e passa quando repetida, e o serviço `inventory` — aquele em que um bug significa assentos vendidos duas vezes — é o que tem menos testes, porque sua lógica é a mais difícil de testar. A IA pode escrever testes, fazer a triagem de falhas e escolher quais testes rodar. Cada uma dessas coisas é útil, e cada uma tem uma armadilha: um teste gerado pode **proteger um bug**, um bot de triagem pode **esconder uma falha real** atrás da palavra "flaky", e um seletor de testes pode **pular justamente o teste que importava**. Esta página trata de colher o benefício sem cair nas armadilhas.

---

## Onde a IA ajuda nos testes { #where-ai-helps-in-testing }

| Tarefa | O que a IA faz | Como você sabe que funcionou | Armadilha |
|---|---|---|---|
| **Testes unitários** | Escreve testes para uma classe ou um diff | O mutation score sobe; os testes passam repetidamente; revisão humana | Os testes afirmam o comportamento atual, bugs incluídos |
| **Testes de contrato** | Rascunha contratos do consumidor a partir do código e do OpenAPI | A verificação no provedor passa; uma mudança incompatível é detectada | O contrato copia a implementação, não o acordo |
| **Testes baseados em propriedades** | Propõe invariantes e geradores | As propriedades encontram um bug plantado | Propriedades vazias (`true` para qualquer entrada) |
| **Scripts de teste de carga** | Gera scripts k6 a partir do OpenAPI e de amostras de tráfego | O smoke test passa; o modelo de carga é revisado | Mix irreal, sem think time, modelo fechado por acidente |
| **Triagem de testes flaky** | Classifica uma falha a partir dos logs e do histórico | A classificação concorda com as reexecuções e com os humanos | Bugs reais rotulados como "flaky" e postos em quarentena |
| **Seleção de testes** | Escolhe os testes relevantes para uma mudança | Poucas falhas escapadas em comparação com execuções completas | O teste pulado era o relevante |
| **Dados sintéticos** | Gera eventos, locais e usuários falsos e realistas | Cobre casos de borda; não contém dados pessoais reais | Vazar dados de produção em prompts; dados não reproduzíveis |

---

## Testes unitários gerados e o problema do oráculo { #generated-unit-tests-and-the-oracle-problem }

Um teste tem duas partes: as **entradas** (arrange, act) e o **oráculo** — o resultado esperado que decide entre passar e falhar. Os modelos são excelentes na primeira parte: enumeram casos de borda (lista vazia, null, datas-limite, o 61º minuto) mais rápido que as pessoas. A segunda parte é o problema. Para saber que uma reserva de assento deve durar **10** minutos, o modelo precisa do *requisito*; tendo apenas o código, ele lê `plusMinutes(8)` e escreve `isEqualTo(now.plusMinutes(8))`. O teste passa e agora protege o bug. Esse é o **problema do oráculo de testes**, um tema antigo da pesquisa em testes de software[^1], e os testes gerados o tornam agudo.

Para que os testes gerados servem de forma confiável:

- **Testes de caracterização** antes de uma refatoração: fixar o comportamento atual, refatorar, confirmar que nada mudou. Aqui, "afirmar o comportamento atual" é exatamente o objetivo.
- **Testes de regressão para a correção de um bug**, quando o prompt inclui o relato do bug e o comportamento esperado.
- **Casos de borda** que um humano depois confere contra a especificação.

O que eles não conseguem fazer é decidir o que é *correto*. Requisitos, exemplos na issue ou um ADR precisam estar no contexto — e um humano precisa ler as asserções.

### A cobertura mente; o teste de mutação não (tanto) { #coverage-lies-mutation-testing-does-not-as-much }

A cobertura de linhas mede quais linhas **executaram** durante os testes. Um teste que chama todos os métodos e não afirma nada tem cobertura total e não pega bug algum. O **teste de mutação** mede se os testes **percebem** uma mudança: a ferramenta cria *mutantes* — pequenas modificações como `<` → `<=`, `+` → `-`, uma chamada de método removida, um retorno constante — e roda os testes contra cada um. Um mutante é **morto** se algum teste falhar; o **mutation score** é mortos ÷ total. Mutantes sobreviventes apontam para comportamentos que nenhum teste verifica. A ideia é antiga (DeMillo, Lipton e Sayward, 1978); ferramentas como o [PIT](https://pitest.org){target="_blank"} a tornam prática na JVM[^2].

``` diagram-sim
flowchart LR
    cls["Classe alterada<br/>HoldService"] --> base["PIT, testes existentes<br/>baseline 41 %"]
    base --> gen["Modelo escreve testes<br/>(classe + requisitos + vizinhos)"]
    gen --> run{"compila e passa duas vezes?"}
    run -->|"não: erros"| gen
    run -->|"sim"| pit["PIT, testes existentes + novos"]
    pit --> better{"score ≥ baseline + 5 p.p.?"}
    better -->|"não: mutantes sobreviventes"| gen
    better -->|"sim"| review["PR em rascunho → humano lê as asserções"]
```

O loop acima devolve ao modelo os **mutantes sobreviventes** ("linha 42: a fronteira condicional alterada em `isExpired()` sobreviveu") — a abordagem que a Meta relatou para gerar testes voltados a classes específicas de falhas[^3]. Ele transforma um pedido vago ("escreva mais testes") em um pedido preciso ("escreva um teste que falhe se este `<` virar `<=`").

!!! example "No código do BoxOffice: testes mantidos só se matam mutantes (lab 13)"

    O [Hands-on 13 — Testes](../../../hands-on/13/tests/index.md) constrói este loop para o `CatalogService` do `catalog`, um primeiro alvo menor que o `HoldService`. Uma classe de teste gerada só é mantida se compila, passa **duas vezes** seguidas (um teste instável falha na segunda execução), não contém nenhuma das construções proibidas (`Thread.sleep`, `@Disabled`, um contexto Spring) e aumenta o score do PIT em pelo menos 5 pontos percentuais; senão, os erros ou os mutantes sobreviventes voltam ao modelo, em no máximo 3 tentativas, e um arquivo de teste não comprovado é apagado. A baseline do lab: o PIT gerou 18 mutantes e os testes existentes mataram 4 (22%). Uma execução com o `qwen2.5-coder-16k` local foi **rejeitada** depois de três tentativas — métodos inventados, testes que lançam exceção — e isso é o gerador funcionando: nada sem comprovação ficou para trás.

    ``` { .python title=".github/ai/gen_tests.py (limits, and the accept-or-retry loop)" }
    --8<-- "docs/2027.1/hands-on/13/code/.github/ai/gen_tests.py:22:25,125:147"
    ```

!!! warning "Teste de mutação é caro"

    Cada mutante executa de novo (parte da) suíte de testes. Em um serviço inteiro, uma execução de mutação pode levar muito mais tempo que o build normal. Mire nas **classes alteradas** de um PR, rode **sob demanda** ou à noite e use análise incremental quando a ferramenta suportar.

---

## Testes de contrato { #contract-tests }

Em um sistema de microsserviços, as falhas de teste mais caras acontecem **entre** serviços: o `order` espera que o `inventory` retorne `409 Conflict` para uma reserva expirada; o `inventory` muda para `410 Gone`. **Testes de contrato orientados ao consumidor** (Pact, Spring Cloud Contract) capturam o que cada consumidor realmente usa, e o build do provedor verifica que ele ainda satisfaz todos os contratos.

A IA ajuda a rascunhá-los: com o código de cliente do consumidor e o documento OpenAPI do provedor, um modelo escreve as interações (`POST /inventory/holds/{id}/confirm` → `200` ou `409`) muito mais rápido que uma pessoa. A armadilha: se o modelo derivar o contrato da **implementação do provedor**, o contrato descreve o que o provedor faz hoje — não o que o consumidor precisa — e não verifica nada. Gere a partir do lado do **consumidor** e deixe que a verificação no provedor (determinística) seja o juiz.

---

## Testes baseados em propriedades { #property-based-tests }

Testes baseados em exemplos verificam poucas entradas; **testes baseados em propriedades** enunciam um invariante e deixam um gerador tentar centenas de entradas, reduzindo qualquer falha a um exemplo mínimo. Eles se encaixam naturalmente nas partes da BoxOffice em que bugs são caros:

```java title="services/inventory/src/test/java/boxoffice/inventory/SeatMapProperties.java"
class SeatMapProperties {

    @Property
    void seatsAreNeverDoubleBooked(@ForAll("operations") List<SeatOperation> ops) {
        SeatMap map = new SeatMap(Venue.small());           // 100 seats
        ops.forEach(op -> op.applyTo(map));                  // holds, confirms, expiries, releases
        assertThat(map.sold() + map.held() + map.available()).isEqualTo(100);
        assertThat(map.soldSeats()).doesNotHaveDuplicates();
    }

    @Provide
    Arbitrary<List<SeatOperation>> operations() {
        return SeatOperation.arbitrary().list().ofMaxSize(200);
    }
}
```

O exemplo usa o [jqwik](https://jqwik.net){target="_blank"} para JUnit 5. Os modelos são bons em **propor invariantes** a partir de uma descrição do domínio ("vendidos + reservados + disponíveis = capacidade", "um assento confirmado nunca é liberado por expiração") e em escrever geradores. Duas verificações os mantêm honestos: plante um bug e confirme que a propriedade falha (uma propriedade que nunca falha pode ser vazia), e leia cada invariante contra as regras do domínio.

---

## Scripts de teste de carga a partir do OpenAPI { #load-test-scripts-from-openapi }

Todo serviço da BoxOffice publica um documento OpenAPI. Um modelo consegue transformá-lo — junto com uma amostra de logs de acesso reais — em um script k6 com endpoints, payloads e verificações realistas em segundos. O que ele não consegue saber é o **modelo de carga**: o mix de requisições (95% de leituras do catálogo durante uma abertura de vendas), o processo de chegada (modelo aberto com rampa, e não um número fixo de usuários em loop), o think time e a distribuição dos dados (todo mundo quer os mesmos 500 assentos da primeira fila). Essas decisões vêm da [aula de desempenho](../../performance/index.md) e das suas medições, e um script gerado que usa silenciosamente um modelo fechado sem think time mede o sistema errado.

Um fluxo seguro: gere o script, **revise o bloco de cenário** (executor, taxas, limiares) à mão, rode um smoke test e mantenha o script em `load/` como qualquer outro código.

---

## Triagem de testes flaky { #flaky-test-triage }

Um **teste flaky** passa e falha com o mesmo código. A instabilidade de testes é um problema grande e bem documentado no CI da indústria: o Google relatou que uma fração significativa de seus testes já havia apresentado comportamento flaky, e que isso era um custo importante do seu sistema de CI[^4]. Quando um build fica vermelho, alguém precisa decidir: regressão real, teste quebrado, problema de infraestrutura ou flake?

Um modelo que lê o log da falha e o histórico consegue classificar rapidamente — mas os **sinais determinísticos** devem vir primeiro, porque são baratos e confiáveis:

| Sinal | Fonte | Sugere |
|---|---|---|
| Passa ao reexecutar o mesmo commit | Reexecução no CI | Flaky (ou infraestrutura) |
| Taxa de falha deste teste nos últimos 30 dias na `main` | Base de histórico de testes | Flaky se intermitente; regressão se começou com um commit |
| Falha só em um tipo de runner / horário do dia | Metadados do CI | Infraestrutura, disputa por recursos, bugs de fuso horário |
| Falha em código tocado pelo PR | Diff vs. stack trace | Regressão real |
| `Connection refused`, `OOMKilled`, timeouts do registry | Padrões no log | Infraestrutura |

O trabalho do LLM é a parte difícil de fazer com regras: ler um log de 2.000 linhas, encontrar o primeiro erro significativo, relacioná-lo ao diff e escrever uma explicação curta com uma categoria proposta. Sua saída é um **rótulo com evidências**, não uma ação:

```json
{
  "category": "test-bug",
  "confidence": "medium",
  "evidence": "HoldExpiryTest.expiresAfterTenMinutes uses Instant.now() twice; fails when the clock crosses a second boundary (3 of 412 runs on main in 30 days, no code change).",
  "suggested_action": "Inject a fixed Clock; until then, quarantine with an owner and a ticket."
}
```

!!! warning "Quarentena é uma decisão com um responsável"

    Mover um teste para a quarentena (ele continua rodando, mas não bloqueia) o esconde de todos. A política — não o modelo — decide quando um teste pode ir para a quarentena (por exemplo: falhou e passou no mesmo commit pelo menos duas vezes em uma semana), todo teste em quarentena ganha um responsável e um ticket, e a quarentena expira. Um modelo que rotula uma condição de corrida real nas reservas de assentos como "flaky" não pode ter o poder de silenciá-la.

---

## Seleção de testes { #test-selection }

Rodar todos os 4.000 testes a cada push custa 25 minutos; a maioria deles não pode ser afetada por uma mudança de uma linha no `notification`. A **análise de impacto de testes** seleciona os testes que podem ser afetados:

- **Estática**: o grafo de build (módulo alterado → módulos que dependem dele → seus testes). Exata nas fronteiras de módulo; grosseira dentro de um módulo.
- **Baseada em cobertura**: testes cuja cobertura registrada inclui as linhas alteradas. Precisa, mas exige mapas de cobertura atualizados.
- **Preditiva**: um modelo treinado no histórico prevê quais testes provavelmente vão falhar com esta mudança; a Meta relatou pegar a grande maioria das falhas rodando uma fração dos testes[^5]. LLMs podem contribuir com features (do que se trata a mudança), mas a decisão é estatística.

A rede de segurança é inegociável: a **suíte completa** continua rodando — na `main` após o merge, à noite ou antes da release —, de modo que um teste perdido é pego horas depois, e não em produção. Os números tornam o trade-off concreto (premissas ilustrativas no código):

```python exec="1"
# Test selection: CI minutes saved vs regressions that slip to the nightly full run.
FULL_MIN, SELECTED_MIN = 25.0, 4.0       # minutes per run
RUNS_PER_DAY = 60 * 3 / 5                # 60 PRs/week, ~3 pushes each, 5 working days
BREAKING_RATE = 0.04                     # 4 % of pushes break some test (assumption)

print("| Selection recall | CI minutes/day (selected) | Minutes saved/day | Breaks slipping to nightly per week |")
print("|---|---|---|---|")
for recall in (1.00, 0.99, 0.95, 0.90):
    minutes = RUNS_PER_DAY * SELECTED_MIN
    saved = RUNS_PER_DAY * (FULL_MIN - SELECTED_MIN)
    slipped = RUNS_PER_DAY * 5 * BREAKING_RATE * (1 - recall)
    print(f"| {recall:.0%} | {minutes:.0f} | {saved:.0f} | {slipped:.2f} |")
```

Com recall de 95%, o time economiza cerca de doze horas de runner de CI por dia e deixa aproximadamente uma mudança que quebra testes a cada três semanas escapar para a execução noturna — onde ela é pega e atribuída a um commit. Se isso é aceitável depende de quão caro é uma `main` vermelha para o time; para o `inventory`, muitos times sempre rodam a suíte completa do serviço.

---

## Dados sintéticos de teste { #synthetic-test-data }

Testes precisam de dados: locais com mapas de assentos estranhos, eventos em vários fusos horários, nomes com acentos, endereços de e-mail no limite de tamanho. Os modelos geram rapidamente dados **falsos** ricos e realistas. Três regras:

1. **Nunca** envie dados de produção (nomes de clientes, e-mails, dados de pagamento) a um modelo para "deixar realista". Pela LGPD e por leis semelhantes, isso é tratamento de dados pessoais por um terceiro, com obrigações legais — e é desnecessário.
2. **Congele a saída.** Gere uma vez, revise, faça commit da fixture (ou de um gerador com semente). Testes que chamam um modelo em tempo de execução são lentos, custam dinheiro e não são determinísticos.
3. **Peça os casos de borda explicitamente**: um evento às 23h30 do dia em que muda o horário de verão, um local com 0 assentos em um setor, um nome com 300 caracteres. Dados realistas valem menos que dados *adversariais*.

---

## Trade-offs

| Decisão | Escolha A quando… | Escolha B quando… |
|---|---|---|
| Testes gerados: em todo PR vs. sob demanda | Serviços pequenos e rápidos; execuções de mutação baratas | Serviços grandes; teste de mutação lento; revisores ocupados |
| Aceitar testes gerados pela cobertura vs. pelo mutation score | Nunca só pela cobertura | Sempre mutation score + revisão humana das asserções |
| Triagem de flaky: rótulos da IA vs. só regras | Muitas falhas, logs longos, humanos sobrecarregados | Suíte pequena; as regras já explicam a maioria das falhas |
| Seleção de testes: estática vs. preditiva | Fronteiras de módulo claras; correção em primeiro lugar | Monorepo enorme; bons dados de histórico; rede de segurança noturna |
| Dados sintéticos: gerar em tempo de execução vs. fixtures congeladas | Nunca em tempo de execução no CI | Sempre congelados e revisados |

!!! example "BoxOffice: testes onde eles importam"

    O time roda o gerador de testes sob demanda para o `inventory` e o `order`, aceita testes só com ganho de mutation score e pede aos revisores que confiram cada asserção contra as regras de reserva ("10 minutos", "uma reserva ativa por assento"). Ele adiciona uma propriedade jqwik para o mapa de assentos (nenhuma venda dupla sob qualquer sequência de operações), usa seleção estática de testes nos PRs com a suíte completa na `main` e deixa um LLM rotular builds vermelhos com evidências — enquanto a quarentena continua sendo uma regra com um responsável. O [hands-on 13, parte 2](../../../hands-on/13/tests/index.md) constrói o gerador primeiro no `catalog` (quadro acima); o `inventory` é o próximo alvo.

!!! tip "Na entrevista"

    Se perguntarem como a IA muda os testes, separe **gerar entradas** (a IA é forte) de **decidir a correção** (o oráculo — exige requisitos e humanos). Cite o teste de mutação como a forma de julgar testes gerados, mencione a triagem de testes flaky com sinais determinísticos primeiro e a quarentena como decisão de política, e apresente a seleção de testes como um trade-off entre recall e minutos, com a suíte completa como rede de segurança.

!!! success "Boas práticas"

    - **Rode um teste gerado duas vezes antes de aceitá-lo** — um teste que falha na segunda execução já nasce instável; o [`gen_tests.py`](../../../hands-on/13/tests/index.md) do lab 13 faz isso em toda tentativa.
    - **Aceite testes gerados só com ganho medido de mutation score** — o lab 13 exige +5 pontos percentuais sobre os testes existentes (22% para o `CatalogService`).
    - **Coloque o requisito no contexto do gerador** — com "uma reserva dura 10 minutos" no prompt, o oráculo é o requisito, não o código sob teste.
    - **Mantenha os testes gerados numa classe própria** — `CatalogServiceAiTest` ao lado do `CatalogServiceTest` humano permite medir o valor e o custo de cada um separadamente.
    - **Rode código gerado sem segredos** — testes são código não confiável; o lab 13 roda o Maven sem as variáveis `*KEY*`, `*TOKEN*` e `*SECRET*`.

!!! warning "Armadilhas comuns"

    - **Comemorar a cobertura** dos testes gerados: testes sem asserções a inflam.
    - **Deixar o gerador alterar o código de produção** para que seus testes passem.
    - **Pôr em quarentena pelo veredito do modelo**: condições de corrida reais somem de vista.
    - **Selecionar testes sem rede de segurança**: o teste pulado era o que importava.
    - **Chamar um modelo dentro de um teste**: lento, caro e flaky por construção.

---

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    GEN["AI generates inputs:<br/>unit, property, contract tests"] --> ORA{"the oracle:<br/>who decides correct?"}
    ORA --> REQ["requirements<br/>and humans"]
    GEN --> MUT["mutation testing<br/>judges the tests"]
    GEN --> K6["k6 scripts from OpenAPI<br/>→ Performance"]
    FL["flaky-test triage:<br/>deterministic signals first"] --> QU["quarantine is<br/>a policy decision"]
    SEL["test selection:<br/>recall vs minutes"] --> NET["full-suite<br/>safety net"]
    DATA["synthetic test data"] --> LGPD["no production<br/>personal data"]
```

**Componentes da paleta:** [`llmgw`](../../../reference/components/ai/index.md#llmgw) (toda chamada de geração e de triagem) · [`app`](../../../reference/components/compute/index.md#app) (os serviços sob teste, com o `inventory` como o mais arriscado) · [`sql`](../../../reference/components/storage/index.md#sql) (as regras de reserva de assentos que propriedades e testes de contrato protegem) · [`logs`](../../../reference/components/observability/index.md#logs) e [`metrics`](../../../reference/components/observability/index.md#metrics) (histórico de falhas e taxas de flakiness que alimentam a triagem). **Cenários:** `flash-sale` (a carga que os scripts k6 gerados precisam reproduzir). **Continua em:** [Desempenho](../../performance/index.md) (testes de carga e orçamentos), [Desempenho — testes de carga](../../performance/load-testing/index.md), [Bancos de dados — transações](../../databases/transactions/index.md) (o que significa "sem venda dupla"), [Revisão de código](../code-review/index.md), [Hands-on 13 — testes](../../../hands-on/13/tests/index.md).

---

[^1]: BARR, E. T. et al. *The Oracle Problem in Software Testing: A Survey*. IEEE Transactions on Software Engineering, 2015.
[^2]: DEMILLO, R. A.; LIPTON, R. J.; SAYWARD, F. G. *Hints on Test Data Selection: Help for the Practicing Programmer*. IEEE Computer, 1978. Veja também o [PIT](https://pitest.org){target="_blank"}.
[^3]: FOSTER, C. et al. *Mutation-Guided LLM-based Test Generation at Meta*. FSE 2025 (industry track).
[^4]: MICCO, J. [Flaky Tests at Google and How We Mitigate Them](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html){target="_blank"}. Google Testing Blog, 2016.
[^5]: MACHALICA, M. et al. *Predictive Test Selection*. ICSE-SEIP 2019.
