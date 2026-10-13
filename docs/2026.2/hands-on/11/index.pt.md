# 11. IA no CI/CD

!!! info "Objetivo"

    Adicionar uma etapa de revisão de código com IA ao pipeline de CI/CD da plataforma. Quando um desenvolvedor abre um pull request, um workflow do GitHub Actions chama a API do Claude para analisar o diff e publica um comentário de revisão estruturado — apontando automaticamente problemas de segurança, testes ausentes e questões de arquitetura.

A IA não está substituindo engenheiros no desenvolvimento de software — ela está mudando quais tarefas ocupam a atenção deles. A revisão de código é um dos lugares de maior alavancagem para introduzir assistência de IA: revisores são escassos, o tempo de retorno é longo e muitos problemas (verificações de null ausentes, segredos fixos no código, violações das convenções de endpoints REST) são mecânicos o bastante para que um modelo os detecte com confiabilidade. Este hands-on adiciona um revisor automático com IA a cada pull request do repositório do projeto dos alunos.

## Slides

<div class="slides-embed">
  <iframe src="slides/ai-cicd.html" title="Slides: IA no CI/CD" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/ai-cicd.html){:target="_blank"}

---

## 1. Arquitetura

O revisor roda como um job do GitHub Actions disparado a cada evento de pull request. Ele busca o diff, envia-o para a API do Claude e publica a resposta estruturada como um comentário no PR antes da chegada dos revisores humanos.

``` mermaid-sim
sequenceDiagram
    autonumber
    actor Dev as Desenvolvedor
    participant GH as GitHub
    participant GHA as GitHub Actions
    participant Claude as Claude API<br/>(claude-sonnet-4-6)
    participant PR as Pull Request

    Dev->>GH: git push + abre o PR
    GH->>+GHA: trigger: pull_request (opened, synchronize)
    GHA->>GH: GET /repos/.../pulls/{pr}/files (diff)
    GHA->>+Claude: POST /messages {diff, system_prompt}
    Claude-->>-GHA: JSON da revisão {summary, issues[], suggestions[]}
    GHA->>-PR: POST do comentário com a revisão formatada
```

A revisão roda como uma verificação não bloqueante — ela nunca bloqueia o merge, mas o resultado fica visível na linha do tempo do PR antes da chegada dos revisores humanos.

---

## 2. Configuração

### 2.1 Secret da chave de API

Adicione a chave da API do Claude aos secrets do repositório no GitHub:

1. Vá em repositório → **Settings** → **Secrets and variables** → **Actions**
2. Clique em **New repository secret**
3. Nome: `ANTHROPIC_API_KEY`
4. Valor: sua chave de API obtida em [console.anthropic.com](https://console.anthropic.com){target="_blank"}

!!! danger "Nunca faça commit da chave de API"

    A chave deve ficar nos GitHub Secrets, nunca em `.github/workflows/*.yml` nem em qualquer arquivo versionado. O runner do Actions a injeta como variável de ambiente em tempo de execução.

### 2.2 Arquivo do workflow

Crie `.github/workflows/ai-review.yml`:

``` { .yaml .copy }
name: AI Code Review

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  pull-requests: write
  contents: read

jobs:
  ai-review:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install dependencies
        run: pip install anthropic PyGithub

      - name: Run AI review
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          REPO: ${{ github.repository }}
        run: python .github/scripts/ai_review.py
```

!!! tip "O GITHUB_TOKEN é automático"

    O secret `GITHUB_TOKEN` é injetado automaticamente pelo GitHub Actions em cada execução de workflow, com escopo restrito ao repositório e às permissões declaradas pelo workflow. Ele tem acesso de escrita a pull requests porque declaramos `permissions: pull-requests: write`. Você não cria esse secret manualmente.

---

## 3. O script de revisão

Crie `.github/scripts/ai_review.py`. O script busca o diff do PR, envia-o para a API do Claude e publica a resposta como um comentário no PR.

``` { .python .copy linenums="1" }
import os
import anthropic
from github import Github

SYSTEM_PROMPT = """You are an expert code reviewer for a microservices platform course.
Analyse the git diff provided and produce a structured review.

Focus on:
1. Security issues (hardcoded secrets, SQL injection, missing auth)
2. Missing or inadequate error handling
3. REST API convention violations (wrong HTTP methods, missing status codes)
4. Obvious performance problems (N+1 queries, synchronous calls that should be async)
5. Missing input validation

Format your response as markdown with these sections:
## Summary
One paragraph overall assessment.

## Issues Found
Use severity labels: 🔴 Critical | 🟠 Warning | 🟡 Suggestion

## What looks good
Briefly note correct patterns you observed.

Keep the review concise (under 400 words). If the diff is trivial (docs, config only), say so briefly.
"""

def get_pr_diff(repo, pr_number: int) -> str:
    pr = repo.get_pull(pr_number)
    files = pr.get_files()
    diff_parts = []
    total_lines = 0
    for f in files:
        if total_lines > 3000:
            diff_parts.append("... (diff truncated — too large for single review)")
            break
        if f.patch:
            diff_parts.append(f"### {f.filename}\n```diff\n{f.patch}\n```")
            total_lines += f.patch.count('\n')
    return "\n\n".join(diff_parts) if diff_parts else "No code changes detected."

def post_review_comment(repo, pr_number: int, body: str) -> None:
    pr = repo.get_pull(pr_number)
    pr.create_issue_comment(
        f"## 🤖 AI Code Review\n\n{body}\n\n---\n"
        "*Powered by Claude · Non-blocking · For guidance only*"
    )

def main():
    gh = Github(os.environ["GITHUB_TOKEN"])
    repo = gh.get_repo(os.environ["REPO"])
    pr_number = int(os.environ["PR_NUMBER"])

    diff = get_pr_diff(repo, pr_number)

    client = anthropic.Anthropic()
    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[
            {"role": "user", "content": f"Please review this pull request diff:\n\n{diff}"}
        ]
    )

    review_text = message.content[0].text
    post_review_comment(repo, pr_number, review_text)
    print(f"Review posted to PR #{pr_number}")

if __name__ == "__main__":
    main()
```

Principais decisões de design deste script:

| Decisão | Motivo |
|---|---|
| **Diff truncado em 3 000 linhas** | Evita custo excessivo de API em PRs muito grandes; as mudanças mais importantes costumam estar no início |
| **`max_tokens=1024`** | ~750 palavras — o suficiente para uma revisão concisa sem pagar por verbosidade |
| **Comentário, não review** | Reviews de PR exigem um estado de aprovação; comentários de issue são mais simples e sempre permitidos por `pull-requests: write` |
| **Não bloqueante** | O workflow publica um comentário, mas não define uma verificação de status obrigatória, então o merge nunca é bloqueado |

---

## 4. Testando a revisão

### 4.1 Crie um PR de teste

``` termynal
$ git checkout -b feature/add-order-endpoint
$ # make a change with a deliberate issue:
$ # e.g., hardcode a JWT secret in application.yaml
$ git add .
$ git commit -m "add order endpoint"
$ git push origin feature/add-order-endpoint
```

Abra um pull request no GitHub. Em cerca de 30 segundos, o workflow `AI Code Review` é disparado.

### 4.2 O que você deve ver

A revisão aparece como um comentário no PR feito pelo bot do Actions, estruturado assim:

```
## 🤖 AI Code Review

## Summary
This PR adds an order creation endpoint. The logic is mostly correct,
but there is a critical security issue that must be resolved before merging.

## Issues Found
🔴 Critical — `application.yaml` contains a hardcoded JWT secret
(`jwt.secret: mysecretkey123`). Secrets must be injected via environment
variables or a secrets manager, never committed to source control.

🟡 Suggestion — `POST /orders` returns `200 OK` on success. REST convention
for resource creation is `201 Created` with a `Location` header pointing
to the new resource.

## What looks good
Input validation via `@Valid` is correctly applied to the request body.
The service layer is cleanly separated from the controller.
```

!!! tip "Calibre o prompt"

    O system prompt em `ai_review.py` é o principal ponto de controle da qualidade da revisão. Se o modelo deixar passar problemas específicos do seu código (por exemplo, padrões de Feign client, anti-padrões de Spring Boot), adicione-os à lista `Focus on:`.

---

## 5. Estendendo o revisor

### 5.1 Apenas arquivos Java/YAML

Adicione um filtro de caminhos para que mudanças triviais (documentação, imagens) não disparem uma revisão:

``` { .yaml .copy }
on:
  pull_request:
    types: [opened, synchronize]
    paths:
      - "**/*.java"
      - "**/*.yaml"
      - "**/*.yml"
      - "**/pom.xml"
      - "**/Dockerfile"
```

### 5.2 Adicione um resumo da revisão à descrição do PR

Em vez de um comentário (ou além dele), atualize a descrição do PR com um breve resumo feito pela IA:

``` { .python .copy }
repo.get_pull(pr_number).edit(body=summary)
```

### 5.3 Saída estruturada em JSON

Force o modelo a devolver um objeto estruturado pedindo JSON e fazendo o parse:

``` { .python .copy }
SYSTEM_PROMPT_JSON = """... same instructions ...
Respond ONLY with valid JSON matching this schema:
{
  "summary": "string",
  "critical_issues": ["string"],
  "warnings": ["string"],
  "suggestions": ["string"],
  "score": 1-10
}"""
```

Depois, renderize o JSON como uma tabela Markdown formatada no comentário do PR.

### 5.4 Bloqueie o merge em problemas críticos

Analise a revisão em busca de itens 🔴 Critical e use a GitHub Checks API para bloquear o merge até que os problemas críticos sejam resolvidos. Isso exige a permissão `checks: write` e a criação de um check run em vez de um comentário.

!!! warning "Use a revisão por IA como guia, não como barreira"

    Bloquear merges com base na saída da IA pode gerar falsos negativos (o modelo aponta código seguro) ou falsos positivos (o modelo deixa passar problemas reais). Comece apenas com comentários. Passe a bloquear somente se o time validar antes a precisão do modelo no seu código específico.

---

## 6. Outros padrões de IA no pipeline

Padrões da indústria que seguem a mesma estrutura — disparo por um evento de CI/CD, chamada a um LLM, ação sobre o resultado:

| Padrão | O que a IA faz | Quando usar |
|---|---|---|
| **Revisão de código em PR** | Revisa o diff e aponta problemas | Em todo PR — este hands-on |
| **Geração de testes** | Escreve testes unitários para as funções alteradas | Quando a cobertura cai abaixo de um limite |
| **Padronização de mensagens de commit** | Reescreve ou valida mensagens de commit | Times grandes com mensagens de commit inconsistentes |
| **Geração de changelog** | Gera o CHANGELOG.md a partir dos títulos de PRs/commits | Antes de cada release |
| **Detecção de anomalias em logs** | Detecta padrões incomuns depois do deploy | Ao fim de um deploy |
| **Consulta a runbooks de incidentes** | A partir do texto de um alerta, sugere passos de diagnóstico | Automação de plantão (on-call) |
| **Sincronização da documentação** | Detecta mudanças de código com documentação desatualizada | Quando as assinaturas da API mudam |

Todos eles compartilham a mesma arquitetura deste hands-on: um gatilho de CI/CD, uma etapa de coleta de contexto, uma chamada ao LLM com um system prompt específico da tarefa e uma ação sobre o resultado.

---

## 7. Checklist

- [ ] Secret `ANTHROPIC_API_KEY` adicionado às configurações do repositório no GitHub
- [ ] `.github/workflows/ai-review.yml` criado e versionado
- [ ] `.github/scripts/ai_review.py` criado e versionado
- [ ] PR de teste aberto e comentário de revisão da IA aparecendo em até 60 segundos
- [ ] Revisão não bloqueante (não impede o merge)
- [ ] System prompt personalizado com padrões de microsserviços específicos da plataforma

[Próximo: Quiz](quiz.md){ .md-button .md-button--primary }
