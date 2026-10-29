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

<div class="kicker">Arquitetura de Sistemas · Insper</div>

# Hands-on 10 — Kubernetes

**Declare o estado desejado; deixe os laços de controle manterem o BoxOffice lá**

<!--
Roteiro: (1) por que laços de controle; (2) kind + Traefik + metrics-server; (3) base/overlay do
Kustomize; (4) StatefulSet vs Deployment; (5) probes e graceful shutdown; (6) HPA; (7) Ingress e
Gateway API; (8) medir.
-->

---

## Ninguém edita YAML às 10:00

<div class="q">

O lab 3 escalou o `catalog` editando o Compose. O lab 9 reiniciou à mão um serviço que caiu. Quem faz isso durante a venda relâmpago?

</div>

- Kubernetes: você declara o **estado desejado** ("≥ 2 réplicas prontas, mais acima de 60% de CPU").
- Os **controllers** comparam desejado vs real a cada poucos segundos e agem.
- Autocura, rollouts e autoscaling são a mesma ideia: **reconciliação**.

---

## Passo 1 · Um cluster no laptop

- **kind**: 1 control plane + 2 workers, cada um um contêiner Docker; host `:80` → nó `:30080`.
- **Traefik** (Helm, NodePort 30080): o Ingress controller.
- **metrics-server**: CPU para o HPA (`--kubelet-insecure-tls` só no kind).
- Imagens: `docker tag … boxoffice/catalog:dev` + `kind load docker-image` — nunca `latest`.

<div class="warn">

O ingress-nginx foi **aposentado em março de 2026**. Escolha componentes mantidos para o que fica exposto à internet.

</div>

---

## Passo 2 · Kustomize: base + overlays

```text
k8s/base/            namespace, config, db, redis, catalog, hpa, ingress
k8s/overlays/local/  image tag "dev" + lab secrets
```

- `kubectl apply -k k8s/overlays/local`
- `secretGenerator` → `db-credentials-<hash>`: conteúdo novo, nome novo, **rollout**.
- O lab 11 adiciona um overlay de GitOps sem tocar na base.

---

## Stateful vs stateless

| | `db` | `catalog` |
|---|---|---|
| Tipo | StatefulSet | Deployment |
| Identidade | estável: `db-0` | intercambiável |
| Armazenamento | PVC por réplica | nenhum |
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

Nunca verifique uma dependência compartilhada na **liveness**: uma oscilação do banco → todos os pods reiniciam de uma vez.

</div>

---

## Recursos e graceful shutdown

- `requests` (250m, 512Mi): o que o scheduler reserva; **a % do HPA é relativa a eles**.
- `limits` (1 CPU, 768Mi): CPU estrangulada, memória → `OOMKilled`; heap = 75% do limit.
- Desligamento: endpoints removidos **∥** `preStop: sleep 5` → `SIGTERM` → `server.shutdown=graceful`.
- Rollout `maxSurge: 1`, `maxUnavailable: 0`: nunca abaixo do número desejado de prontos.

---

## Convergência eventual

<div class="q">

O `catalog` reiniciou duas vezes logo depois do `kubectl apply`. Bug?

</div>

* Sem `depends_on`: o `catalog` subiu antes do PostgreSQL → o Flyway falhou → saiu → restart com back-off.
* Os componentes **tentam de novo até as dependências existirem**; o sistema converge.
* A primeira inicialização também roda as migrations → o orçamento de startup precisa cobri-las (subimos para 5 min).

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

## O escalonamento reativo atrasa

- Detectar (15–30 s) + decidir + **inicialização e readiness da JVM (~40 s)** ≈ um minuto.
- Durante o atraso, os pods existentes absorvem o degrau: o p95 sobe, depois cai.
- Evento conhecido (abertura de vendas às 10:00) → **pré-escalar**; HPA para o inesperado.
- Mais pods → mais conexões ao banco: o gargalo vai para a camada stateful.

---

## Passo 4 · Ingress (e Gateway API)

- Caminho: `localhost:80` → nó `:30080` → Traefik → regra `/catalog` → Service → pod **pronto**.
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

<p class="small"><code>scripts/watch-hpa.sh</code> registra CPU e réplicas desejadas, atuais e prontas a cada 5 s → faça o gráfico.</p>

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
5. O HPA escala pela % dos **requests**; ele atrasa — pré-escale para picos conhecidos.
6. O Ingress (ou a Gateway API) é a porta; escolha um controller **mantido**.
