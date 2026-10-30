Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Integração contínua { #continuous-integration }

**Q1.** Por que o `CatalogApiTest` usa Testcontainers em vez de um banco em memória como o H2?

- A. O Testcontainers é mais rápido que o H2
- B. O teste roda o PostgreSQL 17 real (e o Redis): as migrações do Flyway, o dialeto SQL, as constraints e o cache se comportam exatamente como em produção, então um teste que passa diz algo sobre produção
- C. O H2 não pode ser usado com o Spring Boot 4
- D. O GitHub Actions proíbe bancos em memória

??? success "Resposta"
    **B — teste contra a dependência real.**

    Um substituto em memória aceita SQL que o PostgreSQL rejeita (e vice-versa), ignora recursos específicos do PostgreSQL como `ON CONFLICT` ou índices parciais, e nunca roda as migrações reais. O Testcontainers sobe a imagem real no Docker durante o teste; o preço é de alguns segundos por classe de teste.

---

**Q2.** O workflow tem `permissions: contents: read` no topo, e o job `image` acrescenta `packages: write`, `id-token: write`, `attestations: write` e `security-events: write`. Por que não dar `write-all` ao workflow inteiro?

- A. `write-all` não é YAML válido
- B. Privilégio mínimo: um step comprometido (por exemplo, uma dependência maliciosa num teste) só pode fazer o que o token do seu job permite; os jobs de teste não conseguem fazer push de imagens nem reescrever o repositório
- C. Isso deixa o workflow mais rápido
- D. O GitHub cobra por permissões de escrita

??? success "Resposta"
    **B — limite o raio de impacto de cada job.**

    O `GITHUB_TOKEN` é injetado em todo job. Jobs que rodam código de terceiros (plugins do Maven, dependências de teste) recebem acesso só de leitura; só o job que precisa publicar recebe as permissões para isso, e só enquanto dura.

---

**Q3.** Por que toda action é fixada num SHA de commit (`aquasecurity/trivy-action@ed142fd…`, `actions/checkout@3d3c42e…`) em vez de numa tag?

- A. Tags não são suportadas para actions de terceiros
- B. Uma tag pode ser movida por quem controla o repositório da action; um SHA completo sempre se refere ao mesmo código, então uma tag sequestrada não consegue injetar código no seu pipeline
- C. SHAs fazem o workflow rodar mais rápido
- D. O Dependabot só funciona com SHAs

??? success "Resposta"
    **B — referências imutáveis para código que roda com o seu token.**

    O sequestro de tags já foi usado em ataques reais à cadeia de suprimentos contra sistemas de CI. Fixar num SHA (com a versão num comentário) torna a referência imutável; o Dependabot então propõe atualizações como pull requests revisáveis.

---

## Cadeia de suprimentos { #supply-chain }

**Q4.** O job `image` faz o build com `load: true`, escaneia e só então faz o push. Qual é a vantagem sobre fazer o push primeiro e escanear a imagem no registry?

- A. Escanear imagens locais é mais preciso
- B. Uma imagem vulnerável nunca é publicada: se o portão falha, nada chega ao registry, de onde um cluster poderia puxá-la
- C. Só economiza custo de armazenamento no registry
- D. O Trivy não consegue escanear imagens no registry

??? success "Resposta"
    **B — portão antes de publicar.**

    Qualquer coisa no registry pode ir para deploy por alguém (ou por algo, como o Argo CD com uma tag móvel). Falhar antes do push mantém o registry limpo; o push em si é barato porque as camadas já estão no cache do build.

---

**Q5.** Por que o portão do Trivy só falha em vulnerabilidades `CRITICAL` **com correção** (`ignore-unfixed`), enquanto o relatório completo lista tudo?

- A. O Trivy não consegue detectar vulnerabilidades sem correção
- B. Um portão precisa ser acionável: bloquear toda mudança por vulnerabilidades que ninguém consegue corrigir hoje deixa o portão permanentemente vermelho, e os times aprendem a contorná-lo; o relatório mantém o resto visível para priorização
- C. Vulnerabilidades HIGH nunca são exploráveis
- D. O GitHub limita os envios de SARIF a achados críticos

??? success "Resposta"
    **B — portões sempre vermelhos são ignorados.**

    O portão para o que você pode e deve corrigir agora (existe uma versão corrigida). Todo o resto vai para a aba Security, onde pode ser triado, aceito com prazo de validade, ou corrigido quando sair um patch.

---

**Q6.** O que a atestação de proveniência do build permite verificar com `gh attestation verify`?

- A. Que a imagem não tem vulnerabilidades
- B. Que este digest exato de imagem foi construído pelo workflow do seu repositório, a partir de um commit específico, nos runners do GitHub — e não foi modificado desde então
- C. Que o SBOM está completo
- D. Que a imagem foi escaneada pelo Trivy

??? success "Resposta"
    **B — quem a construiu, a partir de quê, e que ela não foi adulterada.**

    A atestação é uma declaração assinada (Sigstore, sem chaves, usando a identidade OIDC do job) ligada ao digest da imagem. Uma política de admissão do cluster pode recusar imagens sem proveniência válida do seu repositório — o "S" de SLSA.

---

## Portão de desempenho { #performance-gate }

**Q7.** O teste de orçamento tem um cenário `warmup` de 20 s que não é coberto pelos thresholds. Por quê?

- A. Para economizar minutos de CI
- B. Uma JVM recém-iniciada é mais lenta (compilação JIT, pools e cache vazios): medi-la faria o portão falhar por ruído em vez de por regressões
- C. O k6 precisa de tempo para iniciar os seus usuários virtuais
- D. Thresholds não podem se aplicar ao teste inteiro

??? success "Resposta"
    **B — meça o regime estável que você prometeu.**

    A latência de partida a frio é real e importa para o autoscaling (lab 10), mas o orçamento compara versões do código: precisa medir cada uma no mesmo estado aquecido.

---

**Q8.** O orçamento é p95 < 300 ms, e a execução normal mede p95 ≈ 7 ms. Um threshold tão folgado não é inútil?

- A. Sim, deveria ser 8 ms
- B. Não: runners compartilhados de CI são ruidosos, então um threshold apertado falharia aleatoriamente; o portão está lá para pegar regressões grandes (o sleep proposital de 400 ms, uma query N+1), enquanto a tendência dos números ao longo de muitas execuções revela as pequenas
- C. Sim, thresholds sempre devem ser iguais ao valor medido
- D. Não, porque o k6 arredonda as latências

??? success "Resposta"
    **B — um portão precisa ter uma taxa baixa de falsos positivos.**

    Um portão que falha ao acaso ensina as pessoas a clicar em "re-run" até ficar verde — e aí ele não pega nada. Mantenha uma margem, acompanhe os números, aperte de forma deliberada.

---

## GitOps e canary { #gitops-and-canary }

**Q9.** Neste lab, o CI nunca roda `kubectl apply` contra o cluster. Como uma nova versão chega ao deploy?

- A. O Argo CD consulta o GHCR em busca de novas imagens
- B. O workflow `Deploy` faz commit da nova tag da imagem em `k8s/overlays/gitops`; o Argo CD, rodando dentro do cluster, vê o commit e aplica o overlay
- C. O Kubernetes puxa a tag `main` a cada minuto
- D. O desenvolvedor roda `kubectl apply` depois do CI

??? success "Resposta"
    **B — GitOps baseado em pull.**

    As credenciais do cluster nunca saem do cluster; o Git guarda o histórico completo e auditado do que foi para deploy; o rollback é um `git revert`; e o drift é detectado e, com `selfHeal`, desfeito automaticamente.

---

**Q10.** Alguém roda `kubectl -n boxoffice scale deployment redis --replicas=0`. O que acontece com `selfHeal: true`?

- A. O Redis fica com 0 réplicas até o próximo deploy
- B. O Argo CD detecta que o cluster difere do Git (`OutOfSync`) e restaura 1 réplica em segundos
- C. O Argo CD apaga o Deployment do Redis
- D. O HPA escala o Redis de volta

??? success "Resposta"
    **B — o Git é a fonte da verdade.**

    Mudanças manuais são revertidas; para mudar o cluster, você muda o Git. É também por isso que o número de réplicas do HPA não pode estar na spec do Rollout: senão o Argo CD e o HPA brigariam por ele.

---

**Q11.** A release ruim (30% de erros) foi abortada com as medições `[]`, `0.068`, `0.285` e `failureLimit: 1`. Por que a primeira medição, vazia, não reprovou a análise?

- A. O Argo Rollouts ignora a primeira medição
- B. A condição de sucesso `len(result) == 0 || isNaN(result[0]) || result[0] < 0.01` trata "ainda sem tráfego no canary" como sucesso; o abort veio com a segunda falha (0,068 e 0,285 > 1%), ultrapassando `failureLimit: 1`
- C. O Prometheus estava fora do ar
- D. O canary não tinha pods

??? success "Resposta"
    **B — trate "sem dados" explicitamente.**

    Logo depois que um canary começa, a consulta não tem amostras. Sem a proteção `len`/`isNaN`, a análise falharia (ou daria erro) imediatamente em toda release. O trade-off: sem tráfego, um canary é promovido sem evidência — mantenha carga sobre o serviço, ou alongue as pausas.

---

**Q12.** Durante um canary, a versão antiga e a nova do `catalog` rodam contra o mesmo banco. Qual mudança de schema é segura de entregar na nova versão?

- A. Renomear uma coluna que a versão antiga lê
- B. Remover uma coluna que a nova versão não usa mais
- C. Adicionar uma nova coluna nullable (expand), com o novo código tolerando a sua ausência
- D. Mudar o tipo de uma coluna no lugar

??? success "Resposta"
    **C — expand/contract.**

    As migrações rodam uma vez, para as duas versões, e a versão antiga continua rodando durante o canary — e depois de um abort. Só mudanças compatíveis com a versão anterior são seguras; o "contract" (remover, renomear) acontece numa release posterior, quando nenhuma versão em execução depende do formato antigo.

[Voltar ao lab](index.md){ .md-button }
