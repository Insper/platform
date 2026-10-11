---
marp: true
lang: pt-BR
title: Hands-on 11 — IA no CI/CD
description: Plataformas, Microsserviços, DevOps e APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Plataformas, Microsserviços, DevOps e APIs · Hands-on 11</div>

# Hands-on 11 — IA no CI/CD

**Um revisor com IA em cada pull request — um guia, não uma barreira**

<!--
Roteiro: (1) por que revisão de código; (2) arquitetura do workflow; (3) secret + arquivo do workflow;
(4) o script de revisão; (5) teste com um problema proposital; (6) extensões e outros padrões de IA no pipeline.
-->

---

## Por que começar pela revisão de código?

<div class="q">

A IA não está substituindo engenheiros — ela muda **quais tarefas** ocupam a atenção deles.
Em que ponto do pipeline um assistente de IA compensa primeiro?

</div>

* **Revisores são escassos** e o tempo de retorno é longo.
* Muitos problemas são **mecânicos**: null checks ausentes, segredos fixos no código, violações de convenções REST.
* Um modelo os detecta **antes** da chegada do revisor humano — que pode focar no design.

<!--
Pergunte quais comentários de revisão eles escrevem repetidamente. Esses são os candidatos à automação.
-->

---

## O objetivo e o fluxo

Quando um desenvolvedor abre um PR, um job do **GitHub Actions** envia o diff à **API do Claude** e publica uma revisão estruturada como **comentário no PR**.

1. O desenvolvedor faz push e abre um PR.
2. O GitHub dispara o workflow em `pull_request` (`opened`, `synchronize`).
3. O job busca o diff: `GET /repos/.../pulls/{pr}/files`.
4. Ele chama o Claude (`claude-sonnet-4-6`) com o diff e um **system prompt**.
5. Ele publica a revisão como comentário no PR.

<div class="ok">

**Não bloqueante**: a revisão nunca bloqueia o merge — ela só aparece na linha do tempo do PR.

</div>

---

## Passo 1 — O secret da chave de API

Repositório → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

- Nome: `ANTHROPIC_API_KEY`
- Valor: sua chave obtida em `console.anthropic.com`
- O runner a injeta como **variável de ambiente** em tempo de execução.
- O `GITHUB_TOKEN` é **automático** — criado a cada execução, com escopo definido pelas `permissions` do workflow.

<div class="warn">

**Nunca faça commit da chave de API** — nem em `.github/workflows/*.yml`, nem em arquivo nenhum. Só nos GitHub Secrets.

</div>

---

## Passo 2 — Workflow: gatilho e permissões

`.github/workflows/ai-review.yml`

```yaml
name: AI Code Review

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  pull-requests: write   # post the comment
  contents: read
```

<p class="small"><code>pull-requests: write</code> é o que permite ao <code>GITHUB_TOKEN</code> comentar no PR.</p>

---

## Passo 2 — Workflow: o job

```yaml
jobs:
  ai-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4         # fetch-depth: 0
      - uses: actions/setup-python@v5     # python-version: "3.12"
      - run: pip install anthropic PyGithub
      - name: Run AI review
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          REPO: ${{ github.repository }}
        run: python .github/scripts/ai_review.py
```

---

## Passo 3 — O system prompt

O **system prompt** em `.github/scripts/ai_review.py` é o principal ponto de controle da qualidade da revisão.

<div class="cols">
<div>

### Foco em

1. Segurança (segredos, SQL injection, falta de autenticação)
2. Tratamento de erros
3. Convenções REST
4. Desempenho (N+1, chamadas síncronas que deveriam ser assíncronas)
5. Validação de entrada

</div>
<div>

### Formato da resposta

- `## Summary` — um parágrafo
- `## Issues Found` — 🔴 Critical · 🟠 Warning · 🟡 Suggestion
- `## What looks good`
- Menos de **400 palavras**; diffs triviais → dizer isso brevemente

</div>
</div>

---

## Passo 3 — Diff entra, comentário sai

```python
diff = get_pr_diff(repo, pr_number)   # concatenates f.patch, stops after 3000 lines

client = anthropic.Anthropic()        # reads ANTHROPIC_API_KEY
message = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    system=SYSTEM_PROMPT,
    messages=[{"role": "user",
               "content": f"Please review this pull request diff:\n\n{diff}"}],
)
post_review_comment(repo, pr_number, message.content[0].text)
```

<p class="small"><code>post_review_comment</code> chama o <code>pr.create_issue_comment(...)</code> do PyGithub com um cabeçalho "🤖 AI Code Review".</p>

---

## Decisões de design

| Decisão | Motivo |
|---|---|
| Diff truncado em **3 000 linhas** | limita o custo de API em PRs enormes; as mudanças importantes costumam estar no início |
| `max_tokens=1024` | ~750 palavras — uma revisão concisa, sem pagar por verbosidade |
| **Comentário**, não review | reviews de PR exigem estado de aprovação; comentários são sempre permitidos por `pull-requests: write` |
| **Não bloqueante** | sem verificação de status obrigatória → o merge nunca é bloqueado |

---

## Passo 4 — Teste com um problema proposital

```bash
git checkout -b feature/add-order-endpoint
# make a change with a deliberate issue,
# e.g. hardcode a JWT secret in application.yaml
git add .
git commit -m "add order endpoint"
git push origin feature/add-order-endpoint
```

- Abra o PR no GitHub → em **~30 s** o workflow `AI Code Review` é disparado.
- A revisão aparece como comentário do **bot do Actions**.

---

## O que você deve ver

```text
## 🤖 AI Code Review

## Summary
This PR adds an order creation endpoint. ... a critical security issue ...

## Issues Found
🔴 Critical — `application.yaml` contains a hardcoded JWT secret
(`jwt.secret: mysecretkey123`). Secrets must be injected via env vars ...
🟡 Suggestion — `POST /orders` returns `200 OK`; resource creation is
`201 Created` with a `Location` header.

## What looks good
Input validation via `@Valid` is correctly applied to the request body.
```

---

## Estendendo o revisor

| Extensão | Como |
|---|---|
| Revisar só código | filtro `paths:` — `**/*.java`, `**/*.yaml`, `**/*.yml`, `**/pom.xml`, `**/Dockerfile` |
| Resumo na descrição do PR | `repo.get_pull(pr_number).edit(body=summary)` |
| Saída estruturada | pedir **só JSON**: `summary`, `critical_issues`, `warnings`, `suggestions`, `score` → renderizar como tabela |
| Bloquear em 🔴 Critical | **Checks API** do GitHub, `checks: write`, um check run em vez de um comentário |
| Problemas específicos do código | adicioná-los (Feign clients, anti-padrões de Spring Boot) à lista `Focus on:` |

---

## Um guia, não uma barreira

<div class="warn">

Bloquear merges com base na saída da IA é confiar nos erros dela: ela pode **apontar código seguro** ou **deixar passar problemas reais**.

</div>

- Comece **apenas com comentários**.
- Passe a bloquear só depois que o time **validar a precisão do modelo** no próprio código.
- **Nunca** coloque a chave de API em um arquivo versionado.
- Mantenha o diff e a resposta **limitados** (3 000 linhas, `max_tokens`) — cada PR é uma chamada de API que custa dinheiro.

---

## A mesma forma, outras tarefas

**Gatilho de CI/CD → coletar contexto → chamada ao LLM com prompt da tarefa → agir sobre o resultado**

| Padrão | O que a IA faz | Quando |
|---|---|---|
| Revisão de código em PR | revisa o diff, aponta problemas | todo PR — este hands-on |
| Geração de testes | escreve testes unitários das funções alteradas | cobertura abaixo do limite |
| Geração de changelog | `CHANGELOG.md` a partir de títulos de PRs/commits | antes de cada release |
| Detecção de anomalias em logs | identifica padrões incomuns | depois de um deploy |
| Consulta a runbooks de incidentes | sugere passos de diagnóstico a partir do alerta | automação de plantão |
| Sincronização da documentação | detecta código alterado com docs desatualizadas | assinaturas da API mudam |

---

## Pontos-chave

1. Revisão de código é um ótimo primeiro uso de IA: revisores escassos, muitos problemas **mecânicos**.
2. Fluxo: evento `pull_request` → buscar o diff → **API do Claude** com um system prompt → **comentário no PR**.
3. `ANTHROPIC_API_KEY` fica nos **GitHub Secrets**; o `GITHUB_TOKEN` é automático (`permissions`).
4. O **system prompt** é o ponto de controle — ajuste a lista `Focus on:` ao seu código.
5. Limite o custo: trunque o diff (**3 000 linhas**) e limite `max_tokens` (**1024**).
6. **Não bloqueante** até validar a precisão do modelo — um guia, não uma barreira.
7. Gatilho → contexto → LLM → ação serve também para testes, changelogs, logs e docs.
