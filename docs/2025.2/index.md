
![Class 2025.2](2025.2.jpg){ .rounded-corners }

## Instructors

<div class="grid cards" markdown>

-   :material-account-tie:{ .lg .middle } **Instructor**

    ---

    **Humberto Sandmann**

    [:material-web:](https://hsandmann.github.io/){:target="_blank"}
    [:simple-github:](https://github.com/hsandmann){:target="_blank"}
    [:material-linkedin:](https://www.linkedin.com/in/hsandmann/){:target="_blank"}

-   :material-school:{ .lg .middle } **Student Assistant**

    ---

    **Giúlia Gomes Vallente**

    [:simple-github:](https://github.com/giuvallente){:target="_blank"}
    [:material-linkedin:](https://www.linkedin.com/in/giulia-gomes-vallente-1b06ba302/){:target="_blank"}

</div>

## Students


!!! danger "Template"
        
    Template to deliver the project: [https://hsandmann.github.io/documentation.template/](https://hsandmann.github.io/documentation.template/){target="_blank"}.

<div class="grid cards" markdown>

-   !!! warning "Individual"

        Deadline to register: ==**September 24, 2025**==.

        :material-account: Individual registration.

        Form to register individual students: [https://forms.gle/mG6riaBW99vHxRpc7](https://forms.gle/mG6riaBW99vHxRpc7){target="_blank"}.

-   !!! warning "Group"

        Deadline to register: ==**September 24, 2025**==.

        :material-account-group: Teams from 2 up to 3 members.

        Form to register student groups: [https://forms.gle/B2QuGVsacetXfkeg7](https://forms.gle/B2QuGVsacetXfkeg7){target="_blank"}.

        This is ==MANDATORY== to organize the teams and the AWS accounts.

</div>

<iframe src="https://docs.google.com/spreadsheets/d/e/2PACX-1vSqrV3biuxQAPpWqWXcOFpH3Aq5png2oP-dd-QNmU6njaTxispZ9CsOilHPZZcovL9dxTdrPLk3h7Uv/pubhtml?gid=1397413588&amp;single=false&amp;widget=false&amp;headers=false" width="100%" height="460px"></iframe>

## Meetings

| :octicons-location-24: | :fontawesome-regular-calendar: | :fontawesome-regular-clock: |
|-|:-:|:-:|
| Class | Wed. | 12:00 :fontawesome-solid-arrow-right-long: 14:00 |
| Office hours | Fri. | 09:40 :fontawesome-solid-arrow-right-long: 11:10 |
| Class | Fri. | 12:00 :fontawesome-solid-arrow-right-long: 14:00 |


## Grade


```python exec="1" html="1"
--8<-- "docs/2025.2/grade.py"
```


=== ":material-target: Final"

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

=== ":octicons-person-24: Individual"

    <!-- $$
    \text{Individual} = \text{Tasks} \times 0.7 + \text{Midterm Exam} \times 0.3
    $$ -->

    | Task | Description | Weight |
    |-|-|-:|
    | Checkpoint 1 | Product | 15% |
    | Checkpoint 2 | Order | 15% |
    | Checkpoint 3 | Exchange | 10% |
    | Checkpoint 4 | DevOps | 15% |
    | Checkpoint 5 | Orchestration | 15% |
    | Bottlenecks | InMemory Database<br>Message Queues<br>Observability<br>Code quality<br>OAuth2<br>Payments (sandboxes) | 20% |
    | Documentation | README with MkDocs | 10% |

    !!! danger "Delivery"
        - Delivering a checkpoint **MANDATORILY** requires delivering the previous checkpoint;
        - Group work must be documented on GitHub.

=== ":octicons-people-24: Team"

    | Tasks | Description | Weight |
    |-|-|-:|
    | AWS | Set up AWS | 5% |
    | EKS | Make the application available | 15% |
    | Tests | Load tests | 20% |
    | CI/CD | Jenkins | 10% |
    | Costs | Cost analysis | 15% |
    | PaaS | Platform usage plan | 15% |
    | Presentation | Storytelling and documentation | 20% |

    !!! danger "Delivery"

        - Group work must be documented on GitHub. A template is available to help with the documentation: [delivery template](https://hsandmann.github.io/documentation.template/){target="_blank"}.

## Planning

<iframe src="https://docs.google.com/spreadsheets/d/e/2PACX-1vTTLC6eG1IMbnD1AQ3NgswsscD2y-H5vHZqyun_nhtPWY3auFOQznEslwYBF0dD5Uck9x2k6Fmo6rKw/pubhtml?gid=1658402287&amp;single=true&amp;widget=true&amp;headers=false" width="100%" height="600px"></iframe>

## Repositories

Main: 
[https://github.com/repo-classes/pma.25.2](https://github.com/repo-classes/pma.25.2){target="_blank"}

| Microservice | Interface | Implementation |
|-|-|-|
| Account | [account](https://github.com/repo-classes/pma252.account){target="_blank"} | [account-service](https://github.com/repo-classes/pma252.account-service){target="_blank"} |
| Auth | [auth](https://github.com/repo-classes/pma252.auth){target="_blank"} | [auth-service](https://github.com/repo-classes/pma252.auth-service){target="_blank"} |
| Gateway |  | [gateway-service](https://github.com/repo-classes/pma252.gateway-service){target="_blank"} |