---
marp: true
lang: pt-BR
title: Hands-on 11 — Entrega
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

# Hands-on 11 — Entrega

**Do `git push` a um canary que aborta sozinho**

<!--
Roteiro: (1) por que automatizar a segurança; (2) CI com Testcontainers; (3) cadeia de suprimentos:
Trivy, SBOM, proveniência; (4) orçamento de desempenho; (5) GitOps com Argo CD; (6) canary com Argo
Rollouts; (7) meça: lead time.
-->

---

## Dez mudanças por dia, uma venda relâmpago

<div class="q">

Cada mudança pode quebrar o checkout: uma query lenta, uma biblioteca vulnerável, uma versão que falha
30% das requisições. Quem revisa todas elas à mão?

</div>

- Ninguém consegue: o **pipeline** precisa responder "isto é seguro?" automaticamente.
- E quando ele erra, a **release** precisa limitar o estrago.
- Meça: **lead time** e **taxa de falha de mudanças** (DORA).

---

## O pipeline

| Workflow | Job | Responde |
|---|---|---|
| `CI` | `test` (matriz) | funciona? (Testcontainers) |
| `CI` | `performance budget` | é rápido o bastante? (k6) |
| `CI` | `image` | o que há dentro, é vulnerável, quem construiu? |
| `Deploy` | `promote` | qual versão deve rodar? (um commit no Git) |
| Argo CD + Rollouts | no cluster | faz o deploy, com cuidado |

---

## Passo 1 · Teste contra a coisa real

```java
@SpringBootTest(webEnvironment = RANDOM_PORT)
@AutoConfigureTestRestTemplate
@Testcontainers
class CatalogApiTest {
    @Container @ServiceConnection
    static PostgreSQLContainer db = new PostgreSQLContainer("postgres:17");
    ...
}
```

- Migrações, SQL, Redis e erros JSON reais — `Tests run: 3, Failures: 0`.
- `name: CI`, `permissions: contents: read`, um job por serviço, cache do Maven.

---

## Passo 2 · Cadeia de suprimentos

- **Build** com `load: true` → relatório do **Trivy** (aba Security) → **portão**: CRITICAL com correção reprova.
- **SBOM** (Syft, SPDX): todo pacote e versão na imagem.
- **Push** para `ghcr.io/<you>/boxoffice-catalog:sha-<commit>`.
- **Atestação** de proveniência + SBOM: assinadas (Sigstore), ligadas ao digest.

<div class="warn">

Toda action fixada num **SHA de commit** (versão num comentário): uma tag pode ser movida por um atacante.

</div>

---

## Passo 3 · Orçamento de desempenho

```javascript
thresholds: {
  'http_req_duration{scenario:budget}': ['p(95)<300', 'p(99)<800'],
  'http_req_failed{scenario:budget}': ['rate<0.01'],
}
```

- Ambiente fixo (`.github/ci/compose.perf.yaml`), aquecimento de 20 s não medido.
- Execução normal: p95 ≈ 7 ms. Com `Thread.sleep(400)`: ✗ → o PR fica vermelho.
- Margem de propósito: um **portão ruidoso** é ignorado.

---

## Passo 4 · GitOps

- O CI nunca toca no cluster; o **Deploy** faz commit da nova tag em `k8s/overlays/gitops`.
- O **Argo CD** (no cluster) puxa o Git e aplica: `prune`, `selfHeal`.
- Rollback = `git revert`; auditoria = `git log`; drift → revertido em segundos.

<div class="ok">

As credenciais do cluster nunca saem do cluster.

</div>

---

## Passo 5 · O canary

| Objeto | Papel |
|---|---|
| `Rollout` (`workloadRef` → o Deployment) | 25% → 2 min → 50% → 2 min → 100% |
| Services `catalog-stable` / `catalog-canary` | apontam para os pods de cada versão |
| `AnalysisTemplate` | a cada 30 s: taxa de erro do canary < 1%, p99 < 500 ms |
| Prometheus | faz scrape de `/actuator/prometheus`, label `service` |

---

## Uma release ruim, pelo Git

<div class="q">

`CHAOS_ERROR_RATE=0.3` entra no overlay por um commit. O que acontece?

</div>

* O Argo CD sincroniza → o Rollout inicia um pod canary.
* Análise: `[]` (ainda sem dados), **0,068**, **0,285** → duas falhas > `failureLimit: 1`.
* `RolloutAborted` → canary reduzido a zero; o estável continua atendendo. Corrija para a frente: `git revert`.

---

## O que um canary não consegue pegar

- **Migrações** rodam uma vez para as duas versões → só expand/contract.
- **Erros raros** precisam de muitas requisições no canary → pausas maiores com pouco tráfego.
- **Efeitos colaterais** das requisições do canary (pagamentos, e-mails) são reais.
- Sem tráfego, sem evidência: mantenha carga durante a análise.

---

<!-- _class: tight -->

## Passo 6 · Meça

| # | Experimento | Registre |
|---|---|---|
| A | etapas do pipeline | duração de cada job |
| B | lead time | push → CI → commit de deploy → sincronizado → estável |
| C | portão de desempenho | p95/p99/falhas, normal vs regressão |
| D | canary | sync → abort, medições de erro, requisições que falharam |

<p class="small">O lead time é dominado pelos testes, pelo build da imagem, pela consulta do Argo CD (≤ 3 min) e pelas pausas do canary — um preço deliberado pela segurança.</p>

---

## Pontos-chave

1. Teste contra **dependências reais** (Testcontainers); rode o CI em todo PR e na `main`.
2. **Privilégio mínimo** por job; fixe toda action num SHA de commit.
3. Escaneie **antes** de publicar; SBOM + proveniência assinada respondem "o quê" e "quem".
4. Um **orçamento de desempenho** transforma o SLO numa verificação do build — com margem.
5. **GitOps**: o Git é a fonte da verdade; o cluster puxa.
6. **Canary + análise** para releases ruins automaticamente. Próximo: o [lab 13](../../13/index.md) adiciona IA a este pipeline.
