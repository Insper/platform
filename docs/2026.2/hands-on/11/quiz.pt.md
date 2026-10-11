Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## IA no CI/CD

**Q1.** Por que o workflow de revisão com IA usa `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` sem que o desenvolvedor precise criar esse secret manualmente?

- A. Ele é obtido das configurações pessoais do desenvolvedor no GitHub em tempo de execução
- B. O GitHub Actions injeta automaticamente o `GITHUB_TOKEN` em cada execução de workflow, com escopo restrito ao repositório e às permissões declaradas pelo workflow
- C. É um token global fornecido pela Anthropic para todas as integrações com o GitHub
- D. Ele precisa ser definido manualmente no cofre de secrets da organização antes que o workflow possa rodar

??? success "Resposta"
    **B — O `GITHUB_TOKEN` é injetado automaticamente pelo GitHub Actions em cada execução de workflow.**

    O GitHub gera um `GITHUB_TOKEN` efêmero no início de cada execução de workflow. As operações permitidas são controladas pelo bloco `permissions:` do arquivo do workflow — neste caso, `pull-requests: write` e `contents: read`. O token expira quando o workflow termina e nunca fica visível fora da execução. Você só precisa criar secrets manualmente para serviços externos, como o `ANTHROPIC_API_KEY`.

---

**Q2.** O que `fetch-depth: 0` faz na etapa `actions/checkout`, e por que o script de revisão precisa disso?

- A. Baixa todas as branches do repositório para que o script possa comparar quaisquer duas refs
- B. Busca o histórico completo do git, e não apenas o último commit (o padrão `fetch-depth: 1`), o que é necessário para calcular o diff entre a branch do PR e sua branch base
- C. Ativa clones rasos (shallow), mais rápidos de baixar em repositórios grandes
- D. Não tem efeito no cálculo do diff — a biblioteca PyGithub busca o diff diretamente na API do GitHub, independentemente do histórico local do git

??? success "Resposta"
    **B — O histórico completo é necessário para encontrar a base do merge e calcular o diff.**

    Por padrão, o `actions/checkout` clona com `--depth 1`, o que traz apenas o último commit. Comparar uma branch de PR com sua base exige conhecer o commit ancestral comum. Com `fetch-depth: 0`, o git tem o histórico completo e consegue identificar esse ancestral. A função `get_pr_diff` deste hands-on, na verdade, usa a API do GitHub (via PyGithub) para buscar os patches dos arquivos, então `fetch-depth: 0` importa principalmente se você passar a calcular os diffs localmente com `git diff`.

---

**Q3.** O diff de um PR grande tem 5 000 linhas alteradas. A função `get_pr_diff` trunca depois de 3 000 linhas. Quais são duas abordagens melhores para lidar com diffs grandes sem perder cobertura?

- A. Aumentar `max_tokens` para 8 192 e remover o limite de truncamento — o modelo vai tratar tudo em uma única chamada
- B. Dividir o diff em várias chamadas à API (uma por arquivo ou por fronteira de serviço), ou priorizar os tipos de arquivo mais críticos (por exemplo, controllers e services Java) e pular arquivos de teste e código gerado
- C. Dividir o PR em PRs menores antes de abri-lo — o workflow deveria rejeitar diffs com mais de 3 000 linhas
- D. Usar um modelo mais barato e rápido para diffs grandes e reservar o `claude-sonnet-4-6` apenas para PRs pequenos e focados

??? success "Resposta"
    **B — Dividir em várias chamadas ou priorizar os tipos de arquivo críticos.**

    O contexto de 200k tokens do Claude Sonnet tecnicamente comporta um diff grande em uma única chamada, mas o custo cresce com o número de tokens e a latência aumenta com o tamanho do contexto. Uma abordagem mais inteligente é revisar os arquivos em grupos (por exemplo, uma chamada à API por microsserviço) e publicar comentários separados, ou ordenar os arquivos por criticidade e pular mudanças de pouco valor, como código gerado automaticamente, arquivos de lock e fixtures de teste. Dividir também permite fornecer contexto específico de cada arquivo no system prompt.

---

**Q4.** Por que a revisão por IA deve ser não bloqueante (apenas comentários), em vez de bloquear merges por padrão?

- A. O GitHub não suporta verificações de status obrigatórias vindas de chamadas a APIs de terceiros
- B. Modelos de IA produzem tanto falsos positivos (apontam código correto) quanto falsos negativos (deixam passar problemas reais); um falso positivo que bloqueia um merge atrapalha o fluxo de trabalho dos desenvolvedores e corrói a confiança antes que o time tenha validado a precisão do modelo no seu código
- C. Bloquear exige um plano pago do GitHub, que não está disponível para repositórios de alunos
- D. Comentários são processados mais rápido que verificações de status, então aparecem antes da chegada do revisor humano

??? success "Resposta"
    **B — Falsos positivos bloqueiam merges e corroem a confiança antes que a precisão seja comprovada.**

    LLMs são probabilísticos. Em bases de código para as quais não foram ajustados, eles vão apontar coisas que são intencionais ou irrelevantes para o projeto. Um merge bloqueado por um falso positivo gera atrito e ensina os desenvolvedores a ignorar a saída da revisão por IA. O padrão seguro é: comece apenas com comentários, meça precisão e recall no seu código ao longo de várias semanas e, então, aplique o bloqueio seletivamente apenas a verificações de alta confiança — tipicamente a detecção de segredos, que tem taxa de falsos positivos próxima de zero.

---

**Q5.** Que permissão do GitHub o workflow precisa declarar para permitir que o script publique um comentário no PR, e onde ela é declarada?

- A. `issues: write` — declarada dentro do bloco `env:` do job
- B. `pull-requests: write` — declarada no bloco `permissions:` de nível superior do arquivo do workflow, que restringe as operações permitidas ao `GITHUB_TOKEN`
- C. `repository: admin` — declarada na página de configurações do Actions da organização
- D. `contents: write` — declarada na etapa que chama o `ai_review.py`

??? success "Resposta"
    **B — `pull-requests: write` no bloco `permissions:` de nível superior.**

    O bloco `permissions:` de um arquivo de workflow define o escopo do `GITHUB_TOKEN` injetado automaticamente. Sem `pull-requests: write`, qualquer chamada a `pr.create_issue_comment()` falha com HTTP 403. A permissão `contents: read` também é necessária para que a etapa de checkout consiga clonar o repositório. Declarar apenas as permissões necessárias segue o princípio do menor privilégio — o token não consegue realizar operações além do que o workflow exige.

---

**Q6.** Você quer que a revisão também detecte anotações OpenAPI ausentes (`@Operation`, `@ApiResponse`) nos controllers REST. Que mudança única consegue isso da forma mais eficaz?

- A. Adicionar um job separado no workflow que use uma ferramenta de análise estática, como o Spotbugs, para procurar anotações ausentes
- B. Adicionar uma linha à lista "Focus on:" do `SYSTEM_PROMPT`: "6. Missing OpenAPI annotations (`@Operation`, `@ApiResponse`) on REST controller methods." O prompt é o principal ponto de controle sobre o que o modelo percebe
- C. Trocar para um modelo maior (`claude-opus-4`) — ele tem mais dados de treinamento sobre os padrões OpenAPI e vai detectar isso automaticamente
- D. Pós-processar a saída do modelo com uma regex que procure `@RestController` no diff e aponte todo método sem `@Operation`

??? success "Resposta"
    **B — Adicionar a verificação à lista "Focus on:" do `SYSTEM_PROMPT`.**

    O system prompt é a forma mais barata e direta de mudar o foco da revisão. O modelo tem amplo conhecimento de Spring Boot e OpenAPI; ele só precisa de uma instrução explícita para aplicar esse conhecimento. Um pós-processador com regex (opção D) seria frágil e perderia o contexto. Um job separado de análise estática (opção A) é válido, mas acrescenta infraestrutura para algo que o modelo consegue tratar na mesma chamada. Trocar de modelo (opção C) aumenta o custo sem atacar a causa raiz — a instrução que faltava.

---

**Q7.** Qual é o trade-off de custo e latência de aumentar `max_tokens` de 1 024 para 4 096 na chamada à API?

- A. `max_tokens` é um limite rígido para o tamanho da entrada, não da saída — aumentá-lo não tem efeito no custo nem na latência
- B. Um `max_tokens` maior reserva mais orçamento de saída, o que aumenta o máximo de tokens de saída cobrados e pode aumentar a latência; para revisões de PR, 1 024 tokens (~750 palavras) costumam bastar, e limites maiores só se justificam para saída JSON estruturada com muitos campos ou para diffs muito grandes
- C. O Claude cobra por requisição, não por token, então `max_tokens` não tem efeito no custo
- D. Aumentar `max_tokens` reduz a latência, porque o modelo antecipa mais conteúdo em um único bloco de streaming

??? success "Resposta"
    **B — Um `max_tokens` maior permite uma saída mais longa, mas aumenta o custo máximo e a latência.**

    A Anthropic cobra pelos tokens de saída efetivamente gerados, até o limite de `max_tokens`. Definir um `max_tokens` alto não garante que o modelo use todos eles, mas permite que ele produza respostas mais longas quando quiser. Num comentário de PR, revisões com mais de ~750 palavras raramente são lidas com atenção — a concisão é uma qualidade. Use limites maiores quando precisar de uma saída estruturada extensa (por exemplo, gerar stubs completos de testes JUnit ou um objeto JSON detalhado com muitos campos).

---

**Q8.** Um time quer gerar automaticamente stubs de testes JUnit 5 para cada novo método público adicionado em um PR. Como você modificaria o workflow existente para isso?

- A. Substituir o `SYSTEM_PROMPT` por um prompt de geração de testes e publicar os testes como comentário — nenhuma outra mudança é necessária
- B. Fazer o parse do diff para extrair as assinaturas dos novos métodos públicos dos arquivos Java, enviar essas assinaturas à API com um system prompt de geração de testes e, então, publicar os stubs gerados como comentário no PR ou abrir uma branch e um PR de acompanhamento com os novos arquivos de teste commitados
- C. Adicionar uma etapa `pytest` depois da etapa de revisão por IA, que gere testes usando análise de cobertura
- D. Usar anotações `@SpringBootTest` na descrição do PR para disparar a geração automática de esqueletos de teste no runner de CI

??? success "Resposta"
    **B — Extrair as assinaturas de métodos do diff, chamar a API com um prompt de geração de testes e, então, commitar os stubs ou publicá-los como comentário.**

    A principal mudança em relação a este hands-on está no system prompt e na lógica de pós-processamento. Em vez de pedir uma revisão, você pede stubs de testes JUnit 5. A etapa de parse do diff precisa identificar especificamente as assinaturas dos novos métodos `public` (e não todas as linhas alteradas). A saída pode ser publicada como comentário (mais rápido de implementar) ou commitada em uma branch e aberta como um PR complementar (mais útil, exige `contents: write` e etapas de git push). Em qualquer caso, o mesmo esqueleto GitHub Actions + API do Claude deste hands-on se aplica diretamente.
