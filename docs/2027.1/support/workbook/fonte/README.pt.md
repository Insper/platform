# Caderno de Design de Sistemas (2027.1, aulas 1 a 16) { #system-design-workbook-20271-classes-1-to-16 }

Uma atividade por aula, para fazer no papel: as 16 aulas da disciplina, de *What is System Design* a *Case Studies*. Cada atividade tem a pergunta da aula, um resumo ("What you need to know"), 7 ou 8 exercícios em três níveis (aquecimento, prática e desafio) e quadros com um QR code que abrem um cenário do System Design Playground. As respostas comentadas estão no fim do caderno; a faixa no topo de cada atividade dá a página delas.

Mesmo design do caderno de Machine Learning do professor (`ML/docs/2026.2/support/workbook/`), adaptado a esta disciplina: o BoxOffice como exemplo condutor e as cores do método de design.

- `workbook.tex`: o arquivo mestre (capa, sumário, a ordem das aulas e a seção de respostas).
- `preamble.tex`: pacotes, cores e macros (`\activity`, `\stages` com `\stClarify`, `\stEstimate`, `\stDesign`, `\stDeep`, `know`, `ex`, `\items`, `\lines`, `\frameblank`, `\palette` com `\comp{category}{Label}`, `\simulator`, `\ansclass`, `\ans`, `\final`, `\careful`).
- `how-to-use.tex`: a introdução "How to use this workbook".
- `activities/<slug>.tex` e `answers/<slug>.tex`: a atividade e as respostas comentadas de cada aula (`<slug>` é a pasta da aula: `intro`, `estimation`, `distributed`, `edge`, `compute`, `databases`, `caching`, `messaging`, `observability`, `reliability`, `cloud-native`, `network-security`, `ai-systems`, `ai-delivery`, `performance`, `case-studies`).
- `verify/<slug>.py`: recalcula todos os números da atividade e das suas respostas (Python 3, só a biblioteca padrão; cada um imprime `<slug> OK`).
- `test.tex`: compila uma atividade e suas respostas isoladamente, para conferir o layout enquanto se escreve.
- `insper-logo.png`: o logo da capa.
- O PDF publicado é `docs/2027.1/support/workbook/workbook-system-design.pdf`. Esta pasta (`fonte/`) não vai para o site (`exclude` em `zensical.toml`).

## Gerar o PDF { #build-the-pdf }

```bash
cd docs/2027.1/support/workbook/fonte
latexmk -pdf -outdir=/tmp/workbook workbook.tex      # out of the repository: no auxiliary files here
cp /tmp/workbook/workbook.pdf ../workbook-system-design.pdf
```

Uma aula sozinha (duas vezes, por causa das referências):

```bash
pdflatex -output-directory=/tmp/wb "\def\slug{caching}\input{test.tex}"
```

Confira os números: `for f in verify/*.py; do python3 "$f"; done` (a partir de `fonte/`).

Pacotes: `mathpazo`, `helvet`, `tcolorbox` (com `tikzfill` e `pdfcol`), `enumitem`, `lastpage`, `needspace`, `qrcode`, `fontawesome5`, `upquote` e `tikz`. Num TeX Live básico, instale os que faltarem com `tlmgr --usermode install <package>`. As fontes Helvetica vêm do pacote `helvetic`.

## Convenções { #conventions }

- Todo número dito "da aula" está na página da aula (`docs/2027.1/classes/<slug>/`); os demais são casos pequenos criados para o caderno, autocontidos e verificados em `verify/`. Onde as páginas das aulas divergem (janelas de SLO de 28 ou 30 dias, o joelho por pod, tamanhos de reserva), cada exercício declara o valor que usa.
- Os exercícios nunca pedem números lidos no simulador: os quadros "Check it in the simulator" só mostram, brincando, o que acabou de ser calculado. O QR code aponta para `https://insper.github.io/platform/playground/scenarios/#<scenario-id>`; a faixa de cada atividade aponta para `https://insper.github.io/platform/2027.1/classes/<slug>/`.
- Estilo da casa: inglês; sem vírgula serial antes de "and"/"or"; milhares com espaço fino (60 000); siglas por extenso no primeiro uso em cada atividade; nomes de componentes como na paleta do simulador; serviços do BoxOffice em monoespaçado.
- Cada exercício é um bloco inquebrável (enunciado, tabela, quadro de desenho e linhas de resposta nunca se dividem entre páginas).

## Sistema de cores { #colour-system }

Cada cor carrega um significado, e os mesmos significados são usados pelo caderno, pela folha de consulta (`../../cheat-sheet/fonte/cheat-sheet.tex`), pelo mapa de conceitos e pelas cartas de estudo. Todo significado também está escrito num rótulo ou num ícone, para sobreviver à impressão em tons de cinza.

| Significado | Cor | Fundo | Onde |
|---|---|---|---|
| **Esclarecer**: requisitos, SLOs, escopo, fechamento (passos 1 e 7 da entrevista) | cinza `#57606A` | `#F2F4F6` | etiqueta de etapa `\stClarify`, seções da folha de consulta |
| **Estimar**: carga, latência, capacidade, custo (passo 2) | azul `#1F5FAD` | `#EAF1FA` | `\stEstimate` |
| **Projetar**: API, modelo de dados, componentes, padrões (passos 3 e 4) | roxo `#6B3FA0` | `#F2ECF8` | `\stDesign`, cartões de componente |
| **Aprofundar**: modos de falha, gargalos, trade-offs (passos 5 e 6) | laranja `#B4530A` | `#FCF1E7` | `\stDeep` |
| A resposta e seu raciocínio | verde `#1E7B4F` | `#EAF5EF` | `\final` |
| O erro mais comum, armadilhas | vermelho `#B42318` | `#FCEEEE` | `\careful`, "Trap" |
| Resumo da aula | verde-azulado `#0B6E6E` | `#EAF5F5` | quadro `know` |
| Simulador | ameixa `#8A2D6E` | `#F8EEF4` | quadro `\simulator` |
| Identidade da disciplina | vermelho Insper `#C8102E` | | faixa da atividade, cabeçalhos |

Os níveis dos exercícios usam uma escala separada, que também se lê pelos pontos e pelo nome: aquecimento verde `#1E7B4F` (•), prática azul `#1F5FAD` (••), desafio vermelho `#B42318` (•••).

**Etiquetas da paleta** (`\comp{category}{Label}`) carregam identidade, não significado: uma pequena barra na cor da categoria do componente no simulador (`docs/assets/stylesheets/playground.css`): client `#2563EB`, edge `#7C3AED`, compute `#16A34A`, storage `#EA580C`, messaging `#D97706`, observability `#0D9488`, network `#65A30D`, ai `#DB2777`, external `#64748B`. Elas ficam sempre ao lado do nome do componente.
