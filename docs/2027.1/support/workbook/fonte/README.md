# System Design workbook (2027.1, classes 1 to 16)

One activity per class, to do on paper: the 16 classes of the course, from *What is System Design* to *Case Studies*. Each activity has the class question, a summary ("What you need to know"), 7 or 8 exercises at three levels (warm-up, practice and challenge) and boxes with a QR code that open a scenario of the System Design Playground. The worked answers are at the end of the workbook; the band at the top of each activity gives their page.

Same design as the instructor's Machine Learning workbook (`ML/docs/2026.2/support/workbook/`), adapted to this course: BoxOffice as the running example and the colours of the design method.

- `workbook.tex`: the master (cover, contents, the order of the classes and the answers section).
- `preamble.tex`: packages, colours and macros (`\activity`, `\stages` with `\stClarify`, `\stEstimate`, `\stDesign`, `\stDeep`, `know`, `ex`, `\items`, `\lines`, `\frameblank`, `\palette` with `\comp{category}{Label}`, `\simulator`, `\ansclass`, `\ans`, `\final`, `\careful`).
- `how-to-use.tex`: the introduction "How to use this workbook".
- `activities/<slug>.tex` and `answers/<slug>.tex`: the activity and the worked answers of each class (`<slug>` is the class folder: `intro`, `estimation`, `distributed`, `edge`, `compute`, `databases`, `caching`, `messaging`, `reliability`, `observability`, `network-security`, `cloud-native`, `ai-systems`, `ai-delivery`, `performance`, `case-studies`).
- `verify/<slug>.py`: recomputes every number of the activity and of its answers (Python 3, standard library only; each prints `<slug> OK`).
- `test.tex`: compiles one activity and its answers alone, to check the layout while writing.
- `insper-logo.png`: the logo on the cover.
- The published PDF is `docs/2027.1/support/workbook/workbook-system-design.pdf`. This folder (`fonte/`) does not go to the site (`exclude` in `zensical.toml`).

## Build the PDF

```bash
cd docs/2027.1/support/workbook/fonte
latexmk -pdf -outdir=/tmp/workbook workbook.tex      # out of the repository: no auxiliary files here
cp /tmp/workbook/workbook.pdf ../workbook-system-design.pdf
```

One class alone (twice, for the references):

```bash
pdflatex -output-directory=/tmp/wb "\def\slug{caching}\input{test.tex}"
```

Check the numbers: `for f in verify/*.py; do python3 "$f"; done` (from `fonte/`).

Packages: `mathpazo`, `helvet`, `tcolorbox` (with `tikzfill` and `pdfcol`), `enumitem`, `lastpage`, `needspace`, `qrcode`, `fontawesome5`, `upquote` and `tikz`. On a basic TeX Live, add the missing ones with `tlmgr --usermode install <package>`. The Helvetica fonts come from the `helvetic` package.

## Conventions

- Every number said to be "from the class" is on the class page (`docs/2027.1/classes/<slug>/`); the other cases are small ones created for the workbook, self-contained and checked in `verify/`. Where class pages disagree (28- vs 30-day SLO windows, the knee per pod, hold sizes), each exercise states the value it uses.
- The exercises never ask for numbers read in the simulator: the "Check it in the simulator" boxes only show, by playing, what was just computed. The QR code points to `https://insper.github.io/platform/playground/scenarios/#<scenario-id>`; the band of each activity points to `https://insper.github.io/platform/2027.1/classes/<slug>/`.
- House style: English; no serial comma before "and"/"or"; thousands with a thin space (60 000); acronyms expanded at their first use in each activity; component names as in the simulator palette; BoxOffice services in monospace.
- Each exercise is one unbreakable block (statement, table, drawing frame and answer lines never split across pages).

## Colour system

Every colour carries one meaning, and the same meanings are used by the workbook, the cheat sheet (`../../cheat-sheet/fonte/cheat-sheet.tex`), the concept map and the study cards. Every meaning is also written in a label or an icon, so it survives greyscale printing.

| Meaning | Colour | Background | Where |
|---|---|---|---|
| **Clarify**: requirements, SLOs, scope, wrap-up (interview steps 1 and 7) | grey `#57606A` | `#F2F4F6` | stage tag `\stClarify`, cheat-sheet sections |
| **Estimate**: load, latency, capacity, cost (step 2) | blue `#1F5FAD` | `#EAF1FA` | `\stEstimate` |
| **Design**: API, data model, components, patterns (steps 3 and 4) | purple `#6B3FA0` | `#F2ECF8` | `\stDesign`, component cards |
| **Deep dive**: failure modes, bottlenecks, trade-offs (steps 5 and 6) | orange `#B4530A` | `#FCF1E7` | `\stDeep` |
| The answer and its reasoning | green `#1E7B4F` | `#EAF5EF` | `\final` |
| The most common mistake, traps | red `#B42318` | `#FCEEEE` | `\careful`, "Trap" |
| Class summary | teal `#0B6E6E` | `#EAF5F5` | `know` box |
| Simulator | plum `#8A2D6E` | `#F8EEF4` | `\simulator` box |
| Course identity | Insper red `#C8102E` | | activity band, headers |

Exercise levels use a separate scale that also reads by the dots and the name: warm-up green `#1E7B4F` (•), practice blue `#1F5FAD` (••), challenge red `#B42318` (•••).

**Palette chips** (`\comp{category}{Label}`) carry identity, not meaning: a small bar in the colour of the component's category in the simulator (`docs/assets/stylesheets/playground.css`): client `#2563EB`, edge `#7C3AED`, compute `#16A34A`, storage `#EA580C`, messaging `#D97706`, observability `#0D9488`, network `#65A30D`, ai `#DB2777`, external `#64748B`. They are always next to the component's name.
