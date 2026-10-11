A maioria dos sistemas web precisa ser projetada e implementada para ser escalável, confiável e segura. Nesta disciplina, os estudantes vão aprender a projetar e implementar aplicações web usando arquitetura de microsserviços, containerização e computação em nuvem. A disciplina vai abordar temas como padrões de projeto, monitoramento e rastreabilidade de aplicações, segurança (autenticação e autorização), mensageria, dados distribuídos, orquestração em computação em nuvem, sistemas de gerenciamento, monitoramento e configuração de recursos virtualizados, integração entre desenvolvimento e operação (DevOps), uso de plataformas de nuvem em produção (Cloud Computing), aspectos de automação do gerenciamento de sistemas na nuvem – DevOps, computação serverless – FaaS (function as a service), uso de serviços de plataforma para negócios: Infraestrutura como Serviço (IaaS), Plataforma como Serviço (PaaS) e Software como Serviço (SaaS), gestão de acordos de nível de serviço (SLA) e custos de projeto e operação de sistemas na nuvem.

A disciplina será conduzida no formato de aprendizagem baseada em projetos, em que os estudantes vão trabalhar em equipes para projetar e implementar uma aplicação web usando arquitetura de microsserviços e computação em nuvem. A disciplina também vai incluir aulas expositivas, laboratórios hands-on e palestras de convidados do mercado.

O caminho para entregar uma aplicação web robusta e escalável usando arquitetura de microsserviços e computação em nuvem será o seguinte:

1. Introdução à arquitetura de microsserviços e aos padrões de projeto;
2. Construção de microsserviços com APIs RESTful;
3. Containerização com Docker;
4. Questões de segurança na arquitetura de microsserviços;
5. Orquestração com Kubernetes;
6. Computação em nuvem com AWS;
7. Práticas de DevOps para integração contínua e entrega contínua (CI/CD);
8. Monitoramento e rastreabilidade de aplicações;
9. Mensageria e gerenciamento de dados distribuídos;
10. Gestão de acordos de nível de serviço (SLA) e análise de custos de computação em nuvem.

## [Arquitetura multicamadas](#multilayer-architecture) { #multilayer-architecture }

No início da era da internet, a arquitetura mais comum para aplicações web rodava em um único servidor, com todos os componentes da aplicação fortemente acoplados e implantados como uma única unidade. Essa arquitetura é conhecida como arquitetura monolítica. No entanto, à medida que as aplicações cresceram em complexidade e escala, ficou difícil manter e escalar essa arquitetura.

``` mermaid
graph TD
    A[Arquitetura monolítica] --> B[Camada de apresentação]
    A --> C[Camada de lógica de negócio]
    A --> D[Camada de acesso a dados]
```

Para enfrentar esses desafios, surgiu a arquitetura multicamadas, que separa a aplicação em camadas diferentes, como as camadas de apresentação, de lógica de negócio e de acesso a dados. Essa arquitetura permite uma melhor separação de responsabilidades e facilita a manutenção e a escalabilidade da aplicação.



 a arquitetura monolítica, em que todos os componentes da aplicação eram fortemente acoplados e implantados como uma única unidade. No entanto, à medida que as aplicações cresceram em complexidade e escala, ficou difícil manter e escalar essa arquitetura. Para enfrentar esses desafios, surgiu a arquitetura multicamadas, que separa a aplicação em camadas diferentes, como as camadas de apresentação, de lógica de negócio e de acesso a dados. Essa arquitetura permite uma melhor separação de responsabilidades e facilita a manutenção e a escalabilidade da aplicação.

 ## [Aplicação de e-commerce](#e-commerce-application) { #e-commerce-application }

Nesta disciplina, os estudantes vão trabalhar em um projeto para projetar e implementar uma aplicação de e-commerce usando arquitetura de microsserviços e computação em nuvem. A aplicação será composta por vários microsserviços, como catálogo de produtos, gestão de pedidos, processamento de pagamentos e autenticação de usuários. Cada microsserviço será desenvolvido e implantado de forma independente, o que favorece a escalabilidade e a manutenibilidade. A aplicação também vai usar serviços de computação em nuvem, como a AWS, para hospedar e gerenciar a aplicação.

Serviço de catálogo de produtos: este microsserviço será responsável por gerenciar o catálogo de produtos, incluindo adicionar, atualizar e remover produtos. Ele também vai oferecer APIs para consultar informações dos produtos.

Serviço de gestão de pedidos: este microsserviço vai cuidar da gestão de pedidos, incluindo criar e gerenciar pedidos, processar pagamentos e tratar devoluções.

Serviço de clientes: este microsserviço vai gerenciar as informações dos clientes, incluindo cadastro, autenticação e gerenciamento de perfil.

Serviço de câmbio: este microsserviço vai cuidar da conversão dos preços dos produtos, incluindo conversão de moedas e atualização de preços.

Serviço de processamento de pagamentos: este microsserviço vai cuidar do processamento de pagamentos, incluindo a integração com gateways de pagamento e o gerenciamento das transações de pagamento.



Infraestrutura:

Infraestrutura virtual: inclui os servidores virtuais, os dispositivos de armazenamento e os equipamentos de rede usados para hospedar a aplicação.
Docker Compose
Redes e sub-redes
IPs e portas
Segurança e firewall

Arquitetura de software: inclui o projeto e a implementação dos microsserviços, incluindo o uso de padrões de projeto, questões de segurança e mensageria.
Maven - gerenciamento de pacotes
Padrões de projeto - Singleton, Factory, Observer etc.
Segurança - autenticação e autorização
JWT - JSON Web Tokens
Mensageria - RabbitMQ, Kafka

Teorema CAP
Escalabilidade vertical e horizontal
Balanceamento de carga
Auto Scaling
Observabilidade
DevOps e CI/CD
Orquestração de containers
Kubernetes
AWS Elastic Kubernetes Service (EKS)
AWS Elastic Container Service (ECS)
AWS Lambda
AWS CloudFormation
