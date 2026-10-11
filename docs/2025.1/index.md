![Class 2025.1](2025.1.jpg){ .rounded-corners }

## Instructor

<div class="grid cards" markdown>

-   :material-account-tie:{ .lg .middle } **Instructor**

    ---

    **Humberto Sandmann**

    [:material-web:](https://hsandmann.github.io/){:target="_blank"}
    [:simple-github:](https://github.com/hsandmann){:target="_blank"}
    [:material-linkedin:](https://www.linkedin.com/in/hsandmann/){:target="_blank"}
    [:fontawesome-regular-envelope:](mailto:humbertors@insper.edu.br){:target="_blank"}

</div>

## Students

<iframe src="https://docs.google.com/spreadsheets/d/e/2PACX-1vSBrh2n-7jhuIIntmYyeaxwQBOWj4biWko_6bpci6XpZxVGDFJ-g43ehPepqxKbNjxz0fqr6ndWf1wI/pubhtml?gid=1397413588&amp;single=true&amp;widget=false&amp;headers=false" width="100%" height="720px"></iframe>

## Meetings

| Event | Day | Start | End |
|-|:-:|-:|-:|
| Class | Wed. | 13:30 | 15:30 |
| Class | Fri. | 13:30 | 15:30 |
| Office hours | Wed. | 09:30 | 11:00 |


## Grade

=== "Final"

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

=== "Individual"

    <!-- $$
    \text{Individual} = \text{Tasks} \times 0.7 + \text{Midterm Exam} \times 0.3
    $$ -->

    | Task | Description | Weight |
    |-|-|-:|
    | Checkpoint 1 | CRUD Microservice | 10% |
    | Checkpoint 2 | Gateway | 15% |
    | Checkpoint 3 | Security | 15% |
    | Checkpoint 4 | DevOps | 15% |
    | Checkpoint 5 | Orchestration | 15% |
    | Bottlenecks | InMemory Database<br>Message Queues<br>Observability<br>Code quality<br>OAuth2<br>Payments (sandboxes) | 20% |
    | Documentation | README with MkDocs | 10% |

    !!! danger "Delivery"
        - Delivering a checkpoint **MANDATORILY** requires delivering the previous checkpoint;
        - Group work must be documented on GitHub.

=== "Team"

    | Tasks | Description | Weight |
    |-|-|-:|
    | AWS | Set up AWS | 5% |
    | EKS | Make the application available | 15% |
    | Tests | Load tests | 20% |
    | CI/CD | Jenkins | 10% |
    | Costs | Cost analysis | 15% |
    | PaaS | Platform usage plan | 15% |
    | Presentation | Storytelling | 20% |


## Planning

<iframe src="https://docs.google.com/spreadsheets/d/e/2PACX-1vQycwZoYTbD7CL91afM1zdJfyEPCY_mnh1HfNpVfpzDA4r6lGaE-MJF2CtsRiKubfjxyEVasa9e5o55/pubhtml?gid=1658402287&single=true&widget=true&headers=false" width="100%" height="600px"></iframe>



<!-- ## Repositories -->


<!-- !!! Dev

    | Microservice | Context | Interface | Service |
    |-|-|-|-|
    | Discovery | Infra |  | [platform.241.store.discovery](https://github.com/hsandmann/platform.241.store.discovery){target="_blank"} | 
    | Gateway | Infra | | [platform.241.store.gateway](https://github.com/hsandmann/platform.241.store.gateway){target="_blank"} |
    | Postgres | Database | | [platform.241.store.db](https://github.com/hsandmann/platform.241.store.db){target='_blank'} |
    | Account | Business | [platform.241.store.account](https://github.com/hsandmann/platform.241.store.account){target="_blank"} | [platform.241.store.account-resource](https://github.com/hsandmann/platform.241.store.account-resource){target="_blank"} |
    | Auth | Business | [platform.241.store.auth](https://github.com/hsandmann/platform.241.store.auth){target="_blank"} | [platform.241.store.auth-resource](https://github.com/hsandmann/platform.241.store.auth-resource){target="_blank"} |


!!! Ops

    | Description | Repositories | Commands |
    |--|--|--|
    | Docker Compose API | [platform.241.store.docker-api](https://github.com/hsandmann/platform.241.store.docker-api){target="_blank"} | `docker compose up --build`{.shell} <br> `docker compose down`{.shell} |
    | Jenkins Pipelines | [platform.241.store.ops](https://github.com/hsandmann/platform.241.store.ops) |  `docker compose up --build`{.shell} <br> `docker compose down`{.shell} <br> [http://localhost:9000](http://localhost:9000){target='_blank'} |
 -->
