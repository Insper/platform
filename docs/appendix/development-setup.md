This environment setup guide will help you configure your development environment for the course. Follow the steps below to get started.

The prerequisites for this course include:

1. **[Git](#git)**: Version control system to manage your code.
1. **[Docker](#docker)**: Containerization platform to run applications in isolated environments.
1. **[Java](#java)**: Programming language for backend development.
1. **[Maven](#maven)**: Build automation tool for Java projects.

## Git

Git is a distributed version control system that allows you to track changes in your code and collaborate with others. To install Git, follow the instructions for your operating system:

=== "Windows"

    Download and install Git from [git-scm.com](https://git-scm.com/download/win){:target="_blank"}.

=== "macOS"

    Install Git using Homebrew with the command:

    ```bash
    brew install git
    ```

=== "Linux"

    Install Git using your package manager, e.g.,

    ```bash
    sudo apt update
    sudo apt install git
    ```

    for Debian-based systems.

## Docker

Docker is a platform that allows you to develop, ship, and run applications in containers. Containers are lightweight, portable, and provide a consistent environment across different systems. To install Docker, follow the instructions for your operating system:

To install Docker Engine, see [Install Docker Engine](https://docs.docker.com/engine/install/){:target="_blank"}.

## Java

Java is a widely-used programming language for building backend applications. To install Java, follow the instructions for your operating system:

=== "Windows"

    Download and unzip the [OpenJDK](https://jdk.java.net/){:target="_blank"}.

    Preferably, use a LTS ([Long-Term Support](https://en.wikipedia.org/wiki/Long-term_support){:target="_blank"}) version like OpenJDK 21 or 25.



    After the installation, please set the `JAVA_HOME` environment variable to the JDK installation path.

    Also, add the `bin` directory of the JDK installation path to your `PATH` environment variable.

=== "macOS"

    Install Java using Homebrew with the command:

    ```bash
    brew install openjdk
    ```

=== "Linux"

    Install Java using your package manager, e.g.,

    ```bash
    sudo apt update
    sudo apt install openjdk-21
    ```

    for Debian-based systems.

## Maven

Maven is a build automation tool primarily used for Java projects. It helps manage project dependencies, build processes, and documentation. To install Maven, follow the instructions for your operating system:

=== "Windows"

    Download and unzip the [Maven binary](https://maven.apache.org/){:target="_blank"}.

    After the installation, please set the `MAVEN_HOME` environment variable to the Maven installation path.

    Also, add the `bin` directory of the Maven installation path to your `PATH` environment variable.

=== "macOS"

    Install Maven using Homebrew with the command:

    ```bash
    brew install maven
    ```

=== "Linux"

    Install Maven using your package manager, e.g.,

    ```bash
    sudo apt update
    sudo apt install maven
    ```

    for Debian-based systems.