# Referência { #reference }

A seção de referência é a parte do curso que você deixa aberta em outra aba: enquanto projeta no playground, enquanto faz um laboratório, enquanto se prepara para uma entrevista. Nada aqui precisa ser lido em ordem. Cada página responde rapidamente a um tipo de pergunta e aponta de volta para a aula em que o assunto é explicado em profundidade.

<div class="grid cards" markdown>

-   __[Catálogo de componentes](components/index.md)__

    ---

    Os 49 componentes da paleta, uma entrada para cada: o que é, quando usar e quando não usar, números-chave, modos de falha, parâmetros no playground, produtos reais na AWS, no GCP, no Azure e em código aberto, e uma frase para a entrevista.

-   __[Números](numbers/index.md)__

    ---

    Os números de onde toda estimativa parte: escada de latências, potências de dois, requisições por segundo, tamanhos de armazenamento, os noves de disponibilidade, vazão de componentes comuns e preços aproximados de nuvem.

-   __[Glossário](glossary/index.md)__

    ---

    O vocabulário de system design de A a Z, com uma definição de uma ou duas frases e um link para onde cada termo é ensinado. A página em português traz o equivalente usual no Brasil.

-   __[Ferramentas](tools/index.md)__

    ---

    As ferramentas do ofício, agrupadas por função: teste de carga, caos e injeção de falhas, observabilidade, infraestrutura como código, entrega, clusters locais, diagramas e sistemas de IA — com o laboratório em que usamos cada uma.

-   __[Lista de leitura](reading/index.md)__

    ---

    Os livros, artigos, blogs de engenharia e cursos por trás do curso, cada um com uma linha sobre por que vale o seu tempo.

</div>

## Qual página responde à minha pergunta? { #which-page-answers-my-question }

| Eu quero… | Vá para |
|---|---|
| Saber o que uma caixa faz antes de colocá-la num design | [Catálogo de componentes](components/index.md) |
| Comparar dois componentes (fila vs pub/sub, SQL vs NoSQL) | As duas entradas do catálogo, depois a aula para a qual elas apontam |
| Estimar QPS, armazenamento ou banda | [Números](numbers/index.md) e [Aula 2 · Estimativas](../classes/estimation/index.md) |
| Conferir o que um termo significa | [Glossário](glossary/index.md) |
| Escolher uma ferramenta de teste de carga ou de caos | [Ferramentas](tools/index.md) |
| Ir além da aula | [Lista de leitura](reading/index.md) |
| Preparar-me para uma entrevista | [Apoio › Entrevista](../support/interview/index.md) |
| Testar uma ideia sob carga | [Playground](../../playground/index.md) |

!!! note "Sobre os números e os preços"
    Latências, vazões e preços da referência são valores publicados e conhecidos ou ordens de grandeza marcadas como *ilustrativas*. Servem para raciocinar sobre um design e comparar opções; não são benchmarks do seu hardware. Os preços são preços de tabela aproximados observados em 2026 e mudam com frequência — confirme sempre nas calculadoras dos provedores antes de citar um custo.
