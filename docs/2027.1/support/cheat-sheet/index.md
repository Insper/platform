# Cheat Sheet: System Design

The essentials of all 16 classes on eight landscape A4 pages (four sheets, printed on both sides):

- **Pages 1 to 3, the design method step by step:** the six steps at the top of page 1 (requirements, estimation, API and data, high-level design, deep dives, bottlenecks and trade-offs), then, for each step, what to decide and what to say, the formulas and the numbers (latency numbers, powers of two, Little's Law, utilization and latency, percentiles and fan-out, availability, error budgets and burn rates, hit ratio, quorums, capacity and cost) a quick "symptom → cause → what to do" diagnosis and BoxOffice on one page, the reference design drawn with the palette.
- **Pages 4 to 6, the components one by one:** the 44 components of the simulator palette, category by category (client, traffic and edge, compute, storage, messaging, observability, network, AI and agents, external): what each one is, when to use it and when not, its key numbers, how it fails and real products. Then the patterns that combine them: caching, messaging, resilience, consistency and AI.
- **Pages 7 and 8, class by class:** each class's question, what to take away from it, its key numbers, a sentence to say in an interview and its most common trap, plus the 25 playground scenarios.

The colors are the same as in the workbook, the concept map and the study cards: gray for clarifying (requirements, SLOs, scope and the wrap-up), blue for estimating, purple for designing, orange for the deep dive (failures, bottlenecks and trade-offs), green for the answer and red for the traps. Next to each component, a small chip has the color of its category in the simulator.

Keep it at hand while you work through the [workbook](../workbook/index.md), the [playground](../../../playground/index.md) or the project. To review, the [concept map](../concept-map/index.md) shows how the ideas connect and the [study cards](../flashcards/index.md) train your memory; for interviews, see [interview prep](../interview/index.md).

[:material-download: Download the cheat sheet (PDF)](cheat-sheet-system-design.pdf){ .md-button .md-button--primary } [:material-graph-outline: Concept map](../concept-map/index.md){ .md-button } [:material-cards-outline: Study cards](../flashcards/index.md){ .md-button }

<div class="pdf-embed">
  <iframe src="cheat-sheet-system-design.pdf#view=FitH" title="System Design cheat sheet (PDF)" loading="lazy"></iframe>
</div>

If the PDF does not show above (some phones do not display PDFs inside a page), use the **Download** button.
