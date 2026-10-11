Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Orquestração / Kubernetes

**Q1.** Que problema fundamental o Kubernetes resolve e o Docker Compose não consegue resolver?

- A. Executar containers em uma única máquina com menos consumo de memória
- B. Definir aplicações com vários containers em um único arquivo YAML
- C. Orquestrar containers em um cluster de vários hosts, com escalonamento automático, autorrecuperação, auto-scaling e rolling updates
- D. Construir imagens Docker mais rápido usando caches de build distribuídos

??? success "Resposta"
    **C — Orquestração em vários hosts com autorrecuperação e auto-scaling.**

    O Docker Compose gerencia uma única máquina. O Kubernetes abrange um cluster de nós, posiciona automaticamente os containers em nós saudáveis, reinicia containers que falharam, aumenta e diminui o número de réplicas com base em métricas de CPU/memória e faz rolling deployments sem downtime — nada disso é suportado nativamente pelo Compose.

---

**Q2.** O que é um **Pod** no Kubernetes, e como ele difere de um container?

- A. Um Pod é uma máquina virtual; um container é um processo dentro dela
- B. Um Pod é a menor unidade implantável — um ou mais containers que compartilham o mesmo namespace de rede e os mesmos volumes de armazenamento
- C. Um Pod é um grupo nomeado de serviços que compartilham a mesma rede; um container é um único serviço
- D. Um Pod é um arquivo de configuração; um container é a instância em execução

??? success "Resposta"
    **B — Menor unidade implantável; rede + armazenamento compartilhados.**

    O Kubernetes nunca gerencia containers diretamente — ele gerencia Pods. Um Pod normalmente contém um container (a aplicação), mas pode incluir containers sidecar (encaminhador de logs, proxy de service mesh) que compartilham a mesma rede `localhost` e os volumes montados. Todos os containers de um Pod sobem e param juntos.

---

**Q3.** O que faz um recurso **Service** do Kubernetes?

- A. Define a imagem Docker e o número de réplicas de um deployment
- B. Monitora a saúde dos Pods e reinicia containers com falha
- C. Expõe um conjunto de Pods com um nome DNS e um IP virtual estáveis, fazendo o balanceamento de carga entre todas as réplicas correspondentes
- D. Armazena segredos e valores de configuração da aplicação

??? success "Resposta"
    **C — DNS estável + balanceamento de carga entre as réplicas dos Pods.**

    Os Pods são efêmeros — recebem novos endereços IP a cada reinício. Um Service fornece um `ClusterIP` e um nome DNS estáveis, que sempre roteiam para Pods saudáveis que correspondem ao seu seletor de labels. Os outros serviços chamam `account-service:8080` sem saber qual Pod (ou quantos) está por trás.

---

**Q4.** O que `kubectl apply -f k8s.yaml` faz, e qual a diferença em relação a `kubectl create`?

- A. `apply` cria recursos; `create` os atualiza
- B. `apply` é declarativo — cria ou atualiza os recursos para corresponder ao estado desejado no arquivo; `create` apenas cria novos recursos e falha se eles já existirem
- C. `apply` valida a sintaxe sem aplicar as mudanças; `create` aplica imediatamente
- D. São idênticos — os nomes são apelidos históricos

??? success "Resposta"
    **B — `apply` é declarativo (cria ou atualiza); `create` apenas cria.**

    O `kubectl apply` é idempotente: execute-o 10 vezes com o mesmo arquivo e o estado do cluster será o mesmo. Ele cria o recurso se não existir, ou aplica um patch se já existir. O `kubectl create` falha se o recurso já existir — adequado para uma criação única, não para entrega contínua.

---

**Q5.** Quando você escolheria o **Minikube** em vez de um cluster Kubernetes gerenciado na nuvem?

- A. Quando você precisa executar workloads em várias zonas de disponibilidade
- B. Quando sua aplicação exige mais de 100 GB de RAM
- C. Para desenvolvimento e testes locais — o Minikube executa um cluster de um único nó no seu notebook, sem custo de nuvem, ideal para aprender e validar manifestos antes da produção
- D. Quando requisitos regulatórios proíbem o uso de provedores de nuvem

??? success "Resposta"
    **C — Desenvolvimento e testes locais.**

    O Minikube cria um cluster Kubernetes totalmente funcional rodando localmente (em uma VM ou em um container). Você pode iterar sobre os manifestos do Kubernetes, testar políticas de RBAC e validar deploys sem gastar dinheiro com nuvem nem esperar por pipelines de CI. Quando os manifestos funcionam localmente, podem ser aplicados no cluster real.

---
