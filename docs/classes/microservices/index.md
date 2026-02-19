**Microservices**, also known as the microservices architecture, is an architectural style that structures an application as a collection of small autonomous services, modeled around a business domain.

Key concepts of microservices include:

- **Single Responsibility**: Each microservice should have a single responsibility and should implement a single business capability.
- **Independence**: Microservices should be able to run and evolve independently of each other. They should be independently deployable and scalable.
- **Decentralization**: Microservices architecture favors decentralized governance. Teams have the freedom to choose the best technology stack that suits their service.
- **Isolation of Failures**: If a microservice fails, it should not impact the availability of other services.
- **Data Isolation**: Each microservice should have its own database to ensure that the services are loosely coupled and can evolve independently.
- **Communication**: Microservices communicate with each other through well-defined APIs and protocols, typically HTTP/REST with JSON[^4][^5] or gRPC with Protobuf.
- **Infrastructure Automation**: Due to the distributed nature of the microservices architecture, automation of infrastructure is a must. This includes automated provisioning, scaling, and deployment.
- **Observability**: With many different services, it's important to have excellent monitoring and logging to detect and diagnose problems.

## Domain Driven Design

[Domain-Driven Design (DDD)](https://en.wikipedia.org/wiki/Domain-driven_design){target="_blank"} is a software development approach that emphasizes collaboration between technical experts and domain experts. The goal is to create software that is a deep reflection of the underlying domain, which is the specific area of business or activity that the software is intended to support.

Key concepts of DDD include:

- **Ubiquitous Language**: A common language established between developers and domain experts, used to describe all aspects of the domain.
- **Bounded Context**: A boundary within which a particular model is defined and applicable.
- **Entities**: Objects that have a distinct identity that persists over time and across different representations.
- **Value Objects**: Objects that are defined by their attributes, not their identity.
- **Aggregates**: Clusters of entities and value objects that are treated as a single unit.
- **Repositories**: They provide a way to obtain references to aggregates.
- **Domain Events**: Events that domain experts care about.
- **Services**: Operations that don't naturally belong to any entity or value object.

By focusing on the domain and domain logic, DDD provides techniques to develop complex systems targeting real-world scenarios. It helps to reduce the complexity by dividing the system into manageable and interconnected parts.

## Best Practices

<figure markdown>
  ![Best practices for microservices](https://assets.bytebytego.com/diagrams/0275-micro-best-practices.png){ width="100%" }
  <figcaption><i>Source: <a href="https://bytebytego.com/guides/9-best-practices-for-developing-microservices/" target="_blank">System Design 101 - Microservice Architecture</a></i></figcaption>
</figure>




[^1]: XU, A., [System Design 101](https://github.com/ByteByteGoHq/system-design-101){target="_blank"}: A comprehensive guide to system design, covering various architectural patterns, including microservices. It provides insights into best practices, trade-offs, and real-world examples to help developers design scalable and maintainable systems.

[^2]: [Wikipedia - Domain Driven Design](https://en.wikipedia.org/wiki/Domain-driven_design){target="_blank"}: A software development approach that emphasizes collaboration between technical experts and domain experts to create software that is a deep reflection of the underlying domain. It provides techniques to develop complex systems targeting real-world scenarios by focusing on the domain and domain logic.

[^3]: [Domain-Driven Design Reference](https://domainlanguage.com/ddd/reference/){target="_blank"}: A comprehensive reference for Domain-Driven Design, covering all the key concepts and patterns in detail. It serves as a valuable resource for developers and architects looking to implement DDD in their projects.

[^4]: [RFC 7159](https://datatracker.ietf.org/doc/html/rfc4627){target="_blank"}: The application/json Media Type for JavaScript Object Notation (JSON).

[^5]: [JSON](https://www.json.org/){target="_blank"}: JSON (JavaScript Object Notation) is a lightweight data-interchange format that is easy for humans to read and write, and easy for machines to parse and generate. It is based on a subset of the JavaScript Programming Language, Standard ECMA-262 3rd Edition - December 1999. JSON is a text format that is completely language independent but uses conventions that are familiar to programmers of the C-family of languages, including C, C++, C#, Java, JavaScript, Perl, Python, and many others. These properties make JSON an ideal data-interchange language.