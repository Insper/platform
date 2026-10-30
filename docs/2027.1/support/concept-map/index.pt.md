---
hide:
  - navigation
  - toc
---

# Mapa de Conceitos: Design de Sistemas { #concept-map-system-design }

Cada aula de Arquitetura de Sistemas ensina um punhado de ideias; o projeto, as provas e uma entrevista de system design pedem que você as use juntas. Este mapa mostra como elas se ligam: 158 conceitos das 16 aulas e 266 ligações entre eles, cada uma explicada em uma frase.

**Como ele é organizado.** Cada conceito fica na **linha** do tema da aula em que aparece pela primeira vez, na ordem da disciplina: Fundamentos (C1–C2), Sistemas distribuídos (C3), Borda e computação (C4–C5), Armazenamento (C6–C7), Mensageria (C8), Operações (C9–C12), IA (C13–C14), Desempenho e casos (C15–C16). Sua **coluna** é a etapa do design a que pertence, na mesma ordem em que você constrói e defende um design, no trabalho ou numa entrevista:

| Coluna | O que contém | Cor |
|---|---|---|
| Requisitos e números | o que precisa valer e quanto: requisitos, estimativas, Lei de Little, percentis, noves, SLOs, capacidade, custo | azul |
| Blocos de construção | os componentes da paleta e como cada um funciona: DNS, CDN, load balancer, gateway, fila, Kafka, cache, Kubernetes, gateway de LLM… | roxo |
| Dados e consistência | estado e corretude: replicação, modelos de consistência, quóruns, transações, idempotência, ordenação, invalidação, outbox, sagas | verde-azulado |
| Operar em escala | manter no ar e seguro em produção: modos de falha, padrões de resiliência, observabilidade, alertas, entrega, segurança, testes de carga, caos | laranja |

Ler uma linha da esquerda para a direita conta a história de uma aula: os números que a motivam, os componentes que ela acrescenta, as questões de corretude que eles levantam e como falham em produção. Ler uma coluna de cima para baixo mostra uma habilidade crescendo ao longo da disciplina. O código no canto de cada conceito é a página de aula em que ele aparece pela primeira vez (C9.2 = aula 9, segunda página do seu roteiro). As cores são as mesmas das [cartas de estudo](../flashcards/index.md); azul, roxo e laranja também significam *estimar*, *projetar* e *aprofundar* no [caderno](../workbook/index.md) e na [folha de consulta](../cheat-sheet/index.md).

Quatro maneiras de usá-lo:

- **Toque num conceito.** Seus vizinhos se acendem e o painel mostra o que ele é, as aulas em que é ensinado (com link para a seção) e, em uma frase cada, aonde ele leva e de onde vem. Toque num vizinho para seguir o fio.
- **Siga uma trilha.** Cada trilha percorre, passo a passo, uma das perguntas da disciplina, como "por que o p99 explode enquanto a CPU está ociosa?", "uma venda relâmpago sem reserva dupla" ou "por que o seu teste de carga mente". Use ‹ › no painel ou as setas do teclado.
- **Escolha uma aula.** Os botões são agrupados por tema; eles acendem os conceitos que a aula apresenta e os que ela retoma de aulas anteriores. Cada botão cobre as subpáginas da aula.
- **Pesquise.** A caixa de busca encontra um conceito pelo nome ou pela definição (Enter abre o primeiro resultado).

No celular, os conceitos são agrupados por tema, as aulas ficam sob uma aba por tema e o painel sobe da parte de baixo da tela; feche-o com ×.

<div class="dgm" data-dgm="mapa-arq" data-title="Os conceitos de Arquitetura de Sistemas e como eles se ligam"></div>

Para praticar os conceitos um a um, use as [cartas de estudo](../flashcards/index.md); para ver o método, as fórmulas e os números no papel, a [folha de consulta](../cheat-sheet/index.md); para praticar com exercícios, o [caderno](../workbook/index.md); para ensaiá-los em voz alta, a [preparação para entrevistas](../interview/index.md).
