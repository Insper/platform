
O projeto é a oportunidade de colocar em prática os conhecimentos adquiridos durante o curso. Ele deve ser desenvolvido em grupo, com no máximo 3 pessoas - idealmente 2 pessoas, e deve ser entregue ao final do curso. O projeto deve ser desenvolvido utilizando as tecnologias e ferramentas apresentadas durante o curso, incluindo AWS, EKS, CI/CD, testes de carga e análise de custos.

O projeto é uma aplicação web que permite aos usuários comprar e vender produtos. 
Para isso é esperado que cada membro do grupo implemente ao menos um microserviço, dentre os seguintes:

- **Product API**: responsável por gerenciar os produtos disponíveis para compra, incluindo informações como nome, descrição, preço e estoque.
- **Order API**: responsável por gerenciar os pedidos dos clientes, incluindo informações como produtos comprados, quantidade, preço total e status do pedido.
- **Exchange API**: responsável por gerenciar as taxas de câmbio entre diferentes moedas, permitindo que os usuários realizem transações em diferentes moedas.

Ao final, o projeto principal deve incorporar no GitHub as implementações individuais, como submodules. O projeto inteiro deve ser integrado e estar funcional, ou seja, os microserviços devem estar comunicando entre si e a aplicação deve estar disponível para acesso.

| Tasks | Description | Weight |
|-|-|-:|
| Gateway | API Gateway | 5% |
| Auth | Authentication & Authorization | 5% |
| Account | Account Management | 5% |
| Exchange | Currency Exchange | 5% |
| Bottlenecks | Bottlenecks | 20% |
| | | |
| AWS | Cloud Setup | 5% |
| EKS | Orchestration | 10% |
| Jenkins or GitHub Actions | CI/CD | 10% |
| Testes | Stress Testing | 15% |
| | | |
| PaaS & Costs & SLA | Cost Analysis | 10% |
| MKDocs | Documentation (use IA) | 10% |

!!! warn "Entrega"

    - Trabalho em grupo deve ser documentado no GitHub. Um template está disponível para auxiliar na documentação: [template de entrega](https://hsandmann.github.io/documentation.template/){target="_blank"}. Pode utilizar IA para auxiliar na documentação, mas revise o conteúdo gerado para garantir que esteja correto e completo.

!!! danger "Uso de IA para implementação"

    O uso de IA para implementação do projeto é permitido parcialmente. O projeto deve ser implementado pelos membros do grupo, utilizando os conhecimentos adquiridos durante o curso. O uso de IA para implementação deve ser limitado a tarefas específicas, como geração de código *boilerplate*, sugestões de melhorias e correção de erros. O uso de IA para implementação deve ser documentado na entrega do projeto, incluindo quais partes do projeto foram implementadas com o auxílio de IA e quais partes foram implementadas pelos membros do grupo.

    Todos os membros do grupo devem estar envolvidos na implementação do projeto, mesmo que o uso de IA seja permitido. O projeto deve ser um esforço colaborativo, onde cada membro do grupo contribui para a implementação do projeto e tem conhecimento sobre todas as partes do projeto. Assim, todos os membros **DEVEM** ser capazes de explicar e defender o projeto, incluindo as partes implementadas com o auxílio de IA.
