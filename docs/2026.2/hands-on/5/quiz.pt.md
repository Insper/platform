Clique em **"Resposta"** para ver a resposta correta e a explicação.

---

## Orquestração / Kubernetes

**Q1.** Que problema fundamental o Kubernetes resolve e o Docker Compose não?

- A. Rodar containers em uma única máquina com menos consumo de memória
- B. Definir aplicações com vários containers em um único arquivo YAML
- C. Orquestrar containers em um cluster com vários hospedeiros, com escalonamento automático, autorrecuperação, escala automática e atualizações graduais (rolling updates)
- D. Construir imagens Docker mais rápido usando caches de build distribuídos

??? success "Resposta"
    **C — Orquestração em vários hospedeiros, com autorrecuperação e escala automática.**

    O Docker Compose gerencia uma única máquina. O Kubernetes abrange um cluster de nós: posiciona automaticamente os containers em nós saudáveis, reinicia containers que falharam, aumenta e diminui o número de réplicas com base em métricas de CPU/memória e faz deploys graduais sem indisponibilidade — nada disso o Compose suporta nativamente.

---

**Q2.** O que é um **Pod** no Kubernetes, e como ele difere de um container?

- A. Um Pod é uma máquina virtual; um container é um processo dentro dela
- B. Um Pod é a menor unidade implantável — um ou mais containers que compartilham o mesmo namespace de rede e os mesmos volumes de armazenamento
- C. Um Pod é um grupo nomeado de serviços que compartilham a mesma rede; um container é um único serviço
- D. Um Pod é um arquivo de configuração; um container é a instância em execução

??? success "Resposta"
    **B — A menor unidade implantável; rede e armazenamento compartilhados.**

    O Kubernetes nunca gerencia containers diretamente — ele gerencia Pods. Um Pod normalmente contém um container (a aplicação), mas pode incluir containers sidecar (encaminhador de logs, proxy de service mesh) que compartilham a mesma rede `localhost` e os volumes montados. Todos os containers de um Pod sobem e param juntos.

---

**Q3.** O que faz um recurso **Service** do Kubernetes?

- A. Define a imagem Docker e o número de réplicas de um deployment
- B. Monitora a saúde dos Pods e reinicia containers com falha
- C. Expõe um conjunto de Pods com um nome DNS e um IP virtual estáveis, fazendo o balanceamento de carga entre todas as réplicas correspondentes
- D. Guarda segredos e valores de configuração da aplicação

??? success "Resposta"
    **C — DNS estável + balanceamento de carga entre as réplicas dos Pods.**

    Os Pods são efêmeros — ganham um novo endereço IP a cada reinício. Um Service oferece um `ClusterIP` e um nome DNS estáveis, que sempre roteiam para Pods saudáveis que correspondem ao seu seletor de labels. Os outros serviços chamam `account-service:8080` sem saber qual Pod (nem quantos) estão por trás dele.

---

**Q4.** O que `kubectl apply -f k8s.yaml` faz, e como ele difere de `kubectl create`?

- A. `apply` cria recursos; `create` os atualiza
- B. `apply` é declarativo — cria ou atualiza os recursos para que correspondam ao estado desejado no arquivo; `create` só cria recursos novos e falha se eles já existirem
- C. `apply` valida a sintaxe sem aplicar as mudanças; `create` aplica imediatamente
- D. São idênticos — os nomes são apelidos históricos

??? success "Resposta"
    **B — `apply` é declarativo (cria ou atualiza); `create` só cria.**

    O `kubectl apply` é idempotente: execute-o 10 vezes com o mesmo arquivo e o estado do cluster será o mesmo. Ele cria o recurso se não existir, ou o atualiza (patch) se existir. O `kubectl create` falha se o recurso já existe — serve para uma criação única, não para entrega contínua.

---

**Q5.** Quando você escolheria o **Minikube** em vez de um cluster Kubernetes gerenciado na nuvem?

- A. Quando você precisa rodar workloads em várias zonas de disponibilidade
- B. Quando a sua aplicação exige mais de 100 GB de RAM
- C. Para desenvolvimento e testes locais — o Minikube roda um cluster de um único nó no seu notebook, sem custo de nuvem, ideal para aprender e validar manifestos antes da produção
- D. Quando exigências regulatórias proíbem o uso de provedores de nuvem

??? success "Resposta"
    **C — Desenvolvimento e testes locais.**

    O Minikube cria um cluster Kubernetes totalmente funcional rodando localmente (em uma VM ou em um container). Você pode iterar sobre os manifestos do Kubernetes, testar políticas de RBAC e validar deploys sem gastar com nuvem nem esperar pelos pipelines de CI. Quando os manifestos funcionam localmente, eles podem ser aplicados ao cluster real.

---
