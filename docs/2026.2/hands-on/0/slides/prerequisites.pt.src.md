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

<div class="kicker">Plataformas, Microsserviços, DevOps e APIs · Hands-on 0</div>

# Hands-on 0 — Pré-requisitos

**Prepare as ferramentas e o repositório raiz antes do primeiro microsserviço**

<!--
Roteiro: (1) as ferramentas: Git, Docker, Java, Maven; (2) uma organização no GitHub; (3) o
repositório raiz `platform`; (4) bônus: documentação com MkDocs Material no GitHub Pages.
-->

---

## Objetivo

- Instalar o **ambiente de desenvolvimento** usado em todos os hands-on.
- Criar uma **organização no GitHub** para agrupar os repositórios do projeto.
- Criar o **repositório raiz** `platform`: o ponto central dos microsserviços e da documentação.
- (Bônus) publicar a **documentação** do projeto com MkDocs Material e GitHub Pages.

<p class="small">Instalação passo a passo por sistema operacional: apêndice <strong>Development Setup</strong>.</p>

---

## As ferramentas

| Ferramenta | Para quê | macOS | Linux (Debian) |
|---|---|---|---|
| **Git** | controle de versão | `brew install git` | `apt install git` |
| **Docker** | rodar apps em containers isolados | docs do Docker Engine | docs do Docker Engine |
| **Java** | linguagem do backend | `brew install openjdk` | `apt install openjdk-21` |
| **Maven** | dependências e build | `brew install maven` | `apt install maven` |

<div class="ok">

Use um JDK **LTS** — OpenJDK **21** ou **25**.

</div>

<!--
Pergunte quem usa Windows: essas pessoas precisam do passo extra das variáveis de ambiente, no próximo slide.
-->

---

## Windows: um passo a mais

Java e Maven são baixados e **descompactados** à mão (OpenJDK em jdk.java.net, o binário do Maven em maven.apache.org). Depois:

- defina `JAVA_HOME` com a pasta do JDK;
- defina `MAVEN_HOME` com a pasta do Maven;
- adicione o diretório `bin` de cada um ao `PATH`.

<div class="warn">

Esquecer o `PATH` é o erro clássico: as ferramentas estão instaladas, mas o terminal não encontra `java` nem `mvn`.

</div>

---

## Uma organização para o projeto

Crie uma organização no GitHub, p. ex. `<username>-studies`, e coloque **todos** os repositórios da disciplina dentro dela.

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

1. Quatro ferramentas para todos os hands-on: **Git, Docker, Java (LTS 21/25), Maven**.
2. No Windows, defina `JAVA_HOME`, `MAVEN_HOME` e o `PATH`.
3. Uma **organização no GitHub** agrupa os repositórios, as permissões e as issues.
4. O **repositório raiz** `platform` é a porta de entrada: `api/`, `docs/`, `web/`, `docker/`.
5. Documente enquanto constrói: **MkDocs Material** localmente, **GitHub Pages** online.
