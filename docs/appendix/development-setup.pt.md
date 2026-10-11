Este guia de configuração vai ajudar você a preparar o seu ambiente de desenvolvimento para a disciplina. Siga os passos abaixo para começar.

Os pré-requisitos da disciplina são:

1. **[Git](#git)**: sistema de controle de versão para gerenciar o seu código.
1. **[Docker](#docker)**: plataforma de containerização para executar aplicações em ambientes isolados.
1. **[Java](#java)**: linguagem de programação para o desenvolvimento backend.
1. **[Maven](#maven)**: ferramenta de gerenciamento de pacotes e automação de build para projetos Java.

## Git

Git é um sistema de controle de versão distribuído que permite acompanhar as mudanças no seu código e colaborar com outras pessoas. Para instalar o Git, siga as instruções do seu sistema operacional:

=== ":material-microsoft-windows: Windows"

    Baixe e instale o Git a partir de [git-scm.com](https://git-scm.com/download/win){:target="_blank"}.

=== ":simple-apple: macOS"

    Instale o Git com o Homebrew usando o comando:

    ```bash
    brew install git
    ```

=== ":simple-linux: Linux"

    Instale o Git com o seu gerenciador de pacotes, por exemplo,

    ```bash
    sudo apt update
    sudo apt install git
    ```

    em sistemas baseados em Debian.

## Docker

Docker é uma plataforma que permite desenvolver, distribuir e executar aplicações em containers. Containers são leves, portáteis e oferecem um ambiente consistente entre sistemas diferentes. Para instalar o Docker, siga as instruções do seu sistema operacional:

Para instalar o Docker Engine, veja [Install Docker Engine](https://docs.docker.com/engine/install/){:target="_blank"}.

## Java

Java é uma linguagem de programação amplamente usada para construir aplicações backend. Para instalar o Java, siga as instruções do seu sistema operacional:

=== ":material-microsoft-windows: Windows"

    Baixe e descompacte o [OpenJDK](https://jdk.java.net/){:target="_blank"}.

    De preferência, use uma versão LTS ([Long-Term Support](https://en.wikipedia.org/wiki/Long-term_support){:target="_blank"}), como o OpenJDK 21 ou 25.



    Após a instalação, defina a variável de ambiente `JAVA_HOME` com o caminho de instalação do JDK.

    Adicione também o diretório `bin` do caminho de instalação do JDK à sua variável de ambiente `PATH`.

=== ":simple-apple: macOS"

    Instale o Java com o Homebrew usando o comando:

    ```bash
    brew install openjdk
    ```

=== ":simple-linux: Linux"

    Instale o Java com o seu gerenciador de pacotes, por exemplo,

    ```bash
    sudo apt update
    sudo apt install openjdk-21
    ```

    em sistemas baseados em Debian.

## Maven

Maven é uma ferramenta de automação de build usada principalmente em projetos Java. Ela ajuda a gerenciar as dependências do projeto, os processos de build e a documentação. Para instalar o Maven, siga as instruções do seu sistema operacional:

=== ":material-microsoft-windows: Windows"

    Baixe e descompacte o [binário do Maven](https://maven.apache.org/){:target="_blank"}.

    Após a instalação, defina a variável de ambiente `MAVEN_HOME` com o caminho de instalação do Maven.

    Adicione também o diretório `bin` do caminho de instalação do Maven à sua variável de ambiente `PATH`.

=== ":simple-apple: macOS"

    Instale o Maven com o Homebrew usando o comando:

    ```bash
    brew install maven
    ```

=== ":simple-linux: Linux"

    Instale o Maven com o seu gerenciador de pacotes, por exemplo,

    ```bash
    sudo apt update
    sudo apt install maven
    ```

    em sistemas baseados em Debian.
