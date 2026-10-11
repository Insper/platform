Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## DevOps / CI-CD com Jenkins

**Q1.** O que a **Integração Contínua (CI)** resolve especificamente em um fluxo de desenvolvimento?

- A. Ela faz o deploy automático de cada commit diretamente em produção
- B. Ela gerencia o provisionamento de infraestrutura usando arquivos de configuração declarativos
- C. Ela detecta bugs de integração cedo, fazendo build e testes automáticos a cada commit, antes de as mudanças serem integradas à branch principal
- D. Ela impõe regras de estilo e formatação de código, fazendo o build falhar quando há violações

??? success "Resposta"
    **C — Detecta bugs de integração cedo.**

    Sem CI, os desenvolvedores integram suas mudanças com pouca frequência. Quando o fazem, descobrem conflitos e bugs acumulados ao longo de dias ou semanas — quanto maior a demora, mais difícil o merge. A CI força integrações pequenas e frequentes e executa testes automatizados em cada uma, detectando os problemas enquanto ainda são baratos de corrigir.

---

**Q2.** No pipeline do Jenkins, por que o Maven é chamado com a flag `-B` (`mvn -B clean install`)?

- A. Ela habilita a compilação em lote, compilando todos os módulos simultaneamente
- B. Ela habilita o batch mode — suprimindo prompts interativos que travariam um job de CI sem supervisão
- C. Ela habilita a saída binária, gerando executáveis nativos em vez de JARs
- D. Ela habilita a execução em segundo plano, permitindo que o build rode como daemon

??? success "Resposta"
    **B — O batch mode desabilita prompts interativos.**

    Pipelines de CI rodam sem supervisão e sem terminal. A saída padrão do Maven inclui indicadores de progresso e, em certas situações, pode pedir entradas do usuário. O `-B` (batch mode) desabilita esses recursos, produzindo uma saída amigável para máquinas e evitando que o build fique travado esperando uma entrada que nunca virá.

---

**Q3.** O que `docker buildx build --platform linux/amd64,linux/arm64` faz no pipeline do Jenkins?

- A. Constrói duas imagens separadas e as publica com tags diferentes
- B. Cria um manifesto multiplataforma — uma única tag de imagem que resolve para o binário da arquitetura correta em qualquer host
- C. Constrói a imagem duas vezes por redundância
- D. Habilita a compilação cruzada no Docker, executando o build nas duas plataformas simultaneamente

??? success "Resposta"
    **B — Manifesto multiplataforma sob uma única tag.**

    Os desenvolvedores frequentemente usam Macs com Apple Silicon (arm64), enquanto a produção roda em servidores x86 (amd64). Um build multiplataforma cria os dois binários e os publica sob uma única tag (por exemplo, `myapp:latest`). Ao fazer o pull, o Docker seleciona automaticamente o binário correto para a arquitetura do host.

---

**Q4.** Por que as credenciais do Docker Hub são armazenadas no **Jenkins Credential Store**, e não diretamente no `Jenkinsfile`?

- A. O Jenkins não consegue ler variáveis de ambiente em um `Jenkinsfile`
- B. Armazenar as credenciais no credential store significa que elas nunca são gravadas em disco nem aparecem nos logs — e o Jenkinsfile (que é versionado no repositório) nunca contém segredos
- C. O Docker Hub exige tokens de autenticação específicos do Jenkins
- D. O formato do Jenkinsfile não suporta interpolação de strings para credenciais

??? success "Resposta"
    **B — Os segredos nunca são gravados em disco nem aparecem nos logs.**

    O Jenkins injeta as credenciais em tempo de execução via `withCredentials([usernamePassword(...)])`. O token real é mascarado na saída do console (`****`), nunca é armazenado no workspace e nunca aparece no Jenkinsfile. Colocar as credenciais fixas no Jenkinsfile faria com que elas fossem commitadas no repositório — uma vulnerabilidade de segurança crítica.

---

**Q5.** O pipeline do Jenkins tem uma etapa `Deploy` que executa `kubectl apply`. O que precisa estar configurado no Jenkins para isso funcionar?

- A. O Jenkins master precisa rodar dentro do cluster Kubernetes de destino
- B. Um arquivo kubeconfig (com as credenciais do cluster e a URL do API server) precisa estar disponível para o pipeline — normalmente montado ou armazenado como um segredo do Jenkins
- C. O `kubectl` já vem embutido no Jenkins e não exige nenhuma configuração adicional
- D. O cluster Kubernetes precisa ter o Jenkins instalado como plugin

??? success "Resposta"
    **B — kubeconfig com as credenciais do cluster.**

    O `kubectl` usa um arquivo kubeconfig para se autenticar no API server. No Jenkins, ele normalmente é armazenado como uma credencial do tipo `Secret file` e injetado no pipeline com `withCredentials`. O arquivo contém o certificado da CA do cluster, a URL do API server e um token de service account com permissões RBAC suficientes para o deploy.

---
