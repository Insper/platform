
The project is the opportunity to put into practice the knowledge acquired during the course. It must be developed in a group of at most 3 people - ideally 2 people - and must be delivered at the end of the course. The project must be developed using the technologies and tools presented during the course, including AWS, EKS, CI/CD, load testing and cost analysis.

The project is a web application that allows users to buy and sell products. 
To that end, each member of the group is expected to implement at least one microservice, among the following:

- **Product API**: responsible for managing the products available for purchase, including information such as name, description, price and stock.
- **Order API**: responsible for managing customer orders, including information such as products purchased, quantity, total price and order status.
- **Exchange API**: responsible for managing the exchange rates between different currencies, allowing users to carry out transactions in different currencies.

In the end, the main project must incorporate the individual implementations on GitHub, as submodules. The whole project must be integrated and working, that is, the microservices must communicate with each other and the application must be available for access.

```python exec="1" html="1"
--8<-- "docs/2026.2/exercises/project/grade.py"
```

| Tasks | Description | Weight |
|-|-|-:|
| Gateway | API Gateway | 5% |
| Auth | Authentication & Authorization | 5% |
| Account | Account Management | 5% |
| Exchange | Currency Exchange | 5% |
| Bottlenecks | Bottlenecks | 20% |
| | | |
| [AWS](aws/index.md) | Cloud Setup | 5% |
| [EKS](eks/index.md) | Orchestration | 10% |
| Jenkins or GitHub Actions | CI/CD | 10% |
| [Load Testing](load-testing/index.md) | Stress Testing | 15% |
| | | |
| [PaaS & Costs & SLA](costs/index.md) | Cost Analysis | 10% |
| MKDocs | Documentation (use AI) | 10% |

!!! warning "Delivery"

    - Group work must be documented on GitHub. A template is available to help with the documentation: [delivery template](https://hsandmann.github.io/documentation.template/){target="_blank"}. You may use AI to help with the documentation, but review the generated content to make sure it is correct and complete.

!!! danger "Use of AI for implementation"

    The use of AI to implement the project is partially allowed. The project must be implemented by the group members, using the knowledge acquired during the course. The use of AI for implementation must be limited to specific tasks, such as generating *boilerplate* code, suggesting improvements and fixing errors. The use of AI for implementation must be documented in the project delivery, including which parts of the project were implemented with the help of AI and which parts were implemented by the group members.

    All group members must be involved in implementing the project, even though the use of AI is allowed. The project must be a collaborative effort, in which each group member contributes to the implementation and knows every part of the project. Therefore, all members **MUST** be able to explain and defend the project, including the parts implemented with the help of AI.
