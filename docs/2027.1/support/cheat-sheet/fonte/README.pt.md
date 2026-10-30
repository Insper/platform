# Folha de consulta de Design de Sistemas (2027.1) { #system-design-cheat-sheet-20271 }

O essencial das 16 aulas em oito páginas A4 em paisagem (quatro folhas, impressas frente e verso), três colunas por página:

1. a 3. **O método, passo a passo**: os sete passos da entrevista com seus minutos no topo da página 1; esclarecer (requisitos, atributos de qualidade, metas do BoxOffice); estimar (potências de dois, tempo, latências, throughput por instância, tamanhos, a abertura de vendas num guardanapo); carga, latência e capacidade (Lei de Little, utilização, M/M/1 e o joelho, modelos fechados vs abertos, Amdahl e USL, número de réplicas); percentis e fan-out; disponibilidade, noves, SLOs, error budgets e alertas de burn rate; API e modelo de dados; consistência, quóruns, replicação, particionamento; design de alto nível e a jornada de escala; a matemática dos aprofundamentos (cache, fila, Kafka, resiliência, LLM, recuperação); gargalos como "sintoma → causa → o que fazer"; trade-offs; fechamento; segurança, entrega e medição em resumo; o BoxOffice em uma página (o design de referência desenhado com a paleta); os padrões que combinam os componentes (cache, mensageria, resiliência, IA).
4. a 6. **A paleta, componente por componente**: os 49 componentes do simulador em 10 categorias (o que é, quando usar, números-chave com os padrões do simulador, modos de falha, produtos).
7. e 8. **Aula por aula**: a pergunta de cada aula, três lições, seus números-chave, uma frase para dizer numa entrevista e sua armadilha mais comum; e os 28 cenários do playground.

- `cheat-sheet.tex`: o fonte (um arquivo).
- O PDF publicado é `docs/2027.1/support/cheat-sheet/cheat-sheet-system-design.pdf`. Esta pasta (`fonte/`) não vai para o site (`exclude` em `zensical.toml`).

## Gerar o PDF { #build-the-pdf }

```bash
cd docs/2027.1/support/cheat-sheet/fonte
latexmk -pdf -outdir=/tmp/cheat cheat-sheet.tex      # out of the repository: no auxiliary files here
cp /tmp/cheat/cheat-sheet.pdf ../cheat-sheet-system-design.pdf
```

Pacotes (TeX Live): `mathpazo`, `helvet`, `amsmath`, `geometry`, `xcolor`, `enumitem`, `fancyhdr`, `lastpage`, `tabularx`, `multicol`, `fontawesome5`, `tikz`, `tcolorbox` (opção `most`), `microtype`, `upquote`, `ragged2e`, `needspace` e `hyperref`.

## Convenções { #conventions }

- Oito páginas, três colunas cada. As páginas 1 a 3 correm num único `multicols*`, com `\columnbreak` antes das seções que, de outro modo, começariam no pé de uma coluna; as páginas 4 a 6 começam com `\pagetitle` e deixam os cartões correrem (com um `\columnbreak` antes de *Observability* e *Network*); as páginas 7 e 8 trazem os 16 cartões das aulas. Depois de qualquer mudança, compile e olhe todas as páginas (`pdftoppm -r 70 -png cheat-sheet.pdf p`): o PDF precisa continuar com 8 páginas, nenhum título de seção pode ficar sozinho no pé de uma coluna e o log não pode ter `Overfull`.
- Os cartões de componente usam o ambiente `card` com `\f` (campo) e `\ff` (campo de falha); os cartões de aula usam `klass` com `\question`, `\nums`, `\say` e `\pit`.
- Os números vêm das páginas das aulas em inglês (`docs/2027.1/classes/*/`), do catálogo de componentes (`docs/2027.1/reference/components/`) e da página de números (`docs/2027.1/reference/numbers/`); os valores "sim" são os padrões de `docs/assets/javascripts/playground/catalog.js`.
- Cores: o mesmo sistema do caderno, documentado em `../../workbook/fonte/README.md` (cinza esclarecer, azul estimar, roxo projetar, laranja aprofundar, verde resposta, vermelho armadilha; etiquetas de categoria nas cores do simulador, só identidade). Todo significado de cor também tem um rótulo ou um ícone.
- Estilo da casa: inglês; sem vírgula serial antes de "and"/"or"; milhares com espaço fino; toda sigla por extenso no primeiro uso; todo símbolo definido onde aparece.
