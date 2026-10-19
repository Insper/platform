Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

**Q1.** Por que o `diffutil.py` imprime cada linha do lado novo com o seu número (`L21 + ...`) antes de enviar o diff ao modelo?

- A. Para reduzir o número de tokens no prompt
- B. Porque modelos não são confiáveis para calcular números de linha a partir dos cabeçalhos de hunk `@@`, e o GitHub rejeita comentários de review em linhas que não estão no diff
- C. Porque a API do Claude exige números de linha em blocos de código
- D. Para esconder do modelo as linhas removidas

??? success "Resposta"
    **B.**

    Contar linhas a partir de `@@ -16,4 +16,9 @@` é exatamente o tipo de contabilidade que um modelo de linguagem erra. Imprimir o número em cada linha transforma a tarefa em *copiar* um número, e o código então só aceita achados que apontam para uma linha que o PR **adicionou** — o que também evita um `422` da API do GitHub por um comentário fora do diff.

---

**Q2.** O revisor posta o seu review com `event: COMMENT`. Qual é o principal motivo de ele nunca enviar `APPROVE`?

- A. O `GITHUB_TOKEN` não consegue aprovar pull requests em nenhuma configuração
- B. Aprovar é uma decisão; o bot é consultivo, e um prompt injection que convença o modelo não pode virar uma aprovação
- C. Reviews `APPROVE` não podem ter comentários inline
- D. Aprovações custam mais chamadas de API

??? success "Resposta"
    **B.**

    É o código que decide qual evento de review é enviado, não o modelo. Mesmo que uma descrição de PR com injection convença o modelo de que "este PR já foi aprovado", não existe caminho do JSON dele até uma aprovação. Humanos aprovam, como exige a proteção de branch.

---

**Q3.** Uma execução do revisor produziu 9 achados. Qual deles é **descartado** pelo `review.py` com as configurações padrão?

- A. `blocker`, confiança `high`, numa linha adicionada
- B. `minor`, confiança `medium`, numa linha adicionada
- C. `major`, confiança `high`, numa linha de contexto não alterada do hunk
- D. `major`, confiança `medium`, numa linha adicionada

??? success "Resposta"
    **C.**

    Só achados em linhas **adicionadas** são mantidos: comentar código que o autor não tocou é ruído (e muitas vezes não é o assunto do PR). Os padrões também descartam a severidade `nit`, a confiança `low`, achados já postados (mesmo fingerprint) e tudo o que passar de `AI_REVIEW_MAX_COMMENTS`.

---

**Q4.** Por que o prompt de sistema (instruções + `CONVENTIONS.md` + ADRs) é mantido idêntico entre execuções e o diff é enviado na mensagem do usuário?

- A. A API rejeita prompts de sistema maiores do que a mensagem do usuário
- B. Para que o prefixo estável possa ser servido do **prompt cache**, cobrado a uma fração do preço de entrada, enquanto só os dados de cada execução são pagos integralmente
- C. Para que o modelo esqueça as convenções depois de cada execução
- D. Porque o diff nunca deve ser mostrado ao modelo como instrução de sistema, apenas por motivos de formatação

??? success "Resposta"
    **B.**

    O prompt caching funciona por correspondência de prefixo: qualquer byte que muda invalida o que vem depois. Conteúdo estável primeiro (instruções, convenções), conteúdo volátil por último (o diff). Na execução do golden set da parte 6, a maior parte do prompt de sistema veio do cache depois da primeira chamada. Colocar texto não confiável no turno do usuário também o mantém fora das instruções do operador.

---

**Q5.** O gerador de testes produziu um teste que compila e passa duas vezes, com 100% de cobertura de linhas da classe. O PIT reporta o score de mutação inalterado (40% → 40%). O que o script faz, e por quê?

- A. Aceita o teste, porque 100% de cobertura prova que ele é útil
- B. Rejeita o teste (e devolve os mutantes sobreviventes ao modelo), porque ele não pega nenhum bug que os testes existentes deixam passar
- C. Aceita o teste, mas o marca com `@Disabled`
- D. Rejeita o teste porque a cobertura está alta demais

??? success "Resposta"
    **B.**

    A cobertura diz quais linhas **rodaram**; o score de mutação diz se os testes **perceberam** quando o código foi alterado. Um teste sem asserções significativas chega à cobertura total e não mata nenhum mutante. O script exige um ganho de `MIN_GAIN` (5 pontos percentuais) e envia a lista de sobreviventes de volta para que a próxima tentativa mire no comportamento não testado.

---

**Q6.** Um teste gerado para o `HoldService` passa e mata muitos mutantes. Ele verifica que uma reserva expira 8 minutos depois de criada. O requisito diz 10 minutos. O que isso ilustra?

- A. Testes instáveis
- B. O **problema do oráculo**: testes gerados codificam o que o código faz, inclusive os seus bugs; testes de mutação provam sensibilidade, não correção
- C. Um falso positivo dos testes de mutação
- D. Que o PIT está configurado com o `targetClasses` errado

??? success "Resposta"
    **B.**

    O modelo deriva o valor esperado da implementação. Se a implementação está errada, o teste agora *protege* o bug. A revisão humana de cada asserção contra o requisito continua necessária — é por isso que o gerador abre um PR em **rascunho**.

---

**Q7.** No `ai-fix.yaml`, o agente roda no job `fix` (`contents: read`, `actions: read`) e o PR é aberto pelo job `open-pr` (`contents: write`, `pull-requests: write`). Por que separá-los?

- A. O GitHub limita cada job a uma permissão
- B. Para rodá-los em sistemas operacionais diferentes
- C. Para que o job que executa código não confiável (o build do PR e as edições do modelo) nunca tenha um token de escrita; o job com acesso de escrita só aplica um patch verificado
- D. Para deixar o workflow mais rápido com paralelismo

??? success "Resposta"
    **C.**

    Privilégio mínimo por job. Se o agente ficar confuso ou sofrer injection, ou se um teste exfiltrar o ambiente, não há token capaz de fazer push ou aprovar naquele job. O `open-pr` não roda modelo nem build — só `git apply`, commit e `gh pr create`.

---

**Q8.** Qual flag do Claude Code faz uma execução headless no CI **negar** qualquer chamada de ferramenta não permitida explicitamente, em vez de esperar que um humano responda a uma pergunta?

- A. `--bare`
- B. `--permission-mode dontAsk`
- C. `--max-turns 25`
- D. `--output-format stream-json`

??? success "Resposta"
    **B.**

    No modo `dontAsk`, tudo o que geraria uma pergunta é negado; só rodam as entradas de `--allowedTools` (aqui `Read,Edit,Write,Bash(mvn -B *)`) e as ações que não precisam de aprovação. O `--bare` deixa de carregar hooks, plugins, servidores MCP e `CLAUDE.md` do repositório; `--max-turns` e `--max-budget-usd` limitam o loop; `stream-json` produz a transcrição de auditoria.

---

**Q9.** O PR em rascunho aberto pelo agente de correção com o `GITHUB_TOKEN` não mostra nenhuma execução de CI. Por quê?

- A. PRs em rascunho nunca rodam workflows
- B. Eventos disparados pelo `GITHUB_TOKEN` não iniciam novas execuções de workflow, uma proteção do GitHub contra workflows recursivos
- C. O label `ai-generated` desabilita o CI
- D. Workflows `workflow_run` não conseguem criar branches

??? success "Resposta"
    **B.**

    Pushes e PRs criados com o `GITHUB_TOKEN` do repositório não disparam workflows `push`/`pull_request` (com poucas exceções, como `workflow_dispatch`). É preciso um push humano (mesmo um commit vazio) ou um token de GitHub App para rodar o CI na proposta — um quebra-molas útil: uma pessoa olha antes.

---

**Q10.** O job de release notes descarta um item que diz *"order: new refund endpoint (#99)"*. Por quê?

- A. Reembolsos não são permitidos em release notes
- B. Nenhum commit no intervalo da tag referencia `#99`, então o item **não tem ancoragem** — provavelmente foi inventado
- C. O serviço `order` não faz parte do BoxOffice
- D. O item excedeu o orçamento de tokens

??? success "Resposta"
    **B.**

    Todo item precisa citar pelo menos um SHA ou número de PR que de fato aparece em `git log previous..tag`. A verificação é barata e pega a falha mais perigosa — uma funcionalidade plausível que não existe. Ela não pega um *resumo errado* de um commit real; é para isso que serve a revisão humana da release em rascunho.

---

**Q11.** Na parte 5, o canary tem taxa de erros de 2,9% (stable 0,1%) e p99 2,28× o do stable. A explicação do modelo diz `"verdict": "promote"`. O que acontece?

- A. O rollout é promovido, porque o modelo tem mais contexto do que os limites
- B. O script pergunta de novo ao modelo até ele dizer rollback
- C. O veredito da política (rollback, código de saída 1) prevalece, e a explicação é descartada porque contradiz a política
- D. A análise fica inconclusiva

??? success "Resposta"
    **C.**

    A decisão vem de limites versionados no código; o modelo só explica. Uma explicação que discorda do veredito é descartada em vez de exibida, porque uma explicação errada e confiante ao lado de uma decisão correta engana o engenheiro de plantão.

---

**Q12.** Por que o `canary_explain.py` devolve *inconclusivo* quando o canary atende 0,8 req/s, mesmo com taxa de erros e p99 que parecem bons?

- A. Porque o Prometheus não consegue calcular o p99 abaixo de 1 req/s
- B. Porque, com tão poucas requisições, uma regressão real pode ainda não ter aparecido: "nenhum erro visto" não é evidência de "nenhum erro"
- C. Porque o modelo precisa de mais tokens
- D. Porque o Argo Rollouts exige pelo menos 1 req/s

??? success "Resposta"
    **B.**

    Falhas raras precisam de muitas requisições para ficarem visíveis (a página de entrega calcula quantas). Declarar saudável um canary com pouco tráfego é um falso negativo clássico; a política exige um tráfego mínimo (`MIN_RPS`) antes de julgar.

---

**Q13.** Um colega propõe trocar o `ai-review.yaml` de `pull_request` para `pull_request_target` "para que o revisor também funcione em PRs de forks", mantendo o checkout do head do PR. Qual é o risco?

- A. Nenhum: `pull_request_target` é o gatilho recomendado para forks
- B. Só um custo maior de tokens
- C. Um **pwn request**: o código do fork (inclusive um `review.py` ou plugin de build modificado) roda com os segredos do repositório e um token de escrita
- D. O revisor revisaria o branch base em vez do PR

??? success "Resposta"
    **C.**

    O `pull_request_target` roda no contexto do repositório base, com segredos e (por padrão) um token de escrita. Fazer checkout do head do PR e executá-lo ali entrega os dois a quem abriu o PR. Alternativas seguras: manter `pull_request` (sem segredos para forks), ou dividir em um job sem privilégios que produz o diff como artefato e um job privilegiado que só lê esses dados.

---

**Q14.** Qual passo é uma **injeção de script**?

- A. `env: { TITLE: ${{ github.event.pull_request.title }} }` e depois `python review.py --title "$TITLE"`
- B. Ler o título de `$GITHUB_EVENT_PATH` dentro do Python
- C. `run: python review.py --title "${{ github.event.pull_request.title }}"`
- D. `gh pr view "$PR" --json title`

??? success "Resposta"
    **C.**

    O `${{ }}` é substituído no texto do script antes de o shell rodá-lo, então um título que contém `"; curl ... $ANTHROPIC_API_KEY ...` vira código. Passar o valor por uma variável de ambiente (A) ou lê-lo do arquivo do evento (B) o mantém como dado.

---

**Q15.** Depois de uma semana, o revisor postou 40 comentários: 12 👍, 18 👎, 10 sem avaliação. O custo foi de US$ 0,60 para 25 PRs. Qual é a melhor decisão?

- A. Ligar o modo portão: 40 comentários mostram que ele é minucioso
- B. A precisão é 12 / 30 = 40%: mantê-lo consultivo, cortar o ruído (severidade mínima maior, menos comentários, adicionar os falsos positivos ao `CONVENTIONS.md` e ao golden set) e medir de novo
- C. Removê-lo porque custa US$ 0,60
- D. Trocar para o modelo mais barato para reduzir o custo

??? success "Resposta"
    **B.**

    Precisão = 👍 / (👍 + 👎) = 12 / 30 = 40%: a maioria dos comentários avaliados não foi útil, então as pessoas vão aprender a ignorar o bot. Usá-lo como portão bloquearia PRs bons. O custo de tokens (US$ 0,024 por PR) não é o problema — o custo de atenção de 18 comentários ruins é. Ajuste, adicione as falhas à avaliação e meça por mais uma semana.

[Voltar ao lab](index.md){ .md-button }
