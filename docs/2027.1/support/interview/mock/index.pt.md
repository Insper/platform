# Entrevistas simuladas

System design é uma prova oral, e o único jeito de ficar bom numa prova oral é falar. Esta página é um protocolo de **entrevistas simuladas em dupla**: um estudante é o candidato, o outro o entrevistador, e vocês trocam de papel. Ser o entrevistador não é um favor ao colega: ouvir um design com a rubrica na mão é o jeito mais rápido de aprender como soa uma resposta forte.

!!! abstract "Do que você precisa"
    - Duas pessoas (três, se houver um observador), 60 minutos: 45 para a entrevista, 10 para o feedback, 5 para trocar.
    - Um problema dos [problemas para praticar](../problems/index.md) e, para o entrevistador, o estudo de caso correspondente.
    - Um quadro, papel ou um canvas online ([Excalidraw](https://excalidraw.com) ou o [playground](../../../../playground/index.md) no modo completo).
    - Um cronômetro e uma [ficha de avaliação](#score-sheet) impressa ou copiada.

## Papéis

| Papel | Função | Não pode |
|---|---|---|
| **Candidato** | Conduzir a sessão: esclarecer, estimar, projetar, aprofundar, discutir trade-offs, fechar — em voz alta | Esperar que digam o que fazer; ficar em silêncio por mais de um minuto |
| **Entrevistador** | Dar o enunciado, responder às perguntas de esclarecimento com números realistas, provocar com perguntas de acompanhamento, controlar o tempo, anotar para a rubrica | Dar aula, entregar a resposta ou aceitar "escala" sem perguntar como |
| **Observador** (opcional) | Marcar o tempo de cada fase, anotar frases exatas (boas e ruins), observar a comunicação | Interromper |

!!! tip "Entrevistador: você pode dizer 'não sei, você decide'"
    Entrevistadores reais muitas vezes deixam escolhas para o candidato. Se perguntarem algo que o problema não define, responda "o que você suporia?" — e avalie se a suposição é razoável e foi dita em voz alta.

## Antes da sessão

1. **Escolha um problema** do nível certo na [lista de problemas](../problems/index.md): aquecimento nas primeiras sessões, médio depois da primeira metade do curso, difícil e avançado perto do fim. Não conte ao candidato com antecedência.
2. **O entrevistador se prepara** (10 minutos): lê o estudo de caso correspondente (por exemplo, o [estudo de caso de ingressos](../../../classes/case-studies/ticketing/index.md) para a venda relâmpago do BoxOffice), decide os números que vai dar quando perguntado (usuários, pico, proporção leitura/escrita, tamanho dos dados) e escolhe **dois aprofundamentos** e **três perguntas de acompanhamento** nas listas abaixo.
3. **Combinem o meio**: quadro, papel ou canvas online. Se usarem o playground, comecem pelo cenário `blank`.
4. **Programem o cronômetro** com as marcas de fase do roteiro abaixo.

## O roteiro de 45 minutos

| Fase | Minutos | Relógio |
|---|---|---|
| 1. Esclarecer os requisitos | 5 | 0–5 |
| 2. Estimar | 5 | 5–10 |
| 3. API e modelo de dados | 5 | 10–15 |
| 4. Design de alto nível | 10 | 15–25 |
| 5. Aprofundamentos | 12 | 25–37 |
| 6. Gargalos e trade-offs | 5 | 37–42 |
| 7. Fechamento | 3 | 42–45 |

As fases seguem o [framework](../framework/index.md). O entrevistador controla o relógio: se o candidato ainda estiver esclarecendo no minuto 8, avise ("vamos para o design em um minuto").

### 1. Esclarecer os requisitos (0–5 min)

**O entrevistador diz:** o enunciado numa frase, mais nada. "Projete um site de ingressos para um show num estádio. A venda abre sábado às 10:00."

**Se o candidato travar:** "Quem são os usuários e o que eles fazem?" · "O que faria este sistema aparecer no noticiário por falhar?"

**Respostas para ter prontas** (venda relâmpago do BoxOffice): 60.000 assentos, cerca de 2 milhões de fãs online às 10:00, assentos marcados (um mapa de assentos), uma reserva dura 10 minutos enquanto o fã paga, nunca vender o mesmo assento duas vezes, pagamento por um provedor externo, ingressos por e-mail.

| Sinais verdes | Sinais vermelhos |
|---|---|
| Separa requisitos funcionais de não funcionais | Começa a desenhar no primeiro minuto |
| Pergunta sobre escala, pico, consistência e o que nunca pode dar errado | Pergunta só sobre funcionalidades |
| Escreve uma lista curta no quadro e diz o que fica fora do escopo | Tenta cobrir todas as funcionalidades possíveis |

### 2. Estimar (5–10 min)

**O entrevistador diz:** "De que carga estamos falando, mais ou menos?" (só se o candidato não começar sozinho).

**Provoque com:** "Qual destes números muda o seu design?" · "Qual é o pico, e não a média?"

| Sinais verdes | Sinais vermelhos |
|---|---|
| Usuários → requisições por segundo, média e pico; leituras vs escritas | Aritmética exata que consome cinco minutos |
| Acha o número que importa (33 fãs por assento; disputa em poucas linhas) | Números que nunca mais são usados |
| Arredonda sem medo e diz as suposições em voz alta | Recusa-se a estimar ("depende") |

### 3. API e modelo de dados (10–15 min)

**O entrevistador diz:** "Como é a API do fluxo principal?"

**Provoque com:** "O que acontece se o cliente mandar esta requisição duas vezes?" · "Qual é a chave desta tabela, e que consulta a usa?"

| Sinais verdes | Sinais vermelhos |
|---|---|
| Poucos endpoints ou eventos para o fluxo central, com chave de idempotência onde há dinheiro ou estoque | Uma lista longa de endpoints CRUD para cada entidade |
| Entidades com chaves guiadas pelos padrões de acesso | Escolher o banco pela marca antes de conhecer as consultas |

### 4. Design de alto nível (15–25 min)

**O entrevistador diz:** "Me mostre o design."

**Provoque com:** "Siga uma requisição do clique do fã até o banco." · "O que aqui não tem estado, e onde o estado fica?"

| Sinais verdes | Sinais vermelhos |
|---|---|
| Clientes → borda → serviços → armazenamento, com o trabalho assíncrono atrás de uma fila | Vinte caixas, nenhuma seta rotulada |
| Percorre uma leitura e uma escrita no diagrama | Microsserviços para tudo, sem motivo |
| Cada caixa justificada por um requisito ou um número | Caixas que aparecem porque "todo mundo tem" |

### 5. Aprofundamentos (25–37 min)

**O entrevistador diz:** "Vamos aprofundar em…" — escolha a parte mais difícil do problema, ou pergunte ao candidato "qual parte é a mais arriscada?" (um candidato forte a identifica).

**Aprofundamentos para escolher:**

| Problema | Aprofundamento 1 | Aprofundamento 2 |
|---|---|---|
| Venda relâmpago do BoxOffice | Como exatamente um assento é reservado sem venda dupla? | Como a sala de espera admite fãs num ritmo sustentável? |
| Chat | Como uma mensagem chega a um usuário conectado a outro servidor? | Ordem e entrega para usuários offline |
| Encurtador de URLs | Como os códigos curtos são gerados sem colisões? | Como os redirecionamentos continuam rápidos a 100 mil req/s? |
| Assistente de IA | Como a resposta se ancora nas políticas do BoxOffice (RAG)? | Como impedir que o agente reembolse o pedido errado? |

| Sinais verdes | Sinais vermelhos |
|---|---|
| Mecanismo preciso (um update condicional, um lock, uma chave de partição), não uma palavra da moda | "Usaríamos Redis" sem dizer como |
| Menciona os casos de falha do mecanismo | Defende a primeira ideia depois de uma objeção válida |
| Usa números para dimensionar o componente | Aprofunda numa parte fácil (interface, CRUD) |

### 6. Gargalos e trade-offs (37–42 min)

**O entrevistador diz:** "O que quebra primeiro se o tráfego for 10× maior?" ou "Do que você abriu mão?"

**Perguntas de acompanhamento para provocar** (escolha três):

- Genéricas: "Esta dependência fica lenta: o que acontece com o resto do sistema?" · "Uma zona de disponibilidade inteira cai." · "O cache é esvaziado no pior momento." · "Como você saberia que isto quebrou antes de os usuários avisarem?" · "Quanto isto custa por mês, mais ou menos?"
- Venda relâmpago do BoxOffice: "O provedor de pagamento começa a dar timeout às 10:02." · "Bots abrem 500 mil sessões." · "O evento muda de data; 60 mil fãs precisam ser avisados."
- Chat: "Um grupo de uma celebridade tem 100 mil membros." · "Um usuário está num trem e fica reconectando."
- Encurtador de URLs: "Um link viraliza: 1 milhão de cliques por minuto." · "O analytics precisa contar visitantes únicos."
- Assistente de IA: "O provedor do modelo caiu." · "Uma avaliação na página do evento contém uma prompt injection." · "O custo por conversa dobrou."

| Sinais verdes | Sinais vermelhos |
|---|---|
| Acha o gargalo comparando carga e capacidade | "Mais servidores" como resposta para tudo |
| Nomeia os trade-offs explicitamente: "X em vez de Y porque…, o custo é…" | Afirma que o design não tem fraquezas |
| Fala de timeouts, retries, idempotência, observabilidade | Nunca menciona falhas |

### 7. Fechamento (42–45 min)

**O entrevistador diz:** "Estamos quase sem tempo. Resuma o seu design."

| Sinais verdes | Sinais vermelhos |
|---|---|
| Quatro ou cinco frases: o fluxo, as decisões-chave, o principal trade-off, os próximos passos | Começa a acrescentar caixas novas |
| Lista o que faria com mais tempo (multi-região, custo, abuso, monitoramento) | Estoura o tempo |

!!! warning "Armadilhas do entrevistador"
    - **Ajudar demais.** Se você explica a resposta, não aprende nada sobre o candidato, e o candidato não aprende nada sobre ficar travado. Dê a dica em forma de pergunta, no máximo uma por fase.
    - **Tocas de coelho.** Se o candidato gasta dez minutos num detalhe, interrompa com educação: "vamos estacionar isso e olhar o resto".
    - **Avaliar a resposta, não o raciocínio.** Um design diferente do estudo de caso pode ser excelente. Avalie o quanto ele atende aos requisitos e o quanto os trade-offs são bem argumentados.

## Feedback (10 min)

O feedback logo depois da entrevista, enquanto os dois lembram dos detalhes, é a parte mais valiosa da sessão.

1. **Candidato primeiro** (2 min): "O que foi bem? O que você faria diferente?"
2. **Entrevistador** (6 min), usando a rubrica: **um ponto forte** e **dois pontos a melhorar**, cada um ligado a um momento específico ("no minuto 20, quando perguntei sobre o timeout do pagamento, você…"). Cite frases.
3. **Combinem uma coisa** para praticar na próxima sessão (2 min).

!!! example "Feedback específico, não vago"
    Vago: "Sua estimativa foi fraca."
    Específico: "Você estimou 2 M de usuários, mas nunca transformou isso em requisições por segundo às 10:00; então, quando escolheu um único primário PostgreSQL, não deu para saber se ele aguentaria. Da próxima vez, escreva o QPS de pico no quadro e aponte para ele ao dimensionar cada caixa."

## Rubrica de avaliação

Dê uma nota de 1 a 4 em cada dimensão; os sinais descrevem o que você deve observar.

| Dimensão | 1 · Não contrataria | 2 · Tende a não | 3 · Tende a contratar | 4 · Contrataria com certeza |
|---|---|---|---|---|
| **Requisitos e escopo** | Começa a projetar sem perguntar nada | Pergunta só sobre funcionalidades | Requisitos funcionais e não funcionais, escopo declarado | Acha o que nunca pode falhar e a forma real da carga antes de desenhar |
| **Estimativa** | Nenhum número, ou recusa | Números errados em ordens de grandeza ou nunca usados | QPS de pico, armazenamento e proporção leitura/escrita corretos | Usa os números para decidir (dimensionar, escolher um banco, enxergar a disputa) |
| **API e modelo de dados** | Ausente ou incoerente | CRUD para cada entidade, sem chaves | Endpoints e entidades centrais com chaves | Idempotência, paginação, padrões de acesso guiando o esquema |
| **Design de alto nível** | Não cobre os requisitos | Cobre com caixas sem explicação | Design claro e simples; uma leitura e uma escrita percorridas | Simples, justificado, evolutivo; sabe o que deixar de fora |
| **Aprofundamento e profundidade técnica** | Só palavras da moda | Conhece os nomes dos componentes, não os mecanismos | Explica corretamente o mecanismo de uma parte difícil | Explica mecanismos, seus casos de falha e as alternativas, com números |
| **Trade-offs e gargalos** | "Escala" | Nomeia trade-offs só quando perguntado | Acha o gargalo principal e declara os trade-offs | Quantifica os trade-offs e propõe como medir e evoluir |
| **Confiabilidade e operação** | Nunca menciona falhas | Menciona falhas vagamente | Timeouts, retries, idempotência, redundância onde precisa | Projeta para a falha de ponta a ponta: degradação, observabilidade, SLOs, testes (carga, caos) |
| **Comunicação e condução** | Calado ou desorganizado | Precisa ser conduzido passo a passo | Pensa em voz alta, segue uma estrutura, confere | Conduz a sessão, administra o tempo, se adapta bem a dicas e objeções |

### Expectativas por nível

| Nível | Um "tende a contratar" costuma ser |
|---|---|
| **Estágio / recém-formado** | Notas 3 em requisitos, estimativa, design de alto nível e comunicação; notas 2 aceitáveis em profundidade e operação se o candidato reage bem a dicas |
| **Pleno** | Notas 3 em tudo, pelo menos um 4 (em geral profundidade num componente); conduz sem ser conduzido |
| **Sênior** | Notas 4 em trade-offs, profundidade e operação; acha cedo a parte difícil; discute custo, evolução e impacto organizacional |

## Ficha de avaliação { #score-sheet }

Copie este bloco nas suas anotações a cada sessão (a ficha fica em inglês, como em muitas entrevistas reais).

```text
MOCK INTERVIEW - SCORE SHEET
Date: ____________   Problem: ______________________________
Candidate: ____________________   Interviewer: ____________________

Phase timing (actual minute reached):
  clarify __  estimate __  API/data __  high-level __  deep dives __  trade-offs __  wrap-up __

Dimension                         1  2  3  4   Evidence (minute + what was said)
Requirements & scoping            [] [] [] []  ________________________________
Estimation                        [] [] [] []  ________________________________
API & data model                  [] [] [] []  ________________________________
High-level design                 [] [] [] []  ________________________________
Deep dive & technical depth       [] [] [] []  ________________________________
Trade-offs & bottlenecks          [] [] [] []  ________________________________
Reliability & operability         [] [] [] []  ________________________________
Communication & driving           [] [] [] []  ________________________________

One strength: ____________________________________________________
Two improvements: 1) _____________________________________________
                  2) _____________________________________________
Practice before next session: ____________________________________
```

## Variações

### Versão de 30 minutos

Para aulas ou quando o tempo é curto: esclarecer 3, estimar 3, design de alto nível 9, um aprofundamento 10, trade-offs e fechamento 5. Pule a fase de API, a menos que o problema seja sobre uma API (rate limiter, API gateway).

### Online, com um canvas ou o playground

Use o [Excalidraw](https://excalidraw.com) para um diagrama livre, ou o [playground](../../../../playground/index.md) no modo completo, começando do `blank`: o candidato monta o design com a paleta do curso enquanto fala. O playground tem um bônus: no fim, rode um perfil `load` ou `spike` e veja se o design sobrevive — depois discutam o que o relatório diz.

### Pergunta de caos

Depois do fechamento (ou no lugar da fase de gargalos), o entrevistador injeta uma falha no design do candidato no playground — um provedor de pagamento lento, a queda de uma AZ, um cache esvaziado, uma chave quente — e pede que o candidato a diagnostique pelas métricas e a corrija em cinco minutos. Isso treina exatamente as perguntas de diagnóstico da [tabela de diagnóstico rápido](../index.md#sec-diagnosis).

!!! tip "Grave-se"
    Com o consentimento do colega, grave o áudio de uma sessão. Ouvir a si mesmo é desconfortável e muito eficaz: você vai ouvir os silêncios longos, os "basicamente" e os momentos em que disse "escala" em vez de um número.

## Uma aula em três rodadas

Para uma aula de 2 horas com grupos de três (A, B, C):

| Rodada | Minutos | Candidato | Entrevistador | Observador | Nível do problema |
|---|---|---|---|---|---|
| 1 | 0–35 | A | B | C | Aquecimento (versão de 30 min + 5 min de feedback) |
| 2 | 35–75 | B | C | A | Médio (versão de 30 min + 10 min de feedback) |
| 3 | 75–115 | C | A | B | Médio ou difícil (versão de 30 min + 10 min de feedback) |
| Fechamento | 115–120 | todos | | | Cada grupo compartilha uma lição com a turma |

Cada entrevistador escolhe um problema diferente, para que ninguém veja o seu problema antes. Guarde as fichas: elas são o melhor registro do seu progresso e um bom material para as [histórias comportamentais](../behavioral/index.md).
