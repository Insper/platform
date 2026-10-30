# Folha de Consulta: Design de Sistemas { #cheat-sheet-system-design }

O essencial das 16 aulas em oito páginas A4 em paisagem (quatro folhas, impressas frente e verso):

- **Páginas 1 a 3, o método de design passo a passo:** os seis passos no topo da página 1 (requisitos, estimativas, API e dados, design de alto nível, aprofundamentos, gargalos e trade-offs); depois, para cada passo, o que decidir e o que dizer, as fórmulas e os números (latências, potências de dois, Lei de Little, utilização e latência, percentis e fan-out, disponibilidade, error budgets e burn rates, taxa de acerto, quóruns, capacidade e custo), um diagnóstico rápido "sintoma → causa → o que fazer" e o BoxOffice em uma página, o design de referência desenhado com a paleta.
- **Páginas 4 a 6, os componentes um a um:** os 44 componentes da paleta do simulador, categoria por categoria (cliente, tráfego e borda, computação, armazenamento, mensageria, observabilidade, rede, IA e agentes, externos): o que cada um é, quando usá-lo e quando não, seus números-chave, como falha e produtos reais. Depois, os padrões que os combinam: cache, mensageria, resiliência, consistência e IA.
- **Páginas 7 e 8, aula por aula:** a pergunta de cada aula, o que levar dela, seus números-chave, uma frase para dizer numa entrevista e sua armadilha mais comum, além dos 25 cenários do playground.

As cores são as mesmas do caderno, do mapa de conceitos e das cartas de estudo: cinza para esclarecer (requisitos, SLOs, escopo e o fechamento), azul para estimar, roxo para projetar, laranja para o aprofundamento (falhas, gargalos e trade-offs), verde para a resposta e vermelho para as armadilhas. Ao lado de cada componente, uma pequena etiqueta tem a cor da sua categoria no simulador.

Tenha-a à mão enquanto trabalha no [caderno](../workbook/index.md), no [playground](../../../playground/index.md) ou no projeto. Para revisar, o [mapa de conceitos](../concept-map/index.md) mostra como as ideias se ligam e as [cartas de estudo](../flashcards/index.md) treinam a sua memória; para entrevistas, veja a [preparação para entrevistas](../interview/index.md). A folha de consulta está em inglês.

[:material-download: Baixar a folha de consulta (PDF)](cheat-sheet-system-design.pdf){ .md-button .md-button--primary } [:material-graph-outline: Mapa de conceitos](../concept-map/index.md){ .md-button } [:material-cards-outline: Cartas de estudo](../flashcards/index.md){ .md-button }

<div class="pdf-embed">
  <iframe src="cheat-sheet-system-design.pdf#view=FitH" title="Folha de consulta de Design de Sistemas (PDF)" loading="lazy"></iframe>
</div>

Se o PDF não aparecer acima (alguns celulares não exibem PDFs dentro de uma página), use o botão **Baixar**.
