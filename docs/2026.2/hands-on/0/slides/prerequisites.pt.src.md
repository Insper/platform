---
marp: true
lang: pt-BR
title: Hands-on 0 — Pré-requisitos
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

<div class="kicker">Plataformas, Microsserviços, DevOps e APIs · Hands-on 0</div>

# Hands-on 0 — Pré-requisitos

**Prepare as ferramentas e o repositório raiz antes do primeiro microsserviço**

<!--
Roteiro: (1) as ferramentas do apêndice Configuração do ambiente de desenvolvimento: Git, Docker, Java, Maven, uv;
(2) os comandos de verificação; (3) uma organização no GitHub; (4) o repositório raiz `platform`;
(5) bônus: documentação com MkDocs Material no GitHub Pages.
-->

---

## Objetivo

- Preparar o **ambiente de desenvolvimento** usado em todos os hands-on.
- Criar uma **organização no GitHub** para agrupar os repositórios do projeto.
- Criar o **repositório raiz** `platform`: o ponto central dos microsserviços e da documentação.
- (Bônus) publicar a **documentação** do projeto com MkDocs Material e GitHub Pages.

<p class="small">Instalação passo a passo por sistema operacional: apêndice <strong>Configuração do ambiente de desenvolvimento</strong>.</p>

---

<!-- _class: tight -->

## As ferramentas: um caminho

<div class="flow">
<div class="box">o seu código<small>Java · Spring Boot</small></div><div class="arrow">commit →</div>
<div class="box accent">Git<small>GitHub</small></div><div class="arrow">mvn package →</div>
<div class="box accent">Maven<small>target/*.jar</small></div><div class="arrow">docker build →</div>
<div class="box orange">imagem Docker</div><div class="arrow">compose up →</div>
<div class="box green">container<small>mais tarde, no Kubernetes</small></div>
</div>

| Ferramenta | Por que você precisa dela |
|---|---|
| **Git** | controle de versão: todo laboratório vive num repositório; a integração contínua (CI, *continuous integration*) começa com um `git push` |
| **Docker** | executa cada serviço, banco de dados e broker num container isolado |
| **Java** (JDK) | a linguagem dos microsserviços (Spring Boot); o JDK os compila e executa |
| **Maven** | baixa as dependências, compila, roda os testes e empacota o jar |
| **uv** | executa os scripts Python dos laboratórios finais, com versões fixadas |

<!--
Quatro ferramentas para o caminho Java, mais o uv para os scripts Python dos laboratórios finais.
-->

---

<!-- _class: tight -->

## Instalação, por sistema

| Ferramenta | Windows | macOS | Linux (Debian) |
|---|---|---|---|
| **Git** | Git for Windows (+ Git Bash) | `brew install git` | `apt install git` |
| **Docker** | Docker Desktop | Docker Desktop | Docker Engine (nativo) |
| **Java** | JDK Temurin 25 `.msi` | `brew install openjdk@25` | `apt install openjdk-25-jdk` |
| **Maven** | binário `.zip` + `PATH` | `brew install maven` | `apt install maven` |
| **uv** | instalador PowerShell | `brew install uv` | `curl … install.sh \| sh` |

- O Docker Desktop roda o engine numa pequena VM Linux; no Linux, adicione o seu usuário ao grupo `docker`.
- Prefira o **Maven Wrapper** do projeto (`./mvnw`) quando houver: todos fazem o build com a mesma versão.
- Na disciplina, o Python roda pelo **uv**, nunca pelo `pip`.

---

## Java: um JDK LTS

- Você precisa de um **JDK** (compilador + runtime), não só de um JRE.
- Use uma **LTS**: o **JDK 25** (setembro de 2025); o JDK 21 ainda serve nos laboratórios que o fixam.
- `brew install openjdk` sozinho instala a versão mais nova — não necessariamente uma LTS.
- Windows: no instalador Temurin, mantenha **Add to PATH** e ative o **`JAVA_HOME`** (desligado por padrão).
- O Maven encontra o Java pelo `JAVA_HOME`: defina-o antes, com a pasta do JDK (a que contém `bin/`).
- Vários JDKs lado a lado: o **SDKMAN!** (macOS, Linux) troca de versão e define o `JAVA_HOME`.

---

## Verifique o seu ambiente

Abra um terminal **novo** (ele enxerga o `PATH` atualizado) e rode:

```bash
git --version
docker run --rm hello-world
java -version
mvn -v
uv --version
```

<div class="warn">

O `mvn -v` deve informar a **mesma versão do Java** que o `java -version`: o Maven usa o `JAVA_HOME`, que pode apontar para um JDK diferente do que está no seu `PATH`.

</div>

<!--
Solução de problemas na página: daemon do Docker parado, permissão no docker.sock (grupo docker),
JAVA_HOME mal definido, um JDK antigo primeiro no PATH, comando não encontrado num terminal antigo.
-->

---

## Uma organização para o projeto

Crie uma organização no GitHub, p. ex. `<username>-studies` e coloque **todos** os repositórios da disciplina dentro dela.

<div class="group">
<div class="caption">organização no GitHub · username-studies</div>
<div class="flow">
<div class="box accent">platform<small>repositório raiz</small></div><div class="arrow">submódulos em api/ →</div>
<div class="box">account</div><div class="box">account-service</div><div class="box muted">gateway-service, …</div>
</div>
</div>

- **Permissões de acesso** gerenciadas em um só lugar.
- **Issues e pull requests** para acompanhar o progresso entre repositórios.
- **GitHub Pages** para hospedar a documentação do projeto.

---

## O repositório raiz

Crie `platform` dentro da organização e clone-o:

```text
platform/
    api/
    docs/
        index.md
    web/
    docker/
    .gitignore
    README.md
```

<p class="small">Ele organiza a estrutura do projeto: os microsserviços ficam em <code>api/</code>, a documentação em <code>docs/</code>.</p>

---

## Bônus: documentação com MkDocs Material

Copie `mkdocs.yml` e `requirements.txt` do modelo para a raiz e então:

```bash
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
python3 -m pip install --no-cache-dir -r requirements.txt --upgrade
mkdocs build
mkdocs serve
```

Abra `http://127.0.0.1:8000` — e hospede o mesmo site com o **GitHub Pages**.

---

## Pontos-chave

1. Um caminho: **código → Git → build com Maven → imagem Docker → container**; mais o **uv** para o Python.
2. Docker Desktop no macOS e no Windows; **Docker Engine** nativo no Linux.
3. Um **JDK LTS** (25, ou 21 onde o laboratório o fixa); `mvn -v` e `java -version` devem concordar.
4. Rode os comandos da **verificação** num terminal novo antes do primeiro laboratório.
5. Uma **organização no GitHub** e o **repositório raiz** `platform`: `api/`, `docs/`, `web/`, `docker/`.
6. Documente enquanto constrói: **MkDocs Material** localmente, **GitHub Pages** online.
