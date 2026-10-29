# System Design cheat sheet (2027.1)

The essentials of the 16 classes on eight landscape A4 pages (four sheets, printed on both sides), three columns per page:

1. to 3. **The method, step by step**: the seven interview steps with their minutes at the top of page 1; clarify (requirements, quality attributes, BoxOffice targets); estimate (powers of two, time, latency numbers, throughput per instance, sizes, the on-sale on a napkin); load, latency and capacity (Little's Law, utilization, M/M/1 and the knee, closed vs open models, Amdahl and USL, replica count); percentiles and fan-out; availability, nines, SLOs, error budgets and burn-rate alerts; API and data model; consistency, quorums, replication, partitioning; high-level design and the scaling journey; the math of the deep dives (cache, queue, Kafka, resilience, LLM, recovery); bottlenecks as "symptom → cause → what to do"; trade-offs; wrap-up; security, delivery and measurement in brief; BoxOffice on one page (the reference design drawn with the palette); the patterns that combine the components (caching, messaging, resilience, AI).
4. to 6. **The palette, component by component**: the 49 components of the simulator in 10 categories (what it is, when to use it, key numbers with the simulator defaults, failure modes, products).
7. and 8. **Class by class**: each class's question, three take-aways, its key numbers, a sentence to say in an interview and its most common trap; and the 28 playground scenarios.

- `cheat-sheet.tex`: the source (one file).
- The published PDF is `docs/2027.1/support/cheat-sheet/cheat-sheet-system-design.pdf`. This folder (`fonte/`) does not go to the site (`exclude` in `zensical.toml`).

## Build the PDF

```bash
cd docs/2027.1/support/cheat-sheet/fonte
latexmk -pdf -outdir=/tmp/cheat cheat-sheet.tex      # out of the repository: no auxiliary files here
cp /tmp/cheat/cheat-sheet.pdf ../cheat-sheet-system-design.pdf
```

Packages (TeX Live): `mathpazo`, `helvet`, `amsmath`, `geometry`, `xcolor`, `enumitem`, `fancyhdr`, `lastpage`, `tabularx`, `multicol`, `fontawesome5`, `tikz`, `tcolorbox` (option `most`), `microtype`, `upquote`, `ragged2e`, `needspace` and `hyperref`.

## Conventions

- Eight pages, three columns each. Pages 1 to 3 flow in one `multicols*`, with `\columnbreak` before the sections that would otherwise start at the foot of a column; pages 4 to 6 start with `\pagetitle` and let the cards flow (with a `\columnbreak` before *Observability* and *Network*); pages 7 and 8 hold the 16 class cards. After any change, compile and look at every page (`pdftoppm -r 70 -png cheat-sheet.pdf p`): the PDF must keep 8 pages, no section header may be left alone at the bottom of a column and the log must have no `Overfull`.
- Component cards use the `card` environment with `\f` (field) and `\ff` (failure field); class cards use `klass` with `\question`, `\nums`, `\say` and `\pit`.
- Numbers come from the English class pages (`docs/2027.1/classes/*/`), the component catalog (`docs/2027.1/reference/components/`) and the numbers page (`docs/2027.1/reference/numbers/`); "sim" values are the defaults of `docs/assets/javascripts/playground/catalog.js`.
- Colours: the same system as the workbook, documented in `../../workbook/fonte/README.md` (grey clarify, blue estimate, purple design, orange deep dive, green answer, red trap; category chips in the simulator's colours, identity only). Every colour meaning also has a label or an icon.
- House style: English; no serial comma before "and"/"or"; thin-space thousands; every acronym expanded at first use; every symbol defined where it appears.
