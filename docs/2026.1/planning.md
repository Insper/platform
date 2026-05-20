The marjority web systems have to be design and implemented to be scalable, reliable and secure. In this course, students will learn how to design and implement web applications using microservices architecture, containerization, and cloud computing. The course will cover topics such as design patterns, monitoring and traceability of applications, security (authentication and authorization), messaging, distributed data, orchestration of cloud computing, management systems, monitoring and configuration of virtualized resources, integration between development and operation (DevOps), utilization of cloud platforms for production (Cloud Computing), automation aspects of system management in cloud – DevOps, serverless computing – FaaS - function as a service, utilization of Platform as a Service for business: Infrastructure as a Service (IaaS), Platform as a Service (PaaS) and Software as a Service (SaaS), service level agreement (SLA) management and costs of project and operation of systems in cloud.

The course will be delivered in a project-based learning format, where students will work in teams to design and implement a web application using microservices architecture and cloud computing. The course will also include lectures, hands-on labs, and guest speakers from the industry.

The route to deliver a robust and scalable web application using microservices architecture and cloud computing will be as follows:

1. Introduction to microservices architecture and design patterns;
2. Building microservices with RESTful APIs;
3. Containerization with Docker;
4. Security considerations for microservices architecture;
5. Orchestration with Kubernetes;
6. Cloud computing with AWS;
7. DevOps practices for continuous integration and continuous deployment (CI/CD);
8. Monitoring and traceability of applications;
9. Messaging and distributed data management;
10. Service level agreement (SLA) management and cost analysis for cloud computing.

## [Multilayer Architecture](#multilayer-architecture)

At the initial of internet era, the most common architecture for web applications ran on a single server, where all components of the application were tightly coupled and deployed as a single unit. This architecture is known as monolithic architecture. However, as applications grew in complexity and scale, this architecture became difficult to maintain and scale.

``` mermaid
graph TD
    A[Monolithic Architecture] --> B[Presentation Layer]
    A --> C[Business Logic Layer]
    A --> D[Data Access Layer]
```

To address these challenges, the multilayer architecture was introduced, which separates the application into different layers, such as presentation, business logic, and data access layers. This architecture allows for better separation of concerns and makes it easier to maintain and scale the application.



 the monolithic architecture, where all components of the application were tightly coupled and deployed as a single unit. However, as applications grew in complexity and scale, this architecture became difficult to maintain and scale. To address these challenges, the multilayer architecture was introduced, which separates the application into different layers, such as presentation, business logic, and data access layers. This architecture allows for better separation of concerns and makes it easier to maintain and scale the application.

 ## [E-commerce Application](#e-commerce-application)

In this course, students will work on a project to design and implement an e-commerce application using microservices architecture and cloud computing. The application will consist of several microservices, such as product catalog, order management, payment processing, and user authentication. Each microservice will be developed and deployed independently, allowing for better scalability and maintainability. The application will also utilize cloud computing services, such as AWS, for hosting and managing the application.

Product Catalog Service: This microservice will be responsible for managing the product catalog, including adding, updating, and deleting products. It will also provide APIs for retrieving product information.

Order Management Service: This microservice will handle the order management functionality, including creating and managing orders, processing payments, and handling returns.

Customer Service: This microservice will manage customer information, including registration, authentication, and profile management.

Exchange Service: This microservice will handle the exchange of products' prices, including currency conversion and price updates.

Payment Processing Service: This microservice will handle payment processing, including integrating with payment gateways and managing payment transactions.



Infrastructure:

Virtual Infrastructure: This includes the virtual servers, storage devices, and networking equipment that are used to host the application.
Docker Compose
Rede e Sub-redes
IPs e Portas
Segurança e Firewall

Software Architecture: This includes the design and implementation of the microservices, including the use of design patterns, security considerations, and messaging.
Maven - package management
Design Patterns - Singleton, Factory, Observer, etc.
Security - Authentication and Authorization
JWT - JSON Web Tokens
Messaging - RabbitMQ, Kafka

CAP Theorem
Vertical e Horizontal Scaling
Load Balancing
Auto Scaling
Observability
DevOps e CI/CD
Orquestração de Contêineres
Kubernetes
AWS Elastic Kubernetes Service (EKS)
AWS Elastic Container Service (ECS)
AWS Lambda
AWS CloudFormation






