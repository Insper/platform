---
marp: true
lang: pt-BR
title: Hands-on 4 — DevOps
description: Plataformas, Microsserviços, DevOps e APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Plataformas, Microsserviços, DevOps e APIs · Hands-on 4</div>

# Hands-on 4 — DevOps

**Automatize build, empacotamento e push com pipelines como código no Jenkins**

<!--
Roteiro: (1) CI e CD; (2) o Jenkins em um container; (3) desbloqueio, executors, credenciais;
(4) Jenkinsfile: só build e build-empacotamento-push; (5) armadilhas.
-->

---

## CI e CD

- **Integração Contínua (CI)** — faça merge com frequência; cada merge dispara **build e testes** automáticos.
- **Entrega Contínua (CD)** — toda mudança que passa pela CI é **empacotada** e fica pronta para o deploy.

`git push` → servidor de CI (**Jenkins**) → Build → Testes → Imagem Docker → Push para o registry → Deploy

<div class="ok">

Objetivo: um ciclo de desenvolvimento **mais curto** — a máquina faz os passos repetitivos, sempre do mesmo jeito.

</div>

---

## Jenkins e Pipeline as Code

- **Servidor de automação** open source, estendido por um rico ecossistema de plugins.
- **Pipeline as Code**: o pipeline fica em um `Jenkinsfile`, versionado **junto ao código**.
- O Jenkins o baixa a cada build — o pipeline **evolui com o código**.

| Sintaxe | Descrição |
|---|---|
| **Declarativa** | DSL estruturada e opinativa — recomendada (usada aqui) |
| **Scripted** | Groovy completo — máxima flexibilidade, curva de aprendizado mais íngreme |

---

## Passo 1 — Jenkins em um container

O `jenkins/compose.yaml` constrói uma imagem personalizada sobre `jenkins/jenkins:jdk25`:

```yaml
services:
  jenkins:
    container_name: jenkins
    build:
      dockerfile_inline: |
        FROM jenkins/jenkins:jdk25
        # + maven, docker-ce, kubectl, AWS CLI
        RUN usermod -aG docker jenkins
    ports:
      - 9080:8080
    volumes:
      - ${CONFIG:-./config}/jenkins:/var/jenkins_home
      - /var/run/docker.sock:/var/run/docker.sock
```

---

## O que a imagem traz

| Ferramenta | Finalidade |
|---|---|
| Maven | build de projetos Java |
| Docker CE | construir e enviar imagens a partir dos pipelines |
| kubectl | deploy em clusters Kubernetes |
| AWS CLI | ECR, ECS, EKS … |

```bash
docker compose up -d --build     # then open http://localhost:9080/
```

<div class="warn">

Montar o `/var/run/docker.sock` dá ao container **controle total do daemon Docker do hospedeiro**. Localmente, tudo bem; em ambiente compartilhado, reforce (Docker rootless, daemon de build dedicado).

</div>

---

## Passo 2 — Desbloquear e configurar

Na primeira inicialização, o Jenkins pede uma **senha inicial de administrador** aleatória:

```bash
docker logs jenkins 2>&1 | grep -A 3 "initialAdminPassword"
docker exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

1. Informe a senha → **Install suggested plugins** → crie um usuário administrador.
2. **Manage Jenkins → Nodes → Built-In Node → Configure**: executors **2 → 10**.

<p class="small">Um executor é um slot que roda um job. Mais executors → vários microsserviços com build em paralelo. No Windows, abra o terminal como Administrador.</p>

---

## Passo 3 — Credenciais

**Manage Jenkins → Credentials → System → Global credentials → Add Credentials**

| Campo | Valor |
|---|---|
| Kind | Username with password |
| Username | seu usuário do Docker Hub |
| Password | um **access token** do Docker Hub |
| ID | `dockerhub-credential` |

<div class="ok">

Use um token com escopo **Read & Write**, e não sua senha: um token vazado é revogado sem mexer na conta.

</div>

---

## Passo 4 — O job `account`: só o build

```groovy
pipeline {
    agent any
    stages {
        stage('Build') {
            steps {
                sh 'mvn -B -DskipTests clean install'
            }
        }
    }
}
```

- `-B` = **batch mode**: sem perguntas interativas, obrigatório na CI.
- **New Item → Pipeline → Pipeline script from SCM**: o Jenkins clona o repositório e lê o `Jenkinsfile`.

---

## Passo 5 — `account-service`: o pipeline

```groovy
environment {
    SERVICE = 'account'
    NAME    = "humbertosandmann/${env.SERVICE}"
}
```

1. **Dependencies** — `build job: 'account', wait: true`: refaz antes o build do módulo do qual depende.
2. **Build** — `mvn -B -DskipTests clean package`: o jar executável.
3. **Build & Push Image** — imagem multiplataforma para o Docker Hub.

<p class="small"><code>NAME</code> é o repositório no Docker Hub; troque o usuário pelo seu.</p>

---

<!-- _class: tight -->

## Build & Push Image

```groovy
withCredentials([usernamePassword(
    credentialsId: 'dockerhub-credential',
    usernameVariable: 'USERNAME', passwordVariable: 'TOKEN')]) {
  sh 'echo $TOKEN | docker login -u $USERNAME --password-stdin'
  sh "docker buildx create --use --platform=linux/arm64,linux/amd64 ..."
  sh "docker buildx build --platform=linux/arm64,linux/amd64 --push \
        --tag ${env.NAME}:latest --tag ${env.NAME}:${env.BUILD_ID} -f Dockerfile ."
  sh "docker buildx rm --force multi-platform-builder-${env.SERVICE}"
}
```

- `withCredentials` injeta o token; os valores ficam **mascarados** nos logs. Aspas simples: quem expande o `$TOKEN` é o **shell**, não o Groovy.
- O `buildx` gera para `linux/arm64` (Apple Silicon, Graviton) **e** `linux/amd64`.
- Duas tags: `:latest` (referência estável) + `:<BUILD_ID>` (rastreável até um build).

---

## Armadilhas comuns

- **ID de credencial diferente**: `credentialsId` precisa ser exatamente `dockerhub-credential`.
- **Repositório fixo no código**: `NAME` precisa apontar para o **seu** usuário do Docker Hub.
- **Job anterior inexistente**: `build job: 'account'` falha se o job `account` não existir.
- **Testes pulados**: `-DskipTests` em todo lugar — adicione uma etapa `Test` com `mvn test` para exigi-los.
- **Poucos executors**: o `account-service` ocupa um slot enquanto espera o `account`; com vários serviços, os 2 slots padrão acabam.

<!--
O ponto dos executors: o account-service ocupa um slot enquanto espera o account.
-->

---

## Pontos-chave

1. A **CI** faz build e testes de cada merge; a **CD** mantém toda mudança aprovada pronta para o deploy.
2. **Pipeline as Code**: o `Jenkinsfile` fica no repositório, com sintaxe declarativa.
3. O Jenkins roda no Docker com Maven, Docker, kubectl e AWS CLI; porta **9080**.
4. Segredos vão para o **credential store** (`dockerhub-credential`), injetados com `withCredentials`.
5. `account-service`: **Dependencies → Build → Build & Push Image**.
6. O `docker buildx` gera imagens **multiplataforma**, com as tags `latest` e `BUILD_ID`.
7. Montar o socket do Docker é **prático localmente, arriscado quando compartilhado**.
