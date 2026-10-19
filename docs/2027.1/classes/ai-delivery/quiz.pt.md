Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Visão geral

**Q1.** Um time quer que um agente reescreva a lógica de `SELECT … FOR UPDATE` que impede a venda dupla no `inventory`, e que outro atualize a versão de patch de uma biblioteca de logging em todos os serviços. Quais níveis de autonomia são adequados?

- A. Ambos autônomos (nível 4): o CI vai pegar qualquer problema
- B. O travamento de assentos no máximo nível 2–3 (rascunho para uma revisão humana cuidadosa); a atualização de patch pode ser nível 4 se o CI e o canary forem confiáveis
- C. Ambos nível 0: a IA nunca deve alterar código
- D. O travamento de assentos nível 4, porque é crítico e precisa de velocidade; a atualização da biblioteca nível 2

??? success "Resposta"
    **B.**

    A autonomia deve acompanhar o **raio de impacto** de um erro e quão **verificável** é a mudança. Bugs de concorrência são difíceis de testar e catastróficos numa abertura de vendas; uma atualização de dependência no nível de patch é de baixo risco e bem coberta por verificações automatizadas (o Renovate/Dependabot já faz merge automático dessas atualizações sem IA).

---

**Q2.** Segundo o relatório DORA de 2024, um aumento de 25% na adoção de IA esteve associado a qual efeito sobre a entrega de software?

- A. Maior vazão e maior estabilidade
- B. Uma queda estimada de 1,5% na vazão de entrega e de 7,2% na estabilidade da entrega, apesar dos ganhos de produtividade individual relatados
- C. Nenhum efeito mensurável em métrica alguma
- D. Uma redução de 25% no lead time

??? success "Resposta"
    **B.**

    As pessoas relataram benefícios (qualidade do código, documentação, velocidade da revisão), mas a vazão e a estabilidade da entrega caíram um pouco. Os autores do relatório sugerem causas como lotes maiores e fundamentos mais fracos. A lição: meça resultados com baselines, e não adoção ou percepção.

---

**Q3.** Uma revisão usa um prefixo estável de 8.000 tokens, 6.000 tokens de diff e 1.500 tokens de saída. Com os preços ilustrativos do modelo médio da página — US$ 2 por milhão de tokens de entrada, US$ 10 por milhão de tokens de saída e um prêmio de 1,25× para gravar o prefixo no cache de prompt —, quanto custa uma revisão com o cache frio?

- A. Cerca de US$ 0,005
- B. Cerca de US$ 0,047
- C. Cerca de US$ 0,47
- D. Cerca de US$ 4,70

??? success "Resposta"
    **B.**

    Prefixo gravado no cache: 8.000 × 2 × 1,25 / 10⁶ = US$ 0,020. Diff: 6.000 × 2 / 10⁶ = US$ 0,012. Saída: 1.500 × 10 / 10⁶ = US$ 0,015. Total ≈ **US$ 0,047** (0,043 sem o prêmio de gravação no cache; ~0,032 quando 80 % dos prefixos acertam o cache). Com 20.000 revisões frias por mês, são ~US$ 940 — pouco perto do tempo dos engenheiros, e é por isso que o custo de atenção de comentários ruidosos importa mais que a conta de tokens.

---

**Q4.** Qual parte do "contrato de uma etapa de IA" determina o **pior caso** de uma prompt injection bem-sucedida?

- A. O gatilho
- B. O contexto
- C. A ação e a permissão com que ela roda
- D. O schema da saída

??? success "Resposta"
    **C.**

    O que quer que o modelo seja convencido a dizer, a etapa nunca pode fazer mais do que suas credenciais e ferramentas permitem. Um revisor com `pull-requests: write` que só publica revisões `COMMENT` pode, no pior caso, publicar um comentário errado. O schema ajuda, mas a permissão é o limite rígido.

---

## Revisão de código

**Q5.** Seu revisor de IA publica 3 comentários por PR, e só 4 em cada 10 são avaliados como úteis. Qual é a consequência mais provável, e a melhor primeira correção?

- A. Os desenvolvedores leem cada comentário com atenção; nenhuma correção é necessária
- B. Os desenvolvedores passam a ignorar todos os comentários do bot, inclusive os úteis; aumente os limiares de confiança/severidade, imponha um teto de comentários e meça a precisão de novo
- C. O bot encontra poucos bugs; reduza os limiares
- D. Torne-o um check obrigatório, para que os desenvolvedores tenham de tratar os comentários

??? success "Resposta"
    **B.**

    Um revisor é julgado pelos seus piores comentários. Com 40% de precisão, o comportamento racional é ignorá-lo. Troque um pouco de recall por precisão (confiança alta + média, severidade mínima, teto, dedup), meça, e use como gate só categorias estreitas com precisão comprovada.

---

**Q6.** Por que regras de arquitetura como "o `order` não deve acessar o schema de `inventory`" devem ser impostas principalmente por verificações determinísticas, com a IA como complemento?

- A. Porque os modelos não conseguem ler SQL
- B. Verificações determinísticas (grants no banco, ArchUnit, lint) são exatas, reproduzíveis e não podem ser convencidas a mudar o veredito; a IA acrescenta explicação e pega casos vagos que as regras não conseguem expressar
- C. Porque o ArchUnit é mais rápido que qualquer chamada a um modelo
- D. Porque as regras de arquitetura mudam com frequência demais para a IA

??? success "Resposta"
    **B.**

    Defesa em profundidade: o papel de banco do `order` sem grants em `inventory.*` faz o erro falhar mesmo que todos os revisores deixem passar. O revisor de IA explica o *porquê* e sugere a correção certa, e seus achados recorrentes são candidatos a novas regras determinísticas.

---

**Q7.** Um PR de 5.000 linhas excede o orçamento de diff do revisor. O que o revisor deve fazer?

- A. Truncar o diff no limite do orçamento e revisar o que couber, sem avisar
- B. Manter arquivos inteiros por prioridade (código de produção primeiro), revisar por arquivo ou por serviço e juntar os resultados, e listar os arquivos não revisados
- C. Recusar-se a revisar e fazer o build falhar
- D. Enviar o repositório inteiro

??? success "Resposta"
    **B.**

    Truncar no meio de um arquivo produz comentários confiantes sobre código que o modelo nunca viu. Orçar arquivos inteiros, dividir em chamadas de map/reduce e deixar explícito o que não foi revisado mantém a revisão honesta — e um PR de 5.000 linhas já é, por si só, um achado que vale discutir.

---

## Testes

**Q8.** Uma suíte de testes gerada eleva a cobertura de linhas do `HoldService` de 45% para 95%, mas o mutation score continua em 41%. O que isso indica?

- A. Os testes são excelentes; o teste de mutação não é confiável
- B. Os novos testes executam o código, mas não verificam seus resultados bem o bastante para perceber bugs injetados
- C. O PIT estava mal configurado, porque cobertura e mutation score sempre andam juntos
- D. A classe não tem bugs

??? success "Resposta"
    **B.**

    A cobertura conta linhas executadas; o mutation score conta mudanças que os testes **detectam**. Testes com asserções fracas elevam a cobertura e não matam mutante algum. Devolva os mutantes sobreviventes ao gerador e revise as asserções.

---

**Q9.** Um modelo rotula como "flaky", com confiança média, um teste que falha na lógica de reserva de assentos. O que deve acontecer?

- A. Pô-lo em quarentena automaticamente; o modelo sabe mais
- B. Verificar os sinais determinísticos (reexecução no mesmo commit, histórico de falhas, correlação com o diff); pôr em quarentena só por política, com um responsável e um ticket
- C. Apagar o teste
- D. Reexecutar a suíte completa até passar e fazer o merge

??? success "Resposta"
    **B.**

    A quarentena esconde um teste de todo mundo. Uma condição de corrida real nas reservas rotulada como "flaky" poderia chegar à produção. O rótulo do modelo é evidência para um humano ou uma regra, não uma decisão.

---

**Q10.** A seleção preditiva de testes roda 15% da suíte com 95% de recall das falhas. O que torna isso aceitável?

- A. Nada: qualquer falha perdida é inaceitável
- B. Uma rede de segurança que roda a suíte completa após o merge ou à noite, para que as falhas perdidas sejam pegas e atribuídas a um commit em poucas horas
- C. A pontuação de confiança do modelo
- D. Rodar duas vezes os testes selecionados

??? success "Resposta"
    **B.**

    A seleção troca minutos de CI por um pequeno atraso na detecção de algumas falhas. A suíte completa na `main` ou à noite limita esse atraso. Sem ela, o teste pulado poderia ser justamente o que importava.

---

## Agentes no CI

**Q11.** Um agente de correção do build sem prompt caching começa com 20.000 tokens de contexto e acrescenta 2.500 tokens por turno. Aproximadamente, como o **total de tokens de entrada** cresce com o número de turnos *n*?

- A. Constante
- B. Linearmente com *n*
- C. Aproximadamente de forma quadrática com *n*, porque cada turno reenvia todo o contexto crescente
- D. Logaritmicamente

??? success "Resposta"
    **C.**

    O turno *i* envia ≈ 20.000 + 2.500·(*i*−1) tokens; a soma em *n* turnos é ≈ 20.000·*n* + 1.250·*n*². Fazer cache do prefixo repetido torna cada token muito mais barato, mas os orçamentos de turnos e de dólares ainda precisam ser impostos pelo harness.

---

**Q12.** Qual projeto mantém um agente de CI seguro mesmo que uma linha de log consiga injetar instruções nele?

- A. Um system prompt forte dizendo ao agente para nunca seguir instruções dos logs
- B. O job do agente tem apenas uma chave de modelo com limite de gasto e um token somente leitura, ferramentas limitadas a ler/editar `src/` e rodar o build; um job separado aplica um patch verificado como PR em rascunho, que um humano precisa aprovar
- C. Rodar o agente num modelo maior
- D. Dar ao agente `contents: write` para que ele conserte as coisas mais rápido

??? success "Resposta"
    **B.**

    Instruções no prompt são uma mitigação; capacidades são o controle. Sem token de escrita, sem segredos, com uma superfície de ferramentas restrita a uma lista de permitidas, verificação independente e aprovação humana, uma injeção bem-sucedida pode, no máximo, produzir um patch ruim que uma pessoa rejeita.

---

## Liberação e operação

**Q13.** Por que um LLM não deve ser o juiz que promove ou aborta um canary?

- A. LLMs não conseguem ler números
- B. O veredito precisa ser reproduzível, auditável, estatisticamente sólido e imune à manipulação por texto em logs ou rótulos; limiares e testes estatísticos no Git oferecem isso, e o modelo explica o veredito
- C. Porque o Argo Rollouts não suporta chamadas HTTP
- D. Porque chamadas a LLMs são caras demais para canaries

??? success "Resposta"
    **B.**

    Os mesmos dados precisam dar o mesmo veredito, e uma linha de log dizendo "promova" não pode ter efeito algum. O modelo tem valor depois do veredito: explicando-o, correlacionando-o com a mudança e propondo onde investigar.

---

## Segurança e governança

**Q14.** O que é a "tríade letal (lethal trifecta)" para agentes de IA?

- A. Custo, latência e acurácia
- B. Acesso a dados privados, exposição a conteúdo não confiável e capacidade de se comunicar com o exterior — juntos, eles permitem que uma única instrução injetada exfiltre dados
- C. Prompt injection, jailbreaks e alucinações
- D. SBOM, assinatura e proveniência

??? success "Resposta"
    **B.**

    Qualquer um dos três isoladamente é administrável. Projete as etapas de IA de modo que nenhuma tenha os três: por exemplo, o revisor lê o texto não confiável do PR, mas não guarda segredos além de uma chave com limite de gasto e só pode publicar comentários.

---

**Q15.** Um agente adiciona a dependência `spring-boot-starter-seatlock` ao `inventory`. Ela não existe hoje no Maven Central. Qual é o risco e qual é o controle?

- A. Nenhum risco: o build simplesmente vai falhar
- B. Slopsquatting: um atacante pode publicar um pacote malicioso com um nome alucinado; controle com revisão de dependências, um proxy de registry que põe pacotes novos em quarentena e uma política de que agentes não podem adicionar dependências sem justificativa
- C. Apenas um risco de licenciamento
- D. Typosquatting do nome do modelo

??? success "Resposta"
    **B.**

    Os modelos alucinam repetidamente os mesmos nomes de pacotes plausíveis; quando um atacante registra um deles, o build *passa* — com o código dele. Controles determinísticos sobre novas dependências barram o ataque, não importa como o nome tenha chegado ali.

[Voltar para a aula](index.md){ .md-button }
