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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

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
- Meça: **lead time** e **taxa de falha de mudanças** (DORA, *DevOps Research and Assessment*).

---

## O pipeline

<div class="flow">
<div class="group">
<div class="caption">CI: integração contínua, em todo push e pull request</div>
<div class="box accent">test (matriz)<small>funciona? Testcontainers</small></div>
<div class="box accent">performance budget<small>é rápido o bastante? k6</small></div>
<div class="box accent">image<small>o que há dentro, é vulnerável, quem construiu?</small></div>
</div>
<div class="arrow">na main →</div>
<div class="box orange" style="flex: .6">Deploy<small>qual versão deve rodar? um commit no Git</small></div>
<div class="arrow">pull →</div>
<div class="group">
<div class="caption">no cluster</div>
<div class="box green">Argo CD<small>aplica o overlay</small></div>
<div class="box green">Argo Rollouts<small>faz o deploy, com cuidado</small></div>
</div>
</div>

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

<div class="flow">
<div class="box">build<small>load: true, ainda sem push</small></div><div class="arrow">→</div>
<div class="box orange">Trivy<small>relatório em Security; portão: CRITICAL com correção reprova</small></div><div class="arrow">→</div>
<div class="box accent">SBOM<small>Syft, SPDX: todo pacote e versão</small></div><div class="arrow">→</div>
<div class="box accent">push<small>ghcr.io/…/boxoffice-catalog:sha-…</small></div><div class="arrow">→</div>
<div class="box green">atestação<small>proveniência + SBOM, assinadas, ligadas ao digest</small></div>
</div>

- **Escaneie antes de publicar**: uma imagem vulnerável nunca chega ao registry.
- A lista de materiais de software (**SBOM**, *software bill of materials*) responde "o que há dentro"; a proveniência assinada responde "quem construiu, a partir de qual commit".

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
- Execução normal: p95 ≈ 7 ms. Com `Thread.sleep(400)`: ✗ → o pull request (PR) fica vermelho.
- Margem de propósito: um **portão ruidoso** é ignorado.

---

## Passo 4 · GitOps

<div class="flow">
<div class="box accent">CI<small>imagem sha-…</small></div><div class="arrow">→</div>
<div class="box orange">Deploy<small>commit da tag em k8s/overlays/gitops</small></div><div class="arrow">→</div>
<div class="box">Git<small>o estado desejado</small></div><div class="arrow">← consulta a cada 3 min ←</div>
<div class="box green">Argo CD<small>dentro do cluster: aplica, poda, se autocorrige</small></div>
</div>

- O CI nunca toca no cluster: ele só escreve no Git.
- Rollback = `git revert`; auditoria = `git log`; drift → revertido em segundos.

<div class="ok">

As credenciais do cluster nunca saem do cluster.

</div>

---

## Passo 5 · O canary

<div class="flow">
<div class="box orange">setWeight 25<small>1 pod canary + 2 estáveis: cerca de um terço</small></div><div class="arrow">pausa 2 min →</div>
<div class="box orange">setWeight 50<small>1 canary + 1 estável</small></div><div class="arrow">pausa 2 min →</div>
<div class="box green">o canary vira o estável</div>
</div>
<div class="flow">
<div class="box accent">AnalysisRun, a cada 30 s desde o primeiro passo<small>taxa de erro do canary &lt; 1% e p99 &lt; 500 ms · failureLimit: 1 · resultado vazio = aprovado</small></div>
</div>

- Sem traffic router: o `Rollout` chega a um peso pela **contagem de réplicas** (`workloadRef` → o Deployment).
- Os Services `catalog-stable` / `catalog-canary` apontam para cada versão; o Prometheus marca toda série com `service`.

---

## Uma release ruim, pelo Git

<div class="q">

`CHAOS_ERROR_RATE=0.3` entra no overlay por um commit. O que acontece?

</div>

* O Argo CD sincroniza → o Rollout inicia um pod canary.
* Análise: `[]` (ainda sem dados), **0,068**, **0,285** → duas falhas > `failureLimit: 1`.
* `RolloutAborted` → canary reduzido a zero; o estável continua atendendo. Corrija para a frente: `git revert`.

---

## Sem cluster: repita a análise

<div class="flow">
<div class="box">t = 0 s<small>[] · ainda sem série 500</small></div><div class="arrow">→</div>
<div class="box red">t = 30 s<small>0.258 ✖ (1)</small></div><div class="arrow">→</div>
<div class="box red">t = 60 s<small>0.284 ✖ (2) &gt; failureLimit 1</small></div><div class="arrow">→</div>
<div class="box orange">RolloutAborted<small>cerca de 120 requisições com falha, 10% daquele minuto</small></div>
</div>

- O simulador do passo do canary: uma release boa → todo resultado `[]` → estável em **240 s**.
- **0 req/s** com 0.3 → todo resultado `[]` → a release ruim é **promovida**: sem tráfego, sem evidência.
- `Thread.sleep(400)` → p99 de 0,409 s passa no canary; só o portão do passo 3 a barra.
- Playground `boxoffice-canary`: o mesmo bug como canary custa um quarto dos erros.

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
4. Um **orçamento de desempenho** transforma o objetivo de nível de serviço (SLO) numa verificação do build — com margem.
5. **GitOps**: o Git é a fonte da verdade; o cluster puxa.
6. **Canary + análise** para releases ruins automaticamente. Próximo: o [lab 13](../../13/index.md) adiciona IA a este pipeline.
