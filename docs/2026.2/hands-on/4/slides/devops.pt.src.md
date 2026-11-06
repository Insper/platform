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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

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

<div class="flow">
<div class="box muted">git push</div><div class="arrow">→</div>
<div class="box accent">Jenkins<small>servidor de CI</small></div><div class="arrow">→</div>
<div class="box">Build</div><div class="arrow">→</div>
<div class="box">Testes</div><div class="arrow">→</div>
<div class="box orange">imagem Docker<small>empacota</small></div><div class="arrow">→</div>
<div class="box orange">registry<small>push</small></div><div class="arrow">→</div>
<div class="box green">Deploy</div>
</div>

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

<p class="small">A home do Jenkins (plugins, jobs, credenciais) fica em <code>./config/jenkins</code>, então sobrevive ao <code>docker compose down</code>; ela guarda segredos, por isso o <code>jenkins/.gitignore</code> deixa <code>config/</code> e <code>.env</code> fora do git.</p>

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

Use um token com escopo **Read & Write** e não sua senha: um token vazado é revogado sem mexer na conta.

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

<div class="flow">
<div class="box accent">Dependencies<small>build job: 'account', wait: true</small></div><div class="arrow">→</div>
<div class="box accent">Build<small>mvn -B -DskipTests clean package</small></div><div class="arrow">→</div>
<div class="box orange">Build &amp; Push Image<small>imagem multiplataforma para o Docker Hub</small></div><div class="arrow">→</div>
<div class="box green">:latest + :BUILD_ID</div>
</div>
<div class="flow">
<div class="box red">qualquer estágio falha → <strong>Finished: FAILURE</strong><small>os estágios seguintes são pulados; um account que falha derruba Dependencies</small></div>
</div>

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

## Poucos executors: um build que espera segura o slot

<div class="flow" style="align-items: stretch">
<div class="group">
<div class="caption">Built-In Node · 2 executors</div>
<div class="box orange">account-service #1<small>Dependencies: espera o account</small></div>
<div class="box orange">auth-service #1<small>Dependencies: espera o account</small></div>
</div>
<div class="arrow" style="align-self: center">⇄</div>
<div class="group">
<div class="caption">Fila de builds</div>
<div class="box red">account #1<small>esperando o próximo executor livre</small></div>
</div>
</div>

- Cada pipeline segura o executor **enquanto espera**; o `account` nunca ganha um: os builds travam para sempre.
- A solução do lab: **10 executors**, mais do que os pipelines que esperam ao mesmo tempo.

<!--
A página desenha o mesmo caso como diagrama de sequência em "Executors de menos"; o simulador mostra o caso e a solução.
-->

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

## Sem Jenkins: o simulador

<div class="flow">
<div class="box accent">os jobs do lab<small>account e depois account-service: :latest e :1 em 140 s</small></div>
<div class="box orange">poucos executors<small>2 executors: travado desde 5 s · 10: pronto em 150 s</small></div>
<div class="box red">um estágio que falha<small>account não compila · ID de credencial errado</small></div>
</div>

- O Built-In Node, seus executors, a fila de builds e a visão de estágios dos Jenkinsfiles do lab.
- Mude os executors ou injete uma falha com os builds rodando.

<!--
O simulador está no fim da seção 5 da página. As durações são ilustrativas.
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
