Para começar os hands-on, precisamos preparar o nosso ambiente. Isso inclui instalar as ferramentas necessárias, configurar o espaço de trabalho e garantir o acesso aos recursos exigidos.

Para configurar o seu ambiente de desenvolvimento, consulte o apêndice [Configuração do ambiente de desenvolvimento](../../../appendix/development-setup.md).

Depois disso, o seu ambiente deve estar pronto para começar os exercícios. Vamos criar um repositório raiz, para facilitar o acesso aos repositórios dos outros microsserviços e também à documentação.

## Slides

<div class="slides-embed">
  <iframe src="slides/prerequisites.pt.html" title="Slides: hands-on 0 — pré-requisitos" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/prerequisites.pt.html){:target="_blank"}

## Repositório raiz

O repositório raiz será o ponto central de acesso a todos os outros repositórios de microsserviços e à documentação. Ele ajuda a organizar a estrutura do projeto e a gerenciar as dependências de forma eficiente.

Para organizar melhor o projeto, propomos criar uma nova organização no GitHub, chamada algo como `<username>-studies`, e então criar o repositório raiz dentro dessa organização, assim como os repositórios dos outros microsserviços. Dessa forma, fica fácil gerenciar as permissões de acesso e colaborar com outros membros da equipe. Também podemos usar os recursos de gerenciamento de projetos do GitHub, como issues e pull requests, para acompanhar o progresso e coordenar o trabalho entre os diferentes repositórios.

!!! tip "Hospedagem da documentação"

    Além disso, podemos usar o GitHub Pages para hospedar a documentação do projeto.

Passos:

1. Crie um novo repositório chamado `platform` dentro da organização e clone-o na sua máquina local. Esse repositório será o repositório raiz do nosso projeto.

2. Dentro desse repositório raiz, podemos criar uma estrutura de diretórios para organizar os microsserviços e a documentação. Por exemplo:

    ``` { .tree title="Root Directory Structure"}
    platform/
        api/
        docs/
            index.md
        web/
        docker/
        .gitignore
        README.md
    ```

!!! example "BÔNUS: MkDocs com Material"

    Você pode usar o [MkDocs com Material](https://squidfunk.github.io/mkdocs-material/){target="_blank"} para a documentação e hospedá-la com o GitHub Pages. Assim teremos um site de documentação bem estruturado, visualmente agradável e de fácil acesso para todos os membros da equipe.

    Para configurar o mkdocs com material, você pode copiar a configuração do repositório modelo e adaptá-la às necessidades do seu projeto.

    Copie para o repositório raiz os seguintes arquivos do repositório modelo: [mkdocs.yml](./mkdocs.yml){download="mkdocs.yml"} e [requirements.txt](./requirements.txt){download="requirements.txt"}

    A estrutura de diretórios resultante ficará assim:

    ``` { .tree title="Root Directory Structure"}
    platform/
        api/
        docs/
            index.md
        web/
        docker/
        .gitignore
        README.md
        mkdocs.yml
        requirements.txt
    ```

    Depois de configurar o mkdocs, você pode gerar e servir a documentação localmente com os seguintes comandos:

    === ":simple-apple: Mac/:simple-linux: Linux"

        ``` bash
        python3 -m venv venv
        source venv/bin/activate
        python3 -m pip install --no-cache-dir -r requirements.txt --upgrade
        mkdocs build
        mkdocs serve
        ```

    === ":material-microsoft-windows: Windows"

        ``` bash
        python -m venv venv
        venv\Scripts\activate
        python -m pip install --no-cache-dir -r requirements.txt --upgrade
        mkdocs build
        mkdocs serve
        ```

    Isso inicia um servidor local de desenvolvimento, e você pode acessar a documentação abrindo [`http://127.0.0.1:8000`](http://127.0.0.1:8000){target="_blank"} no seu navegador.


Agora, sem mais demora, você já pode começar os hands-on!
