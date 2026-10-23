
![Turma 2026.2](2026.2.jpg){ .rounded-corners }

## Encontros

| :octicons-location-24: | :fontawesome-regular-calendar: | :fontawesome-regular-clock: |
|-|:-:|:-:|
| Aula | Seg. | 07h30 :fontawesome-solid-arrow-right-long: 09h30 |
| Aula | Sex. | 12h00 :fontawesome-solid-arrow-right-long: 14h00 |
| Atendimento | Ter. | 12h00 :fontawesome-solid-arrow-right-long: 13h30 |

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

    **Ana Beatriz da Cunha**

    [:simple-github:](https://github.com/aninhaabc){:target="_blank"}
    [:material-linkedin:](https://www.linkedin.com/in/ana-beatriz-da-cunha-755676279/){:target="_blank"}

</div>

## Estudantes

<iframe src="https://docs.google.com/spreadsheets/d/e/2PACX-1vQhgjDzB7RwtjYf856ZX61y9VdGNuvVdeRoun_8DS8oxo7uaAjn4XphXw8T1UkpJYzGDNStCpuojKxq/pubhtml?gid=1349948680&amp;single=false&amp;widget=false&amp;headers=false" width="100%" height="750px"></iframe>

## Avaliação

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

```python exec="1" html="1"
--8<-- "docs/2026.2/grade.py"
```

1. **Quizzes**: a disciplina terá 3 quizzes; a menor nota é descartada e a nota final é a média das duas melhores:

    $$
    \text{Quizzes} = \frac{\text{Q}_1 + \text{Q}_2 + \text{Q}_3 - \min(\text{Q}_1, \text{Q}_2, \text{Q}_3)}{2}
    $$

1. **Microsserviço**: os estudantes terão de implementar um microsserviço. A nota é dada por conceito, com base nas `Notas da Engenharia`:

    | Conceito | Nota |
    |:-:|:-:|
    | A (+) | 9 (10) |
    | B (+) | 7 (8) |
    | C (+) | 5 (6) |
    | D | 4 |
    | I | 0 |


1. **Equipe**: a equipe deve ser composta **por 2 a 3 integrantes**. A nota da equipe será a mesma para todos os integrantes e se baseia na entrega do projeto e na documentação.

    !!! warning "Cadastro dos grupos"

        :fontawesome-regular-calendar: Prazo para o cadastro: ==**4 de setembro de 2026**==.

        :material-account-group: Equipes de 2 a 3 integrantes.

        :material-github: Crie um repositório no GitHub para compartilhar o código e a documentação do projeto.

        :material-cloud: Isto é ==OBRIGATÓRIO== para organizar as equipes e as contas da AWS.

    !!! tip "Nome do repositório"

        Escolha um nome profissional, por exemplo, `platform`, `microservices`, `cloud-native-ecommerce`.

        O repositório deve estar vinculado aos autores no GitHub (git config).


1. **Documentação**: a documentação do projeto é avaliada pela qualidade, completude e apresentação profissional. Ela deve cobrir arquitetura, decisões de design, implementação, testes e observabilidade. O objetivo é uma peça de portfólio que possa ser implantada.

    !!! warning "Requisitos da documentação"

        :fontawesome-regular-calendar: Prazo de entrega: ==**16 de novembro de 2026**==.

        :material-github: A documentação DEVE ser hospedada no GitHub Pages (pública).

        :simple-materialformkdocs: Use o tema [MkDocs Material](https://squidfunk.github.io/mkdocs-material/){target="_blank"}.

        :octicons-project-template-16: Template de entrega: [template de documentação](https://hsandmann.github.io/documentation.template/){target="_blank"}.


!!! danger "ARGUIÇÃO ORAL"

    **TODAS AS NOTAS** desta disciplina estão sujeitas a uma arguição oral para validação. Se o resultado da arguição for negativo, aquela nota específica será **ZERADA**.

## Planejamento

## Calendário

<div class="calendar-wrap" markdown>

<div class="table-fit" markdown>

| | Dom | Seg | Ter | Qua | Qui | Sex | Sáb |
|-|-|-|-|-|-|-|-|
| Ago |    | 10 |    |    |    | 14 |    |
|     |    | 17 |    |    |    | 21 |    |
|     |    | 24 |    |    |    | 28 |    |
|     |    | <span class='q1'>31</span> |    |    |    |    |    |
| Set |    |    |    |    |    | 04 |    |
|     |    |    |    |    |    | 11 |    |
|     |    | 14 |    |    |    | <span class='q1'>18</span> |    |
|     |    | 21 |    |    | <span class='mexam'>24</span> | <span class='mexam'>25</span> |    |
|     |    | <span class='mexam'>28</span> | <span class='mexam'>29</span> |  <span class='mexam'>30</span> |    |    |    |
| Out |    | 05 |    |    |    | 09 |    |
|     |    |    |    |    |    | 16 |    |
|     |    | 19 |    |    |    | 23 |    |
|     |    | <span class='q1'>26</span> |    |    |    | 30 |    |
| Nov |    |    |    |    |    | 06 |    |
|     |    | 09 |    |    |    | 13 |    |
|     |    | <span class='project'>16</span> |    |    |    |    |    |
|     |    | 23 |    |    |    | <span class='fexam'>27</span> |    |
| Dez |    | <span class='sexam'>07</span> | <span class='sexam'>08</span> | <span class='sexam'>09</span> |.  |    |    |

</div>

<div class="calendar-legend" markdown>

<div class="calendar-legend-box" markdown>

<p class="calendar-legend-title">Individual</p>

<span class='quizzes'>Quizzes</span>

<span class='mexam'>Prova intermediária</span>
<span class='fexam'>Prova final</span>
<span class='sexam'>Prova substitutiva</span>

</div>

<div class="calendar-legend-box" markdown>

<p class="calendar-legend-title">Equipe</p>

<span class='project'>Projeto</span>

</div>

</div>

</div>

## Repositórios

Principal (raiz): [https://github.com/repo-classes/pma262](https://github.com/repo-classes/pma262){:target="_blank"}

API:

| Microsserviço | Interface | Implementação |
|-|-|-|
| Account | [account](https://github.com/repo-classes/pma262-account){:target="_blank"} | [account-service](https://github.com/repo-classes/pma262-account-service){:target="_blank"} |
| Gateway |  | [gateway-service](https://github.com/repo-classes/pma262-gateway-service){:target="_blank"} |
| Auth | [auth](https://github.com/repo-classes/pma262-auth){:target="_blank"} | [auth-service](https://github.com/repo-classes/pma262-auth-service){:target="_blank"} |
