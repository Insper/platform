
## Meetings

| :octicons-location-24: | :fontawesome-regular-calendar: | :fontawesome-regular-clock: |
|-|:-:|:-:|
| Aula | Qua. | 12h00 :fontawesome-solid-arrow-right-long: 14h00 |
| Aula | Sex. | 12h00 :fontawesome-solid-arrow-right-long: 14h00 |
| Atendimento | Ter. | 12h00 :fontawesome-solid-arrow-right-long: 13h30 |


## Instructors

| [:material-web:](https://hsandmann.github.io/){:target="_blank"} [:simple-github:](https://github.com/hsandmann){:target="_blank"} [:material-linkedin:](https://www.linkedin.com/in/hsandmann/){:target="_blank"} Instructor | Humberto Sandmann |


## Students

<!-- TODO: embed student list spreadsheet here -->


## Grade

$$
\text{Final Grade} = \left\{\begin{array}{lll}
    \text{Individual} \geq 5 \bigwedge \text{Team} \geq 5 &
    \implies &
    \displaystyle \frac{ \text{Individual} + \text{Team} } {2}
    \\
    \\
    \text{Otherwise} &
    \implies &
    \min\left(\text{Individual}, \text{Team}\right)
    \end{array}\right.
$$

```python exec="1" html="1"
--8<-- "docs/2026.2/grade.py"
```

1. **Quizzes**: the course will have 4 quizzes; the lowest is dropped and the final grade is the average of the three best:

    $$
    \text{Quizzes} = \frac{\text{Q}_1 + \text{Q}_2 + \text{Q}_3 + \text{Q}_4 - \min(\text{Q}_1, \text{Q}_2, \text{Q}_3, \text{Q}_4)}{3}
    $$

1. **Microservice**: the students will have to implement a microservice. The grade is a concept grade, based on `Notas da Engenharia`:

    | Concept | Grade |
    |:-:|:-:|
    | A (+) | 9 (10) |
    | B (+) | 7 (8) |
    | C (+) | 5 (6) |
    | D | 4 |
    | I | 0 |


1. **Team**: the team have to be composed **by 2 up to 3 members**. The team grade will be the same for all members. The team grade is based on project delivery and documentation.

    !!! warning "Group Registration"

        :fontawesome-regular-calendar: Deadline to register: ==**March 6th, 2027**==.

        :material-account-group: Teams from 2 up to 3 members.

        :material-github: Create a repository on GitHub to share project code and documentation.

        :material-cloud: This is ==MANDATORY== to organise teams and AWS accounts.

    !!! tip "Repository name"

        Choose a professional name, e.g. `platform`, `microservices`, `cloud-native-ecommerce`.

        The repository must be linked to GitHub authors (git config).


1. **Documentation**: the project documentation is evaluated on quality, completeness, and professional presentation. It must cover architecture, design decisions, implementation, testing, and observability. The goal is a deployable portfolio piece.

    !!! warning "Documentation Requirements"

        :fontawesome-regular-calendar: Deadline to deliver: ==**May 28th, 2027**==.

        :material-github: Documentation MUST be hosted on GitHub Pages (public).

        :simple-materialformkdocs: Use [MkDocs Material](https://squidfunk.github.io/mkdocs-material/){target="_blank"} theme.

        :octicons-project-template-16: Delivery template: [documentation template](https://hsandmann.github.io/documentation.template/){target="_blank"}.


## Planning

<!-- TODO: embed planning spreadsheet here -->


## Repositories

Principal (root): `https://github.com/repo-classes/pma.262`

API:

| Microservice | Interface | Implementation |
|-|-|-|
| Account | account | account-service |
| Auth | auth | auth-service |
| Gateway |  | gateway-service |
| Product | product | product-service |
| Order | order | order-service |
| Exchange | exchange | exchange-service |
| Notification |  | notification-service |