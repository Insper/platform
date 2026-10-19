# Perguntas comportamentais

A maioria dos processos com entrevista de system design inclui uma conversa sobre **o que você já fez**: "conte sobre uma decisão técnica que você tomou", "conte sobre algo que deu errado". Para um estágio ou primeiro emprego, os projetos deste curso são exatamente o material que essas perguntas pedem. Esta página mostra como transformá-los em histórias curtas e honestas que mostram discernimento — o mesmo discernimento que a entrevista de design procura.

## Por que aparecem num processo de system design

Uma entrevista de design mostra como você raciocina sobre um sistema hipotético em 45 minutos. Uma pergunta comportamental verifica se você já raciocinou assim **de verdade**: escolheu entre opções, conviveu com as consequências, mediu, errou e aprendeu. O entrevistador procura os mesmos sinais nas duas: trade-offs declarados explicitamente, números, responsabilidade e a capacidade de mudar de ideia diante de evidências.

| O que avaliam | Como isso soa |
|---|---|
| Discernimento | "Escolhemos X em vez de Y porque…, isso nos custou…, revisaríamos se…" |
| Responsabilidade | "Eu" para o que você fez, "nós" para o time; sem culpar ninguém |
| Evidência | "O p99 foi de 900 ms para 180 ms no teste de carga com k6" |
| Aprendizado | "Da próxima vez eu mediria antes de escolher" |
| Colaboração | Como você lidou com uma discordância ou ajudou um colega |

## O formato STAR(L)

Responda em **dois minutos ou menos**, com esta estrutura:

- **S — Situação**: o contexto em uma ou duas frases. Qual projeto, qual sistema, que escala.
- **T — Tarefa**: o que *você* precisava alcançar, e o que tornava isso difícil.
- **A — Ação**: o que você fez, com o raciocínio e as alternativas que descartou. É a parte mais longa.
- **R — Resultado**: o que aconteceu, com um número se possível.
- **L — Lição** (*learning*): o que você faria diferente, ou o que agora faz por padrão.

!!! tip "Falando de trade-offs"
    Use a mesma frase da entrevista de design: **"Escolhemos X em vez de Y porque [requisito ou número]. O custo foi [do que abrimos mão]. Revisaríamos se [condição]."** Por exemplo: "Escolhemos um Redis com cache-aside em vez de réplicas de leitura para o catálogo porque 95% do tráfego eram leituras dos mesmos 200 eventos. O custo foi até 60 segundos de preços desatualizados. Revisaríamos se os preços passassem a mudar durante a venda."

## Transformando o trabalho do curso em histórias

Você já tem a matéria-prima. Escreva uma história de cada uma destas atividades antes de uma temporada de entrevistas:

| Atividade do curso | História que ela rende | Pergunta típica |
|---|---|---|
| [Projeto em equipe](../../../exercises/project/index.md) | Uma decisão de design e seu trade-off; uma discordância no time | "Conte sobre uma decisão técnica de que você se orgulha" |
| [Campanha de testes de carga](../../../exercises/project/load-test-campaign/index.md) | Achar um gargalo com dados, números de antes e depois | "Conte sobre um problema de desempenho que você resolveu" |
| [Game day de caos](../../../exercises/project/game-day/index.md) | Algo que quebrou, como você diagnosticou, o que mudou | "Conte sobre uma falha" |
| [Documento de design e ADRs](../../../exercises/design-doc/index.md) | Registrar alternativas, defender uma escolha, aceitar feedback | "Conte sobre uma vez em que você mudou de ideia" |
| Laboratórios (por exemplo o [Hands-on 9](../../../hands-on/9/index.md)) | Acrescentar resiliência a uma dependência | "Como você lida com dependências pouco confiáveis?" |

## Dez perguntas comuns

| # | Pergunta | O que está sendo avaliado | Roteiro de uma boa resposta |
|---|---|---|---|
| 1 | Conte sobre uma decisão técnica que você tomou. | Discernimento, trade-offs | Opções consideradas, critérios (números, requisitos), a escolha, seu custo, o resultado |
| 2 | Conte sobre algo que deu errado. | Responsabilidade, aprendizado | O que quebrou, sua parte nisso, como você descobriu, o que corrigiu, o que mudou depois |
| 3 | Conte sobre um problema de desempenho que você resolveu. | Método, evidência | Sintoma, medição, hipótese, experimento, números de antes e depois |
| 4 | Conte sobre uma discordância com um colega. | Colaboração | As duas posições com justiça, como decidiram (dados, um protótipo, um prazo), a relação depois |
| 5 | Conte sobre uma vez em que você mudou de ideia. | Abertura a evidências | A crença original, a evidência, a nova decisão, o que isso ensinou |
| 6 | Qual o sistema mais complexo que você já construiu? | Profundidade, comunicação | Explique em dois níveis: uma frase, depois a arquitetura e a parte mais difícil |
| 7 | Conte sobre uma vez em que precisou aprender algo rápido. | Capacidade de aprender | O quê, por quê, como (documentação, pequenos experimentos, perguntar), em quanto tempo virou útil |
| 8 | Conte sobre um prazo que você quase perdeu. | Priorização | O que você cortou e por quê, como comunicou, o resultado |
| 9 | Como você garante que seu código funciona em produção? | Mentalidade de operação | Testes, observabilidade, liberação gradual, alertas — com um exemplo do curso |
| 10 | O que você faria diferente no seu projeto? | Reflexão | Uma coisa concreta, com o motivo; nem "nada", nem "tudo" |

!!! example "Uma resposta completa: pergunta 3, de um projeto BoxOffice"
    **Situação.** "Na disciplina de Arquitetura de Sistemas, meu time de três pessoas construiu uma plataforma de ingressos com um catálogo, um serviço de inventário para reservas de assentos e um serviço de pedidos, no Kubernetes."

    **Tarefa.** "Nossa meta era atender 2.000 requisições por segundo na página do evento com p99 abaixo de 300 ms. No primeiro teste de carga com k6, o p99 estava em 1,4 segundo com só 600 requisições por segundo, e eu era o responsável pelo serviço de catálogo."

    **Ação.** "Eu não queria chutar, então olhei os traces primeiro: 85% do tempo estava no banco, a mesma consulta dos detalhes do evento, umas 40 vezes por segundo para o mesmo evento. Considerei réplicas de leitura e um cache. Réplicas acrescentariam capacidade, mas manteriam a consulta de 20 ms em toda requisição; um Redis com cache-aside eliminaria a maioria das consultas, ao custo de dados desatualizados. Como os detalhes do evento mudam pouco, escolhi o cache com TTL de 60 segundos, apagando a chave nas atualizações. Também criei um índice que o `EXPLAIN` mostrou que faltava."

    **Resultado.** "Na campanha seguinte, o p99 foi de 180 ms a 2.000 requisições por segundo, a taxa de acerto ficou em 97% e a CPU do banco caiu de 90% para 15%."

    **Lição.** "Medir antes de escolher nos poupou de acrescentar réplicas de que não precisávamos. Desde então começo todo problema de desempenho com um trace e uma hipótese por escrito."

## Armadilhas

!!! warning "O que faz uma boa história soar mal"
    - **"Nós" o tempo todo.** O entrevistador está contratando você: diga o que *você* fez.
    - **Sem números.** "Ficou muito mais rápido" é fraco; "p99 de 1,4 s para 180 ms" é forte.
    - **Uma história sem trade-off ou sem dificuldade.** Se foi fácil, não é uma boa história.
    - **Culpar alguém.** Colegas, o professor, o provedor de nuvem: descreva a situação e assuma a sua parte.
    - **Longa demais.** Dois minutos. O entrevistador pede mais detalhes se quiser.
    - **Histórias inventadas.** As perguntas de acompanhamento as desmontam rápido. Uma história pequena e verdadeira vale mais que uma grande e falsa.

## Seu banco de histórias

Preencha uma linha por história; mire em seis a oito histórias que, juntas, cubram as dez perguntas.

| História (título) | Situação e tarefa | Ação (e as alternativas) | Resultado (números) | Lição | Responde às perguntas |
|---|---|---|---|---|---|
| Cache do catálogo | Projeto; p99 de 1,4 s a 600 req/s | Traces → cache-aside em vez de réplicas, mais um índice | p99 de 180 ms a 2.000 req/s | Medir antes de escolher | 1, 3, 5 |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |

De volta à [página de entrevistas](../index.md) · pratique o lado do design com os [problemas](../problems/index.md) e as [entrevistas simuladas](../mock/index.md).
