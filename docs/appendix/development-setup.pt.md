Esta página prepara a sua máquina para os laboratórios. Todo microsserviço da disciplina segue o mesmo caminho — você escreve código Java, acompanha as mudanças com o Git, faz o build com o Maven, empacota como uma imagem Docker e executa como um container (mais tarde, no Kubernetes) —, então você precisa de quatro ferramentas, mais o uv para os scripts Python dos laboratórios finais. Instale-as uma vez e depois rode a [verificação](#check) do fim da página.

``` diagram
flowchart LR
    code["o seu código<br/>src/, pom.xml"] -->|"git commit, git push"| git["Git<br/>histórico no GitHub"]:::comp
    code -->|"mvn package<br/>(compila com o JDK)"| jar["target/app.jar"]:::tech
    jar -->|"docker build"| img["imagem Docker"]:::comp
    img -->|"docker run"| ctr(["container"])
```

| Ferramenta | Por que você precisa dela |
|:-----|:----------------|
| **[Git](#git)** | Controle de versão: todo laboratório e projeto vive num repositório Git, e a CI começa com um `git push`. |
| **[Docker](#docker)** | Executa cada serviço, banco de dados e broker num container isolado, do mesmo jeito em qualquer máquina. |
| **[Java](#java)** (JDK) | A linguagem dos microsserviços da disciplina (Spring Boot); o JDK os compila e executa. |
| **[Maven](#maven)** | Faz o build dos projetos Java: baixa as dependências, compila, roda os testes e empacota o jar. |
| **[uv](#uv)** | Executa os scripts e as ferramentas Python dos laboratórios finais, com as versões exatas fixadas. |

## Git { #git }

O Git é um sistema de controle de versão distribuído: ele registra cada mudança no seu código e permite que uma equipe trabalhe no mesmo repositório.

=== ":material-microsoft-windows: Windows"

    Baixe e instale o **Git for Windows** a partir de [git-scm.com](https://git-scm.com/install/windows){:target="_blank"}. Ele também traz o *Git Bash*, um terminal no estilo Unix.

=== ":simple-apple: macOS"

    Instale o Git com o Homebrew usando o comando:

    ```bash
    brew install git
    ```

    (Sem o Homebrew, `xcode-select --install` instala o Git da Apple junto com as ferramentas de linha de comando.)

=== ":simple-linux: Linux"

    Instale o Git com o seu gerenciador de pacotes, por exemplo, em sistemas baseados em Debian:

    ```bash
    sudo apt update
    sudo apt install git
    ```

## Docker { #docker }

O Docker executa aplicações em **containers**: processos leves e isolados que carregam tudo de que precisam, de modo que um serviço se comporta igual no seu notebook, no de um colega e na nuvem. Existem dois produtos:

- **Docker Desktop**, para macOS e Windows: um aplicativo que roda o Docker Engine dentro de uma pequena VM Linux e acrescenta uma interface. Ele é gratuito para uso pessoal, educação e pequenas empresas; empresas maiores precisam de uma assinatura paga[^desktop-license].
- **Docker Engine**, para Linux: o próprio engine, instalado nativamente, sem VM.

=== ":material-microsoft-windows: Windows"

    No Windows, o Docker executa containers Linux por meio do **WSL 2** (Windows Subsystem for Linux), um kernel Linux de verdade gerenciado pelo Windows.

    1. Instale o WSL 2 num PowerShell de administrador e reinicie:

        ```powershell
        wsl --install
        ```

    2. Instale o [Docker Desktop para Windows](https://docs.docker.com/desktop/setup/install/windows-install/){:target="_blank"} e mantenha o **backend WSL 2** (o padrão). Ele exige Windows 10 22H2 ou Windows 11 23H2 ou mais novo, e WSL 2.1.5 ou mais novo[^desktop-windows].

    Dica: clone os seus repositórios **dentro** do sistema de arquivos do WSL (ex.: `~/code` no Ubuntu), e não em `C:\`; o acesso a arquivos e os bind mounts ficam muito mais rápidos ali.

=== ":simple-apple: macOS"

    Instale o [Docker Desktop para Mac](https://docs.docker.com/desktop/setup/install/mac-install/){:target="_blank"} (escolha Apple silicon ou Intel), ou com o Homebrew:

    ```bash
    brew install --cask docker-desktop
    ```

    Abra o Docker Desktop uma vez, para que ele inicie o engine.

=== ":simple-linux: Linux"

    Instale o **Docker Engine** seguindo a página da sua distribuição: [Install Docker Engine](https://docs.docker.com/engine/install/){:target="_blank"}. Depois, para rodar `docker` sem `sudo`, adicione o seu usuário ao grupo `docker` e abra uma nova sessão[^postinstall]:

    ```bash
    sudo usermod -aG docker $USER
    newgrp docker
    ```

    O grupo `docker` concede privilégios equivalentes aos de root: faça isso só na sua própria máquina.

## Java { #java }

Java é a linguagem dos microsserviços da disciplina. Você precisa de um **JDK** (Java Development Kit: o compilador `javac` mais o runtime), e não só de um JRE.

Use uma versão de **suporte de longo prazo** (LTS, Long-Term Support)[^lts]: o **JDK 25** (setembro de 2025) é a LTS atual, e o JDK 21 (setembro de 2023), a anterior, ainda serve para os laboratórios que o fixam. As versões entre duas LTS, como o JDK 27 (setembro de 2026), só recebem atualizações até a versão seguinte, seis meses depois[^jdk-releases].

=== ":material-microsoft-windows: Windows"

    Baixe o instalador `.msi` do JDK 25 **Eclipse Temurin** em [adoptium.net](https://adoptium.net/temurin/releases/){:target="_blank"}. Na tela *Custom Setup*, mantenha **Add to PATH** e ative também a opção que define o **`JAVA_HOME`**, que vem desligada por padrão[^temurin-windows].

    Com um `.zip`, descompacte-o, defina a variável de ambiente `JAVA_HOME` com a pasta do JDK e adicione `%JAVA_HOME%\bin` ao seu `PATH`.

=== ":simple-apple: macOS"

    Instale o JDK 25 com o Homebrew e crie o link onde o macOS procura os JDKs:

    ```bash
    brew install openjdk@25
    sudo ln -sfn $(brew --prefix)/opt/openjdk@25/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk-25.jdk
    ```

    (Um simples `brew install openjdk` instala a versão mais nova, que não é necessariamente uma LTS.)

=== ":simple-linux: Linux"

    Instale o JDK com o seu gerenciador de pacotes; no Ubuntu 22.04 ou mais novo:

    ```bash
    sudo apt update
    sudo apt install openjdk-25-jdk
    ```

??? tip "Vários JDKs lado a lado: SDKMAN! (macOS, Linux, WSL)"
    O [SDKMAN!](https://sdkman.io/){:target="_blank"} instala e alterna entre versões do JDK (e do Maven) por usuário, sem `sudo`:

    ```bash
    curl -s "https://get.sdkman.io" | bash
    # open a new terminal, then:
    sdk list java                   # available versions and their identifiers
    sdk install java <identifier>   # e.g. the newest 25.x line ending in -tem (Temurin)
    sdk install maven
    ```

    `sdk use java <identificador>` troca a versão no terminal atual; `sdk default java <identificador>` muda o padrão. Ele também define o `JAVA_HOME` para você.

## Maven { #maven }

O Maven é a ferramenta de build dos projetos Java: ele lê o `pom.xml`, baixa as dependências, compila, roda os testes e empacota o jar. Use o Maven 3.9 ou mais novo.

=== ":material-microsoft-windows: Windows"

    Baixe o `.zip` binário em [maven.apache.org](https://maven.apache.org/download.cgi){:target="_blank"} e descompacte-o, por exemplo, em `C:\tools\maven`.

    Adicione a pasta `bin` dele ao seu `PATH`. O Maven encontra o Java pelo `JAVA_HOME`, então defina-o antes (veja [Java](#java)).

=== ":simple-apple: macOS"

    Instale o Maven com o Homebrew usando o comando:

    ```bash
    brew install maven
    ```

=== ":simple-linux: Linux"

    Instale o Maven com o seu gerenciador de pacotes, por exemplo, em sistemas baseados em Debian:

    ```bash
    sudo apt update
    sudo apt install maven
    ```

!!! info "O Maven Wrapper"
    Muitos projetos (todos os gerados pelo Spring Initializr) trazem um **Maven Wrapper**: `./mvnw` (ou `mvnw.cmd` no Windows) baixa a versão do Maven que o projeto espera e a executa. Com um wrapper, `./mvnw package` funciona mesmo sem um Maven global, e todos fazem o build com a mesma versão.

## Python com uv { #uv }

Os laboratórios finais usam scripts Python (geradores de carga, ferramentas de dados). A disciplina gerencia o Python com o **[uv](https://docs.astral.sh/uv/){:target="_blank"}**, nunca com `pip`: o uv instala a versão certa do Python, cria o ambiente virtual e instala exatamente as versões fixadas no `uv.lock`.

=== ":material-microsoft-windows: Windows"

    ```powershell
    powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
    ```

=== ":simple-apple: macOS"

    ```bash
    brew install uv
    ```

=== ":simple-linux: Linux"

    ```bash
    curl -LsSf https://astral.sh/uv/install.sh | sh
    ```

Num projeto com um `pyproject.toml`, `uv sync` prepara tudo e `uv run <comando>` executa dentro do ambiente, sem passo de ativação.

## Verifique o seu ambiente { #check }

Abra um terminal **novo** (para que ele enxergue o `PATH` atualizado) e rode cada comando. Os números de versão vão variar; o que importa é o formato da resposta.

```bash
git --version
docker run --rm hello-world
java -version
mvn -v
uv --version
```

Você deve ver algo como:

```text
git version 2.5x.x

Hello from Docker!
This message shows that your installation appears to be working correctly.
(...)

openjdk version "25.0.x" 2025-xx-xx LTS
OpenJDK Runtime Environment Temurin-25.0.x (...)

Apache Maven 3.9.x (...)
Java version: 25.0.x, vendor: Eclipse Adoptium, runtime: (...)

uv 0.x.y (...)
```

Confira se o `mvn -v` informa a **mesma versão do Java** que o `java -version`: o Maven usa o `JAVA_HOME`, que pode apontar para um JDK diferente do que está no seu `PATH`.

??? warning "Solução de problemas"
    - **`failed to connect to the docker API … check if the daemon is running`** (ou `Cannot connect to the Docker daemon`): o Docker Desktop não está aberto (abra-o) ou, no Linux, o serviço está parado (`sudo systemctl start docker`).
    - **`permission denied … /var/run/docker.sock`** (Linux): o seu usuário ainda não está no grupo `docker`, ou a sessão é anterior a isso; saia e entre de novo.
    - **`The JAVA_HOME environment variable is not defined correctly`** (do `mvn`): defina o `JAVA_HOME` com a pasta do JDK — a pasta que contém `bin/`, não o próprio `bin/`.
    - **`java -version` mostra uma versão antiga**: um JDK mais antigo vem antes no seu `PATH`; corrija a ordem ou troque de versão com o SDKMAN!.
    - **Comando não encontrado logo depois de instalar**: abra um terminal novo; o antigo ainda tem o `PATH` antigo.

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - As ferramentas da disciplina seguem um caminho: **código → Git → build com Maven → imagem Docker → container**.
    - No Windows, o Docker roda pelo **WSL 2**; no macOS, pelo **Docker Desktop**; no Linux, o **Docker Engine** roda nativamente.
    - Instale um **JDK** de versão **LTS**: o JDK 25 (ou o 21 nos laboratórios que o fixam). O **SDKMAN!** ajuda quando você precisa de vários.
    - Prefira o **Maven Wrapper** do projeto (`./mvnw`) quando houver; garanta que `mvn -v` e `java -version` concordem.
    - Na disciplina, o Python roda pelo **uv**, nunca pelo `pip`.
    - Rode os comandos da **verificação** num terminal novo antes do primeiro laboratório.

[^desktop-license]: [Docker Desktop license agreement](https://docs.docker.com/subscription/desktop-license/){:target="_blank"}: gratuito para uso pessoal, educação, projetos open source não comerciais e pequenas empresas (menos de 250 funcionários e menos de US$ 10 milhões de receita anual).
[^desktop-windows]: [Install Docker Desktop on Windows](https://docs.docker.com/desktop/setup/install/windows-install/){:target="_blank"} e [Install WSL](https://learn.microsoft.com/pt-br/windows/wsl/install){:target="_blank"}.
[^postinstall]: [Linux post-installation steps for Docker Engine](https://docs.docker.com/engine/install/linux-postinstall/){:target="_blank"}.
[^lts]: [Suporte de longo prazo](https://pt.wikipedia.org/wiki/Suporte_de_longo_prazo){:target="_blank"}, Wikipédia.
[^jdk-releases]: [Oracle Java SE Support Roadmap](https://www.oracle.com/java/technologies/java-se-support-roadmap.html){:target="_blank"}; datas de lançamento resumidas em [endoflife.date](https://endoflife.date/oracle-jdk){:target="_blank"}.
[^temurin-windows]: [Eclipse Temurin: installation on Windows](https://adoptium.net/installation/windows){:target="_blank"}.
