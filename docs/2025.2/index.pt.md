
![Turma 2025.2](2025.2.jpg){ .rounded-corners }

## Professores

<div class="grid cards" markdown>

-   :material-account-tie:{ .lg .middle } **Professor**

    ---

    **Humberto Sandmann**

    [:material-web:](https://hsandmann.github.io/){:target="_blank"}
    [:simple-github:](https://github.com/hsandmann){:target="_blank"}
    [:material-linkedin:](https://www.linkedin.com/in/hsandmann/){:target="_blank"}

-   :material-school:{ .lg .middle } **Monitora**

    ---

    **Giúlia Gomes Vallente**

    [:simple-github:](https://github.com/giuvallente){:target="_blank"}
    [:material-linkedin:](https://www.linkedin.com/in/giulia-gomes-vallente-1b06ba302/){:target="_blank"}

</div>

## Estudantes


!!! danger "Template"
        
    Template para a entrega do projeto: [https://hsandmann.github.io/documentation.template/](https://hsandmann.github.io/documentation.template/){target="_blank"}.

<div class="grid cards" markdown>

-   !!! warning "Individual"

        Prazo para o cadastro: ==**24 de setembro de 2025**==.

        :material-account: Cadastro individual.

        Formulário de cadastro individual dos estudantes: [https://forms.gle/mG6riaBW99vHxRpc7](https://forms.gle/mG6riaBW99vHxRpc7){target="_blank"}.

-   !!! warning "Grupo"

        Prazo para o cadastro: ==**24 de setembro de 2025**==.

        :material-account-group: Equipes de 2 a 3 integrantes.

        Formulário de cadastro dos grupos: [https://forms.gle/B2QuGVsacetXfkeg7](https://forms.gle/B2QuGVsacetXfkeg7){target="_blank"}.

        Isto é ==OBRIGATÓRIO== para organizar as equipes e as contas da AWS.

</div>

<iframe src="https://docs.google.com/spreadsheets/d/e/2PACX-1vSqrV3biuxQAPpWqWXcOFpH3Aq5png2oP-dd-QNmU6njaTxispZ9CsOilHPZZcovL9dxTdrPLk3h7Uv/pubhtml?gid=1397413588&amp;single=false&amp;widget=false&amp;headers=false" width="100%" height="460px"></iframe>

## Encontros

| :octicons-location-24: | :fontawesome-regular-calendar: | :fontawesome-regular-clock: |
|-|:-:|:-:|
| Aula | Qua. | 12h00 :fontawesome-solid-arrow-right-long: 14h00 |
| Atendimento | Sex. | 09h40 :fontawesome-solid-arrow-right-long: 11h10 |
| Aula | Sex. | 12h00 :fontawesome-solid-arrow-right-long: 14h00 |


## Avaliação


```python exec="1" html="1"
--8<-- "docs/2025.2/grade.py"
```


=== ":material-target: Final"

    $$
    \text{Nota Final} = \left\{\begin{array}{lll}
        \text{Individual} \geq 5 \bigwedge \text{Equipe} \geq 5 &
        \implies &
        \displaystyle \frac{ \text{Individual} + \text{Equipe} } {2}
        \\
        \\
        \text{Caso contrário} &
        \implies &
        \min\left(\text{Individual}, \text{Equipe}\right)
        \end{array}\right.
    $$

=== ":octicons-person-24: Individual"

    <!-- $$
    \text{Individual} = \text{Tarefas} \times 0.7 + \text{Prova Intermediária} \times 0.3
    $$ -->

    | Tarefa | Descrição | Peso |
    |-|-|-:|
    | Checkpoint 1 | Product | 15% |
    | Checkpoint 2 | Order | 15% |
    | Checkpoint 3 | Exchange | 10% |
    | Checkpoint 4 | DevOps | 15% |
    | Checkpoint 5 | Orquestração | 15% |
    | Gargalos | Banco de dados em memória<br>Filas de mensagens<br>Observabilidade<br>Qualidade de código<br>OAuth2<br>Pagamentos (sandboxes) | 20% |
    | Documentação | README com MkDocs | 10% |

    !!! danger "Entrega"
        - A entrega de um checkpoint implica, **OBRIGATORIAMENTE**, a entrega do checkpoint anterior;
        - Trabalho em grupo deve ser documentado no GitHub.

=== ":octicons-people-24: Equipe"

    | Tarefas | Descrição | Peso |
    |-|-|-:|
    | AWS | Configurar AWS | 5% |
    | EKS | Disponibilizar a aplicação | 15% |
    | Testes | Testes de carga | 20% |
    | CI/CD | Jenkins | 10% |
    | Custos | Análise de custos | 15% |
    | PaaS | Plano de uso da plataforma | 15% |
    | Apresentação | Storytelling e documentação | 20% |

    !!! danger "Entrega"

        - Trabalho em grupo deve ser documentado no GitHub. Um template está disponível para auxiliar na documentação: [template de entrega](https://hsandmann.github.io/documentation.template/){target="_blank"}.

## Planejamento

<iframe src="https://docs.google.com/spreadsheets/d/e/2PACX-1vTTLC6eG1IMbnD1AQ3NgswsscD2y-H5vHZqyun_nhtPWY3auFOQznEslwYBF0dD5Uck9x2k6Fmo6rKw/pubhtml?gid=1658402287&amp;single=true&amp;widget=true&amp;headers=false" width="100%" height="600px"></iframe>

## Repositórios

Principal: 
[https://github.com/repo-classes/pma.25.2](https://github.com/repo-classes/pma.25.2){target="_blank"}

| Microsserviço | Interface | Implementação |
|-|-|-|
| Account | [account](https://github.com/repo-classes/pma252.account){target="_blank"} | [account-service](https://github.com/repo-classes/pma252.account-service){target="_blank"} |
| Auth | [auth](https://github.com/repo-classes/pma252.auth){target="_blank"} | [auth-service](https://github.com/repo-classes/pma252.auth-service){target="_blank"} |
| Gateway |  | [gateway-service](https://github.com/repo-classes/pma252.gateway-service){target="_blank"} |