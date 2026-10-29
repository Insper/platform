Um modelo consegue escrever cinquenta testes unitários em um minuto. A pergunta difícil não é *ele consegue escrever testes?*, mas **vale a pena manter esses testes?** A cobertura não responde a isso: um teste que chama todos os métodos e não verifica nada chega a 100% de cobertura de linhas e não pega nenhum bug. Esta parte usa **testes de mutação** como juiz: um teste gerado só é mantido se pegar bugs que os testes existentes deixam passar.

## 2.1 Testes de mutação em um parágrafo { #21-mutation-testing-in-one-paragraph }

Uma ferramenta de testes de mutação faz pequenas alterações no código de produção — cada uma é um **mutante**: `>` vira `>=`, `a * b` vira `a / b`, um `return price` vira `return 0`, uma chamada de método é removida — e roda os testes contra cada mutante. Se algum teste falha, o mutante é **morto** (os testes perceberam o bug); se todos os testes continuam passando, ele **sobreviveu** (um bug que os testes não enxergam). O **score de mutação** é mortos ÷ total. O [PIT](https://pitest.org){target="_blank"} é a ferramenta padrão para a JVM[^1].


``` diagram-sim
flowchart LR
    pr["PR altera<br/>CatalogService.java"] --> base["PIT com os testes existentes<br/>score de referência"]
    base --> gen["Modelo escreve<br/>CatalogServiceAiTest"]
    gen --> comp{"compila e<br/>passa duas vezes?"}
    comp -->|"não: erros de volta"| gen
    comp -->|"sim"| pit["PIT com testes existentes + novos"]
    pit --> gain{"score ≥ referência + 5 pp?"}
    gain -->|"não: sobreviventes de volta"| gen
    gain -->|"sim"| pr2["PR em rascunho com o teste"]
```

O loop dá ao modelo **três tipos de feedback**, nesta ordem: erros de compilação, testes falhando e a lista de **mutantes sobreviventes** ("linha 42: limite da condicional alterado em `isExpired()`"). Este último é a parte interessante: ele diz ao modelo exatamente qual comportamento não está testado, a mesma ideia por trás da geração de testes guiada por mutação relatada na Meta[^2].

## 2.2 Adicione testes unitários e o PIT ao `catalog` { #22-add-unit-tests-and-pit-to-catalog }

O gerador precisa de um serviço com **bibliotecas de teste** e **PIT**. O [Lab 11](../../11/ci/index.md) já deu ao `catalog` as dependências de teste (os starters de teste do Spring Boot, que trazem JUnit Jupiter, Mockito e AssertJ, e o Testcontainers do teste de integração). O lab 13 acrescenta um bloco, marcado `lab 13` no arquivo: o plugin do PIT com o adaptador JUnit 5, que também roda os testes JUnit 6 do Spring Boot 4. O PIT só roda quando você chama o goal dele, nunca num `mvn verify` comum. Substitua o arquivo — é o `pom.xml` do lab 11 mais esse bloco:

``` { .xml title="services/catalog/pom.xml" .copy }
--8<-- "docs/2027.1/hands-on/13/code/services/catalog/pom.xml"
```

E um primeiro teste de `CatalogService` escrito à mão, incompleto de propósito — JUnit + Mockito puros, sem contexto Spring e sem banco, então roda em um segundo:

``` { .java title="services/catalog/src/test/java/boxoffice/catalog/CatalogServiceTest.java" .copy }
--8<-- "docs/2027.1/hands-on/13/code/services/catalog/src/test/java/boxoffice/catalog/CatalogServiceTest.java"
```

**Ponto de verificação.** Na raiz do repositório:

``` { .bash .copy }
mvn -B -f services/catalog/pom.xml verify
```

O `verify` roda **as duas** classes de teste do `catalog`: o teste de integração `CatalogApiTest` do lab 11 (Testcontainers: **o Docker precisa estar rodando**) e o novo `CatalogServiceTest`. Você deve ver, perto do fim (a primeira execução baixa as bibliotecas de teste e as imagens `postgres:17` e `redis:8-alpine`; os tempos variam):

```text
[INFO] Tests run: 3, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 10.41 s -- in boxoffice.catalog.CatalogApiTest
[INFO] Tests run: 3, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.165 s -- in boxoffice.catalog.CatalogServiceTest
...
[INFO] Tests run: 6, Failures: 0, Errors: 0, Skipped: 0
...
[INFO] BUILD SUCCESS
```

Um aviso `Mockito is currently self-attaching to enable the inline-mock-maker` é inofensivo. O Docker não está rodando agora? Rode só o novo teste unitário, que não precisa de contêiner: `mvn -B -f services/catalog/pom.xml test -Dtest=CatalogServiceTest` imprime `Tests run: 3, Failures: 0, Errors: 0, Skipped: 0`. O PIT (abaixo) e o gerador também rodam só testes unitários, então funcionam sem Docker.

Agora rode o PIT à mão uma vez numa classe para ver o relatório (HTML em `services/catalog/target/pit-reports/index.html`):

``` { .bash .copy }
mvn -B -f services/catalog/pom.xml test-compile org.pitest:pitest-maven:mutationCoverage \
  -DtargetClasses=boxoffice.catalog.CatalogService -DtargetTests='boxoffice.catalog.CatalogService*Test'
```

Você deve ver, perto do fim (uma execução em Java 21 enquanto este lab era escrito; os tempos dependem da sua máquina, as contagens não):

```text
================================================================================
- Statistics
================================================================================
>> Line Coverage (for mutated classes only): 10/28 (36%)
>> 1 tests examined
>> Generated 18 mutations Killed 4 (22%)
>> Mutations with no coverage 14. Test strength 100%
>> Ran 4 tests (0.22 tests per mutation)
...
[INFO] BUILD SUCCESS
```

Leia: o PIT fez **18 mutantes** de `CatalogService`; os três testes do `CatalogServiceTest` mataram **4** (um score de mutação de 22 %). Quatorze mutantes estão em código que nenhum teste sequer executa (`findEvent`, `upcomingEvents`, `createEvent`, ...). Abra o relatório HTML: cada linha vermelha é um bug que os seus testes não perceberiam. Essa lacuna é o que o gerador precisa fechar.

!!! tip "Mantenha o PIT focado"

    Testes de mutação são caros: cada mutante roda (parte da) suíte de testes. Num serviço inteiro, isso pode levar muitos minutos. Sempre mire nas classes que o PR alterou (`-DtargetClasses`) — é exatamente o que o script faz.

## 2.3 O gerador { #23-the-generator }

``` { .python title=".github/ai/gen_tests.py" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/13/code/.github/ai/gen_tests.py"
```

| Regra no código | Por quê |
|---|---|
| Arquivo novo `<Class>AiTest.java`, nunca edita `<Class>Test.java` | Testes gerados nunca sobrescrevem os escritos por humanos; o review vê exatamente o que é novo |
| Construções em `FORBIDDEN` | Nada de `Thread.sleep` (lento e instável), nada de `@SpringBootTest` (lento, precisa de banco), nada de `@Disabled` (um teste desabilitado é uma mentira) |

| Código-fonte do mesmo pacote no prompt | Para fazer mock de `EventRepository`, o modelo precisa das assinaturas reais dos métodos; caso contrário, o teste não compila |
| Roda o teste **duas vezes** | Um teste que passa uma vez e falha na outra é pior do que nenhum teste |
| `env` sem `KEY`/`TOKEN`/`SECRET` | O código sob teste, e o teste gerado, nunca veem a chave de API |
| `MIN_GAIN` de 5 pontos percentuais | Um teste que não acrescenta nada mensurável é ruído a manter |
| Apaga o arquivo se for rejeitado | Nada que não foi comprovado fica na árvore de trabalho |
| Uma linha por tentativa no resumo | Você vê *por que* uma tentativa foi rejeitada: erro de compilação, teste falhando ou poucos mutantes mortos |

## 2.4 Teste localmente { #24-try-it-locally }

Faça commit da parte 2 na `main` antes (o workflow da 2.5 faz parte dela — salve-o agora), para o gerador partir de uma árvore limpa:

``` { .bash .copy }
git switch main
git add services/catalog/pom.xml services/catalog/src/test .github/ai/gen_tests.py .github/workflows/ai-tests.yaml
git commit -m "test(catalog): unit tests, PIT and the AI test generator (lab 13)"
git push
```

Depois rode o gerador em `CatalogService`, a partir da raiz do repositório. Ele precisa de `mvn` e do JDK 21 na sua máquina, e chama o modelo até três vezes; com o modelo local, espere **5–15 minutos**:

``` { .bash .copy }
uv run --no-project --python 3.12 --with-requirements .github/ai/requirements.txt \
  python .github/ai/gen_tests.py services/catalog/src/main/java/boxoffice/catalog/CatalogService.java
git status --short   # CatalogServiceAiTest.java exists only if it was accepted
```

O resumo compara o score de mutação com e sem a classe gerada, e diz por que cada tentativa foi aceita ou rejeitada. Uma execução com o `qwen2.5-coder-16k` local enquanto este lab era escrito:

```text
### AI tests for `boxoffice.catalog.CatalogService`

| | Mutation score | Killed / total |
|---|---|---|
| Existing tests | 22% | 4 / 18 |
| With `CatalogServiceAiTest` | — (no attempt compiled and passed) | — |

Attempts: 3 · accepted: **False**

- 1. does not compile or fails: [ERROR] services/catalog/src/test/java/boxoffice/catalog/CatalogServiceAiTest.java:[57,91] cannot find symbol / [ERROR] services/catalog/src/test/java/boxoffice/catalog/CatalogServiceAiTest.java:[68,133] cannot find symbol
- 2. does not compile or fails: [ERROR] Tests run: 13, Failures: 0, Errors: 4, Skipped: 0, Time elapsed: 18.49 s <<< FAILURE! -- in boxoffice.catalog.CatalogServiceAiTest / [ERROR] boxoffice.catalog.CatalogServiceAiTest.createVenueCreatesVenue -- Time elapsed: 0.198 s <<< ERROR!
- 3. does not compile or fails: [ERROR] services/catalog/src/test/java/boxoffice/catalog/CatalogServiceAiTest.java:[45,53] cannot find symbol / [ERROR] services/catalog/src/test/java/boxoffice/catalog/CatalogServiceAiTest.java:[45,87] cannot find symbol

| Model | Calls | Input | Cache read | Cache write | Output | Time | Cost |
|---|---|---|---|---|---|---|---|
| `qwen2.5-coder-16k` | 3 | 10,604 | 0 | 0 | 5,466 | 454.0 s | n/a (local or unknown model) |
```

**Rejeitado** — e isso é o gerador funcionando, não falhando. O modelo gratuito de 7B inventou métodos (`cannot find symbol`) ou escreveu testes que lançam exceções; uma segunda execução com `AI_TESTS_MAX_ATTEMPTS=5` falhou do mesmo jeito cinco vezes (21.278 tokens de entrada, ~16 minutos). Nada sem prova ficou para trás: o `git status` não mostra nenhum `CatalogServiceAiTest.java`. Um modelo mais forte (o Claude, ou um modelo local maior se a sua máquina tiver memória) tem mais chance de compilar — e ainda precisa superar a referência de 22 % em 5 pp; compare-os na parte 7. Se o seu for aceito, a segunda linha mostra o novo score e o `git status` lista o novo arquivo de teste.

Registre os seus números — modelo, tentativas, score inicial e final, minutos — para a parte 7.

## 2.5 O workflow { #25-the-workflow }

Gerar testes para todo PR seria lento e caro. O workflow roda **sob demanda**: adicione o label `ai-tests` a um PR. Ele tem **dois jobs**: `generate` roda o modelo e o build com um token somente leitura, e `publish` — o único job que pode escrever — aplica o patch e abre um PR em rascunho. O job que executa código não confiável (o código do PR e o código do modelo) nunca tem um token de escrita.

``` { .yaml title=".github/workflows/ai-tests.yaml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/13/code/.github/workflows/ai-tests.yaml"
```

O job escolhe no máximo duas classes **adicionadas ou modificadas** pelo PR em `src/main/java`. Abra um PR pequeno que mexa em `CatalogService` — um comentário de uma linha na classe basta:

``` { .bash .copy }
git switch main && git pull
git switch -c catalog-docs
```

``` { .diff title="services/catalog/src/main/java/boxoffice/catalog/CatalogService.java" }
-@Service
+/** Use cases of the catalog: events and venues. */
+@Service
 public class CatalogService {
```

``` { .bash .copy }
git commit -am "docs(catalog): describe CatalogService"
git push -u origin catalog-docs
gh pr create --fill --base main
gh pr edit --add-label ai-tests      # the label was created in step 0.4
gh pr checks --watch                # "AI tests / generate" appears a few seconds after the label
```

Você deve ver o job `generate` terminar (20–45 minutos com o modelo gratuito num runner só com CPU: o modelo, dois builds Maven por tentativa e o PIT) e então:

- um PR em rascunho `AI tests for #N`, com o label `ai-generated`, baseado em `catalog-docs`, com um commit que leva o trailer `AI-assisted: gen_tests.py (...)` — confira com `gh pr list --label ai-generated`; ou
- `publish` **pulado**, e o resumo do job `generate` listando as tentativas rejeitadas. Esse é um resultado válido: anote o porquê.

Faça o merge de um PR `AI tests` no seu branch só depois de ler cada teste.

!!! warning "O problema do oráculo"

    Um teste gerado verifica o que o código **faz**, não o que ele **deveria fazer**. Se o `HoldService` deixa uma reserva expirar dois minutos antes, o modelo vai escrever com toda a alegria `assertThat(hold.expiresAt()).isEqualTo(now.plusMinutes(8))` — e o bug agora está protegido por um teste verde. Testes de mutação provam que os testes são *sensíveis*, não que estão *certos*. Leia cada asserção contra o requisito ("uma reserva dura 10 minutos"), não contra o código.

!!! warning "Armadilhas comuns"

    - **Medir testes gerados pela cobertura**: a cobertura sobe com testes sem asserções. Use o score de mutação.
    - **Deixar o gerador editar o código de produção "para o teste passar"**: aí ele não é um gerador de testes, é uma ferramenta de refatoração sem revisão.
    - **Rodar o PIT em tudo, em todo PR**: minutos e dólares. Mire nas classes alteradas, sob demanda.


## Solução de problemas { #troubleshooting }

| Sintoma | Causa | Correção |
|---|---|---|
| `Could not find a valid Docker environment` no `CatalogApiTest` | o `mvn verify` também roda o teste com Testcontainers do lab 11, e o Docker não está rodando | inicie o Docker (lab 0); ou rode só o teste unitário: `mvn -B -f services/catalog/pom.xml test -Dtest=CatalogServiceTest` |
| `package org.junit.jupiter.api does not exist` | falta o `spring-boot-starter-test` no `pom.xml` | use o `pom.xml` do passo 2.2 |
| PIT: `No test library found` ou `0 tests examined` | falta a dependência `pitest-junit5-plugin`, ou `-DtargetTests` não casa com o nome da classe de teste | mantenha o bloco do plugin do passo 2.2; classes de teste terminam em `Test` (`CatalogService*Test`) |
| `release version 21 not supported` / `The JAVA_HOME environment variable is not defined correctly` | o Maven roda com outro JDK, ou o `JAVA_HOME` está errado | `java -version` precisa dizer 21+; defina o `JAVA_HOME` (macOS: `export JAVA_HOME=$(/usr/libexec/java_home -v 21)`) |
| `mvn: command not found` durante o `gen_tests.py` | o Maven não está no `PATH` deste shell | instale-o (lab 0) ou abra um novo terminal |
| Toda tentativa `does not compile or fails` | o modelo inventa métodos ou esquece imports (comum em modelos locais pequenos) | leia o erro na lista de tentativas; tente `AI_TESTS_MAX_ATTEMPTS=5`, ou um modelo mais forte; uma rejeição é um resultado válido e registrado |
| `passes twice; mutation score ...` mas não aceito | os testes novos rodam mas matam poucos mutantes a mais (`MIN_GAIN` = 5 pp) | esperado: não vale a pena mantê-los. Veja os sobreviventes no relatório do PIT |
| O job `generate` estoura o timeout de 60 minutos | runner com CPU + modelo local + PIT | mire uma classe só (`head -n 1` no workflow) ou use um modelo hospedado neste job |

[Próximo: parte 3 — o agente de correção](../fix-agent/index.md){ .md-button .md-button--primary }

[^1]: COLES, H. et al. [PIT: a practical mutation testing tool for Java](https://pitest.org){target="_blank"}. ISSTA 2016 (demonstração de ferramenta).

[^2]: FOSTER, C. et al. *Mutation-Guided LLM-based Test Generation at Meta*. FSE 2025 (trilha de indústria).
