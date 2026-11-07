---
marp: true
lang: pt-BR
title: Hands-on 10 — Kubernetes
description: Arquitetura de Sistemas · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">Arquitetura de Sistemas · Insper</div>

# Hands-on 10 — Kubernetes

**Declare o estado desejado; deixe os laços de controle manterem o BoxOffice lá**

<!--
Roteiro: (1) por que laços de controle; (2) kind + Traefik + metrics-server; (3) base/overlay do
Kustomize; (4) StatefulSet vs Deployment; (5) probes e graceful shutdown; (6) os controllers
trabalhando e o gêmeo do lab; (7) HPA; (8) Ingress e Gateway API; (9) medir.
-->

---

## Ninguém edita YAML às 10:00

<div class="q">

O lab 3 escalou o `catalog` editando o Compose. O lab 9 reiniciou à mão um serviço que caiu. Quem faz isso durante a venda relâmpago?

</div>

- Kubernetes: você declara o **estado desejado** ("≥ 2 réplicas prontas, mais acima de 60% de unidade central de processamento (CPU, *central processing unit*)").
- Os **controllers** comparam desejado vs real a cada poucos segundos e agem.
- Autocura, rollouts e autoscaling são a mesma ideia: **reconciliação**.

---

## Passo 1 · Um cluster no laptop

<div class="flow" style="align-items: stretch">
<div class="box muted" style="flex: .5; display: flex; flex-direction: column; justify-content: center">você<small>localhost:80</small></div>
<div class="arrow" style="align-self: center">→ :30080</div>
<div class="group">
<div class="caption">control-plane</div>
<div class="box accent">Traefik<small>Ingress controller · Helm · NodePort 30080</small></div>
<div class="box">metrics-server<small>CPU para o autoscaler</small></div>
</div>
<div class="group">
<div class="caption">worker</div>
<div class="box green">catalog</div>
<div class="box orange">db-0 · redis</div>
</div>
<div class="group">
<div class="caption">worker2</div>
<div class="box green">catalog</div>
</div>
</div>

- **kind**: cada nó é um contêiner Docker. O **Horizontal Pod Autoscaler (HPA)** precisa do metrics-server (`--kubelet-insecure-tls` só no kind).
- Imagens: `docker tag … boxoffice/catalog:dev` + `kind load docker-image` — nunca `latest`.

<div class="warn">

O ingress-nginx foi **aposentado em março de 2026**. Escolha componentes mantidos para o que fica exposto à internet.

</div>

---

## Passo 2 · Kustomize: base + overlays

<div class="flow">
<div class="box">k8s/base/<small>namespace, config, db, redis, catalog, hpa, ingress</small></div>
<div class="arrow">+</div>
<div class="box accent">k8s/overlays/local/<small>tag "dev" da imagem + secrets do lab</small></div>
<div class="arrow">→ kubectl apply -k →</div>
<div class="box green">namespace boxoffice<small>11 objetos, um estado desejado</small></div>
</div>

- `secretGenerator` → `db-credentials-<hash>`: conteúdo novo, nome novo, **rollout**.
- O lab 11 adiciona um overlay de GitOps sem tocar na base.

---

## Stateful vs stateless

| | `db` | `catalog` |
|---|---|---|
| Tipo | StatefulSet | Deployment |
| Identidade | estável: `db-0` | intercambiável |
| Armazenamento | PersistentVolumeClaim (PVC) por réplica | nenhum |
| Service | headless (`clusterIP: None`) | ClusterIP, com balanceamento |

<p class="small">Bancos em produção: serviço gerenciado ou um operator (backups, failover, upgrades).</p>

---

## Três probes, três perguntas

| Probe | Pergunta | Em caso de falha |
|---|---|---|
| startup | terminou de iniciar? | as outras probes esperam; restart depois do orçamento |
| liveness | travou sem conserto? | **restart** |
| readiness | deve receber tráfego agora? | **removido** do Service |

<div class="warn">

Nunca verifique uma dependência compartilhada na **liveness**: uma oscilação do banco de dados → todos os pods reiniciam de uma vez.

</div>

---

## Recursos e graceful shutdown

- `requests` (250m, 512Mi): o que o scheduler reserva; **a % do HPA é relativa a eles**.
- `limits` (1 CPU, 768Mi): CPU estrangulada, memória → `OOMKilled`; heap = 75% do limit.
- Rollout `maxSurge: 1`, `maxUnavailable: 0`: nunca abaixo do número desejado de prontos.

<div class="flow">
<div class="box red">pod Terminating</div><div class="arrow">→</div>
<div class="box orange">endpoints removidos<small>o Traefik atualiza um instante depois</small></div><div class="arrow">∥</div>
<div class="box accent">preStop: sleep 5<small>a máquina virtual Java (JVM, <i>Java virtual machine</i>) ainda atende</small></div><div class="arrow">→</div>
<div class="box">SIGTERM<small>server.shutdown=graceful</small></div><div class="arrow">→</div>
<div class="box green">sai<small>bem dentro de 30 s</small></div>
</div>

---

## Convergência eventual

<div class="q">

O `catalog` reiniciou duas vezes logo depois do `kubectl apply`. Bug?

</div>

* Sem `depends_on`: o `catalog` subiu antes do PostgreSQL → o Flyway falhou → saiu → restart com back-off.
* Os componentes **tentam de novo até as dependências existirem**; o sistema converge.
* A primeira inicialização também roda as migrations → o orçamento de startup precisa cobri-las (subimos para 5 min).

---

<!-- _class: tight -->

## Veja os controllers trabalhando

<div class="flow">
<div class="arrow" style="flex: .55; text-align: left">Autocura</div>
<div class="box red">apagar os dois pods</div><div class="arrow">→</div>
<div class="box orange">ReplicaSet: 0 de 2<small>dois pods novos na hora</small></div><div class="arrow">→</div>
<div class="box green">2/2 prontos<small>partida da JVM: dezenas de segundos</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .55; text-align: left">Perder um nó</div>
<div class="box red">docker stop worker2</div><div class="arrow">→</div>
<div class="box orange">NotReady<small>cerca de um minuto</small></div><div class="arrow">→</div>
<div class="box orange">despejado<small>depois da toleration de 5 min</small></div><div class="arrow">→</div>
<div class="box green">substituído no worker</div>
</div>
<div class="flow">
<div class="arrow" style="flex: .55; text-align: left">Rolling update</div>
<div class="box accent">+1 pod novo<small>maxSurge: 1</small></div><div class="arrow">→ pronto →</div>
<div class="box">−1 pod antigo<small>maxUnavailable: 0</small></div><div class="arrow">→</div>
<div class="box green">repete</div>
</div>

- Cronometre cada um: o tempo da autocura é o **tempo médio de reparo (MTTR, *mean time to repair*)** da queda de um pod.
- **A detecção domina** o nó perdido; a partida da JVM domina o pod apagado.

---

## Sem cluster: o simulador

- As páginas trazem o cluster do lab como simulador: os mesmos nós, manifestos e comandos.
- **Deploy**: `apply -k` (o catalog reinicia duas vezes), autocura, um nó perdido.
- **Meça**: o experimento B, com e sem readiness + `preStop`.
- Modo livre: mude quanto tempo o Traefik leva para ver uma mudança de endpoint.

<div class="ok">

Rode antes do lab para saber o que procurar; os números que você reporta continuam vindo do seu cluster.

</div>

<!--
O simulador modela os tempos de um laptop (partida da JVM, inicialização do PostgreSQL) e os padrões do
Kubernetes (back-off, detecção de nó, a toleration de 300 s); as dicas nas páginas citam os números dele.
-->

---

## Passo 3 · O HPA

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
spec:
  minReplicas: 2
  maxReplicas: 8
  metrics: [{ type: Resource, resource: { name: cpu,
             target: { type: Utilization, averageUtilization: 60 } } }]
  behavior:
    scaleUp:   { stabilizationWindowSeconds: 0 }    # + at most 100% or 2 pods / 15 s
    scaleDown: { stabilizationWindowSeconds: 120 }  # - 1 pod / 30 s
```

`desejadas = ⌈atuais × utilização / alvo⌉` → 2 pods a 150% → ⌈2 × 150 / 60⌉ = **5**.

---

## Uma volta do laço: o escalonamento reativo atrasa

<div class="flow">
<div class="box">metrics-server<small>CPU por pod</small></div><div class="arrow">→</div>
<div class="box accent">HPA, a cada 15 s<small>desejado = ⌈atual × CPU / 60%⌉</small></div><div class="arrow">→</div>
<div class="box">Deployment<small>de 2 a 8 réplicas</small></div><div class="arrow">→</div>
<div class="box red">pod novo<small>partida da JVM + probes: dezenas de s</small></div><div class="arrow">→</div>
<div class="box green">pronto<small>a CPU média cai</small></div>
</div>

- O HPA decide em segundos; a capacidade só chega quando uma JVM está pronta.
- Durante o atraso, os pods existentes absorvem o degrau: o p95 sobe, depois cai.
- Evento conhecido (abertura de vendas às 10:00) → **pré-escalar**; HPA para o inesperado.
- Mais pods → mais conexões ao banco: o gargalo vai para a camada stateful.

---

## Carregue: pods aquecidos primeiro

<div class="warn">

Uma JVM que acabou de iniciar queima CPU compilando código e o HPA escala com essa CPU também.

</div>

- Logo depois de um rollout, `PEAK=250` levou o `catalog` a **8** réplicas; a liveness estourou o timeout, pods reiniciaram e o k6 viu **26%** de erros.
- A mesma execução com pods aquecidos nunca saiu de **2** réplicas.
- Aqueça com o script do lab 8, espere 2 réplicas e então `k6 run -e PEAK=1000 load/catalog-hpa.js`.
- O `PEAK` deve levar dois pods aquecidos acima de 60% do request (≈ 600 req/s no laptop de teste).

---

## Passo 4 · Ingress (e Gateway API)

<div class="flow">
<div class="box muted">curl localhost:80</div><div class="arrow">→</div>
<div class="box">nó :30080<small>kind.yaml</small></div><div class="arrow">→</div>
<div class="box accent">Traefik<small>regra /catalog</small></div><div class="arrow">→</div>
<div class="box">Service catalog<small>:8082</small></div><div class="arrow">→</div>
<div class="box green">um pod <b>pronto</b></div>
</div>

- `Ingress`: regras por host/caminho, `ingressClassName: traefik`.
- **Gateway API**: `Gateway` (time de plataforma) + `HTTPRoute` (time do serviço); pesos, headers, timeouts.

<p class="small">Service LoadBalancer = um endereço por serviço; Ingress = uma porta, muitos serviços; API gateway = autenticação, cotas, transformações.</p>

---

<!-- _class: tight -->

## Passo 5 · Meça

| # | Experimento | Registrar |
|---|---|---|
| A | 2 réplicas fixas vs HPA, rampa do k6 até o `PEAK` | p95, p99, erros, máximo de réplicas, tempo para escalar |
| B | rolling update sob 100 req/s, com vs sem readiness + `preStop` | requisições com falha |
| C | apagar um pod / parar um nó | tempo até ficar pronto de novo |

<p class="small"><code>scripts/watch-hpa.sh</code> registra CPU e réplicas desejadas, atuais e prontas a cada 5 s num arquivo de valores separados por vírgula (CSV, <i>comma-separated values</i>) → faça o gráfico.</p>

---

<!-- _class: tight -->

## A · Uma execução num laptop (ilustrativa)

| t | CPU (% do request) | desired | ready |
|---|---|---|---|
| 1:48 | 63 | 2 | 2 |
| 2:03 | 79 | 3 | 2 |
| 3:33 | 247 | **8** | 4 |
| 7:31 | 220 | 8 | **8** |
| 13:00 | 4 | 2 | 2 |

- O oitavo pod, pedido às 3:33, ficou pronto às **7:31** — depois de o patamar acabar.
- HPA: p95 de 5–7 s, p99 ≈ 19 s, 0,3% de erros. **Dois pods fixos aquecidos**: p95 ≈ 34 ms, sem erros.
- Num laptop, as JVMs novas dividem as CPUs que servem a carga: o scale-out custou mais do que acrescentou. O **atraso** é o que o pré-escalonamento remove.

---

## B · Um rollout sob 100 req/s

| Execução | Readiness probe + `preStop` | Requisições com falha (execução de teste) |
|---|---|---|
| com | ✅ | **0** |
| sem | ❌ | cerca de **140 de 11.900** (1,2%, 502 e 504 do Traefik) |

- A startup probe continua mantendo um pod novo fora do Service até a JVM responder.
- Sem a pausa do `preStop`, os pods antigos param de aceitar enquanto ainda estão na lista de endpoints do Traefik.

---

## Experimente no playground

- `scale-out` com o perfil `stress`: réplicas fixas até o p99 explodir, depois mais réplicas.
- Vazão por réplica = o número por trás do alvo do seu HPA.
- Mate uma réplica com e sem health check.

<div class="ok">

O playground prevê a forma; o seu CSV de réplicas ao longo do tempo é a evidência.

</div>

---

## Pontos-chave

1. Kubernetes = **estado desejado + laços de controle**; autocura, rollouts e autoscaling são reconciliação.
2. StatefulSet + PVC para dados; Deployments para pods stateless intercambiáveis.
3. **Startup, liveness, readiness** respondem perguntas diferentes — nada de dependências na liveness.
4. Readiness + `preStop` + graceful shutdown = rollouts sem erros.
5. A detecção domina a recuperação: os pods de um nó perdido só são substituídos depois do NotReady + a toleration.
6. O HPA escala pela % dos **requests**; ele atrasa — pré-escale para picos conhecidos.
7. O Ingress (ou a Gateway API) é a porta; escolha um controller **mantido**.
