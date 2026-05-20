![Class 2025.1](2025.1.jpg){ .rounded-corners }

## Instructor

:fontawesome-regular-address-book: Prof. [Humberto Sandmann](https://hsandmann.github.io){target='_blank'}

:fontawesome-regular-envelope: [humbertors@insper.edu.br](mailto:humbertors@insper.edu.br){target='_blank'}

## Students

<iframe src="https://docs.google.com/spreadsheets/d/e/2PACX-1vSBrh2n-7jhuIIntmYyeaxwQBOWj4biWko_6bpci6XpZxVGDFJ-g43ehPepqxKbNjxz0fqr6ndWf1wI/pubhtml?gid=1397413588&amp;single=true&amp;widget=false&amp;headers=false" width="100%" height="720px"></iframe>

## Meetings

| Evento | Dia | Início | Término |
|-|:-:|-:|-:|
| Aula | Qua. | 13h30 | 15h30 |
| Aula | Sex. | 13h30 | 15h30 |
| Atendimento | Qua. | 09h30 | 11h00 |


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
    \text{Individual} = \text{Tarefas} \times 0.7 + \text{Prova Intermediária} \times 0.3
    $$ -->

    | Tarefa | Descrição | Peso |
    |-|-|-:|
    | Checkpoint 1 | CRUD Microservice | 10% |
    | Checkpoint 2 | Gateway | 15% |
    | Checkpoint 3 | Security | 15% |
    | Checkpoint 4 | DevOps | 15% |
    | Checkpoint 5 | Orchestration | 15% |
    | Bootnecks | InMemory Database<br>Message Queues<br>Observability<br>Code quality<br>OAuth2<br>Payments (sandboxes) | 20% |
    | Documentation | README with MkDocs | 10% |

    !!! danger "Entrega"
        - A entrega de um checkpoint implica, **OBRIGATORIAMENTE**, na entrega do checkpoint anterior;
        - Trabalho em grupo deve ser documentado no GitHub.

=== "Team"

    | Tarefas | Descrição | Peso |
    |-|-|-:|
    | AWS | Configurar AWS | 5% |
    | EKS | Disponibilizar a aplicação | 15% |
    | Testes | Testes de carga | 20% |
    | CI/CD | Jenkins | 10% |
    | Custos | Análise de custos | 15% |
    | PaaS | Plano de uso da plataforma | 15% |
    | Apresentação | Storytelling | 20% |


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
