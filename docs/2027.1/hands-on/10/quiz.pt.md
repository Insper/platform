Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Objetos e controllers { #objects-and-controllers }

**Q1.** Você roda `kubectl delete pod catalog-8685666c5-5bv8t`. Alguns segundos depois existe um novo pod do `catalog`. Quem o criou?

- A. O `kubectl`, que recria automaticamente os pods apagados
- B. O ReplicaSet do Deployment `catalog`: o controller dele viu 1 de 2 pods desejados e criou outro
- C. O HPA
- D. O kubelet do nó onde o pod rodava

??? success "Resposta"
    **B — um controller reconciliando o estado desejado e o real.**

    Um Deployment gerencia ReplicaSets, e um ReplicaSet mantém o número de pods que casam com o seu seletor igual a `replicas`. Apagar um pod muda o estado real; o laço do controller percebe e age. Essa é a ideia central do Kubernetes: declarar o estado desejado e deixar os laços de controle convergirem para ele.

---

**Q2.** Por que o PostgreSQL é um **StatefulSet** com uma seção `volumeClaimTemplates`, enquanto o `catalog` é um Deployment?

- A. StatefulSets são mais rápidos
- B. O banco precisa de uma identidade estável (`db-0`) e do seu próprio volume persistente, que sobrevive a restarts e reagendamentos do pod; os pods do `catalog` são intercambiáveis e não guardam estado
- C. Deployments não podem usar variáveis de ambiente vindas de Secrets
- D. Só StatefulSets podem ter readiness probes

??? success "Resposta"
    **B — identidade estável e armazenamento por réplica.**

    Pods stateless podem ser mortos e recriados em qualquer lugar: qualquer réplica serve qualquer requisição. Os dados de um banco precisam sobreviver ao seu pod, e cada réplica (primária, réplicas) tem os seus próprios dados e nome. Para bancos em produção, serviços gerenciados ou operators (o CloudNativePG, por exemplo) acrescentam backups, failover e upgrades por cima.

---

**Q3.** O `secretGenerator` cria `db-credentials-c677754gbf` em vez de `db-credentials`. Qual é a vantagem do sufixo com hash?

- A. Ele criptografa o Secret
- B. Mudar o conteúdo produz um nome novo, e toda referência é reescrita: os pods que o usam passam por um rollout com os novos valores em vez de ficarem com os antigos
- C. Ele impede que outros namespaces leiam o Secret
- D. Ele é exigido pela API do Kubernetes

??? success "Resposta"
    **B — mudanças de configuração disparam rollouts.**

    Variáveis de ambiente vindas de um Secret só são lidas quando um contêiner inicia. Se o Secret mudasse no lugar, os pods em execução ficariam com a senha antiga até algum restart sem relação. Um nome novo muda o template do pod, e o Deployment faz o rollout. (Atenção: um Secret codificado em base64 no Git não é secreto; projetos reais usam um gerenciador de segredos ou secrets selados/criptografados.)

---

## Probes e graceful shutdown { #probes-and-graceful-shutdown }

**Q4.** Um time coloca uma verificação do banco de dados na **liveness** probe do `catalog`. Durante uma oscilação de 20 segundos do banco, o que acontece?

- A. Nada; a liveness só importa na inicialização
- B. Todo pod do `catalog` falha na liveness e o Kubernetes reinicia todos eles, transformando uma oscilação de 20 segundos em minutos de queda enquanto as JVMs reiniciam
- C. Os pods são removidos do Service até o banco voltar, e depois adicionados de novo
- D. O HPA adiciona pods

??? success "Resposta"
    **B — uma dependência na liveness causa restarts em massa.**

    Liveness significa "este processo quebrou sem conserto, reinicie-o". Uma oscilação do banco não se resolve reiniciando o `catalog`, e reiniciar todas as réplicas de uma vez piora as coisas. A readiness ("não me mande tráfego agora") é o lugar certo para condições que devem tirar um pod temporariamente — e mesmo ali, uma dependência compartilhada tiraria *todos* os pods; muitas vezes é melhor continuar pronto e falhar rápido as requisições individuais.

---

**Q5.** Contra o que a `startupProbe` (failure threshold 60, período de 5 s) protege?

- A. Requisições lentas
- B. A liveness probe matar uma JVM que ainda está iniciando — aqui a primeira inicialização também roda as migrations do Flyway —, desligando as outras probes por até 5 minutos até a aplicação reportar que iniciou
- C. Pods iniciando no nó errado
- D. Imagens grandes demais

??? success "Resposta"
    **B — inicializações lentas não são falhas.**

    Sem uma startup probe, a liveness probe começaria a verificar imediatamente e reiniciaria o contêiner antes de ele terminar de iniciar — um crash loop causado pela própria probe. Neste lab a primeira versão (30 × 5 s) era curta demais num laptop ocupado: o pod era morto no meio das migrations.

---

**Q6.** Durante um rolling update, por que a `readinessProbe` e um sleep de 5 s no `preStop` reduzem as requisições com falha?

- A. Eles fazem a JVM iniciar mais rápido
- B. A readiness mantém um pod novo fora do Service até ele conseguir servir; a pausa do `preStop` mantém um pod antigo servindo enquanto a remoção do endpoint se propaga para o Traefik e para os proxies dos nós, antes que o `SIGTERM` o faça parar de aceitar conexões
- C. Eles desativam o HPA durante o rollout
- D. Eles aumentam o `maxSurge`

??? success "Resposta"
    **B — as duas pontas da vida do pod precisam de coordenação.**

    A remoção do endpoint e o sinal de término acontecem em paralelo. Sem a pausa, a JVM pode fechar o listener enquanto os roteadores ainda lhe mandam requisições (connection refused). Sem readiness, o tráfego chega a um contêiner que ainda não está escutando. Com `maxUnavailable: 0` também, a capacidade nunca cai durante o rollout.

---

## Autoscaling

**Q7.** O `catalog` pede `cpu: 250m`. O alvo do HPA é 60%. Dois pods usam 375m cada. Quantas réplicas o HPA quer?

- A. 2
- B. 3
- C. 5
- D. 8

??? success "Resposta"
    **C — utilização = 375 / 250 = 150%; desejadas = ⌈2 × 150 / 60⌉ = 5.**

    A utilização é relativa ao **request**, não ao limit nem ao nó. A política de `scaleUp` pode limitar quão rápido o HPA chega lá (aqui: no máximo dobrar, ou +2 pods, a cada 15 s), então 2 → 4 → 5.

---

**Q8.** O que faz o `scaleDown.stabilizationWindowSeconds: 120`?

- A. Espera 120 s antes do primeiro scale-up
- B. Faz o HPA usar a maior recomendação de réplicas dos últimos 120 s ao escalar para baixo, para que uma queda curta da carga não remova pods que vão ser necessários de novo segundos depois
- C. Apaga os pods 120 s depois que eles ficam prontos
- D. Limita o deployment a 120 pods

??? success "Resposta"
    **B — amortecimento para evitar oscilação.**

    A carga oscila; sem uma janela, o HPA escalaria para baixo a cada vale e para cima de novo a cada pico, pagando a inicialização da JVM toda vez. O scale-up não tem janela aqui (0 s) porque faltar capacidade custa requisições com falha, enquanto sobrar capacidade só custa dinheiro por dois minutos.

---

**Q9.** A venda relâmpago começa às 10:00 em ponto. Cada pod novo do `catalog` leva ~40 s para ficar pronto, e o HPA reage em ~15–30 s. Qual é a melhor estratégia?

- A. Confiar só no HPA; ele foi projetado para isso
- B. Pré-escalar antes das 10:00 (aumentar o `minReplicas` com um job agendado ou à mão) e manter o HPA para o inesperado
- C. Definir `maxReplicas` como 1 000
- D. Remover a readiness probe para que os pods recebam tráfego mais cedo

??? success "Resposta"
    **B — carga previsível se agenda; carga imprevisível é reativa.**

    O autoscaling reativo sempre chega atrasado: detecção + decisão + inicialização ≈ um minuto ou mais, durante o qual os pods existentes absorvem um degrau no tráfego. Para um evento conhecido, a capacidade deve estar no lugar antes de ele começar (e o banco de dados, que não escala sozinho, também precisa ser dimensionado para ele).

---

**Q10.** O HPA escalou o `catalog` para 8 pods, e agora o PostgreSQL rejeita conexões. Por quê?

- A. O HPA também escala o PostgreSQL para baixo
- B. Cada pod tem o seu próprio pool de conexões (por exemplo, 10 conexões): 8 pods abrem até 80 conexões, mais do que uma instância do banco permite ou aguenta bem — escalar a camada stateless levou o gargalo para a stateful
- C. O Traefik limita as conexões
- D. O PVC está cheio

??? success "Resposta"
    **B — fan-in de conexões.**

    Escalar horizontalmente multiplica as conexões às dependências compartilhadas. Dimensione o `max_connections`, reduza o tamanho do pool por pod, ou coloque um pooler (PgBouncer, lab 6) no meio. Sempre pergunte "quanto cada réplica nova custa às dependências?"

---

## Ingress

**Q11.** Por que este lab instalou o Traefik em vez do ingress-nginx?

- A. O ingress-nginx não suporta o kind
- B. O projeto Kubernetes aposentou o ingress-nginx em março de 2026 (arquivado, sem mais correções); o Traefik é um controller mantido que suporta tanto a API Ingress quanto a Gateway API
- C. O Traefik é o único controller que suporta `pathType: Prefix`
- D. Recursos Ingress só funcionam com o Traefik

??? success "Resposta"
    **B — escolha componentes mantidos.**

    Um Ingress controller fica exposto à internet: rodar um que não recebe mais correções de segurança é um passivo. Como o `Ingress` é uma API padrão, trocar de controller significa basicamente mudar o `ingressClassName`. A Gateway API é a sucessora de longo prazo, com separação de papéis (Gateway vs rotas) e roteamento mais rico.

---

**Q12.** `curl localhost/catalog/events/1` devolve 200. Que cadeia levou a requisição?

- A. localhost:80 → porta 30080 do nó do kind (extraPortMappings) → Traefik (Service NodePort) → regra do Ingress `/catalog` → Service `catalog` → um pod `catalog` pronto
- B. localhost:80 → o pod `catalog` diretamente
- C. localhost:80 → kube-apiserver → `catalog`
- D. localhost:80 → PostgreSQL → `catalog`

??? success "Resposta"
    **A — cada salto é um componente que você configurou.**

    O `kind.yaml` mapeia a porta 80 do host para a 30080 do nó; o chart do Traefik expõe o seu ponto de entrada web nesse NodePort; o Traefik casa a regra do Ingress e manda a requisição para um dos endpoints prontos do Service. O API server nunca está no caminho dos dados — ele só guarda o estado desejado que os controllers leem.

[Voltar ao lab](index.md){ .md-button }
