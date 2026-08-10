
![Class 2026.2](2026.2.jpg){ .rounded-corners }

## Meetings

| :octicons-location-24: | :fontawesome-regular-calendar: | :fontawesome-regular-clock: |
|-|:-:|:-:|
| Aula | Mon. | 07h30 :fontawesome-solid-arrow-right-long: 09h30 |
| Aula | Fri. | 12h00 :fontawesome-solid-arrow-right-long: 14h00 |
| Office hours | Tue. | 12h00 :fontawesome-solid-arrow-right-long: 13h30 |

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

    **Ana Beatriz da Cunha**

    [:simple-github:](https://github.com/aninhaabc){:target="_blank"}
    [:material-linkedin:](https://www.linkedin.com/in/ana-beatriz-da-cunha-755676279/){:target="_blank"}

</div>

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

1. **Quizzes**: the course will have 3 quizzes; the lowest is dropped and the final grade is the average of the three best:

    $$
    \text{Quizzes} = \frac{\text{Q}_1 + \text{Q}_2 + \text{Q}_3 - \min(\text{Q}_1, \text{Q}_2, \text{Q}_3)}{2}
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


!!! danger "ORAL EXAMINATION"

    **ALL GRADES** in this course are subject to an oral examination for validation. If the outcome of the oral examination is negative, that specific grade will be **ZEROED**.

## Planning

## Calendar

<div class="calendar-wrap" markdown>

<div class="table-fit" markdown>

| | Sun | Mon | Tue | Wed | Thu | Fri | Sat |
|-|-|-|-|-|-|-|-|
| Aug |    | 10 |    |    |    | 14 |    |
|     |    | 17 |    |    |    | 21 |    |
|     |    | 24 |    |    |    | 28 |    |
|     |    | 31 |    |    |    |    |    |
| Sep |    |    |    |    |    | 04 |    |
|     |    |    |    |    |    | 11 |    |
|     |    | 14 |    |    |    | 18 |    |
|     |    | 21 |    |    | <span class='calendar-mexam'>24</span> | <span class='calendar-mexam'>25</span> |    |
|     |    | <span class='calendar-mexam'>28</span> | <span class='calendar-mexam'>29</span> |  <span class='calendar-mexam'>30</span> |    |    |    |
| Oct |    | 05 |    |    |    | 09 |    |
|     |    |    |    |    |    | 16 |    |
|     |    | 19 |    |    |    | 23 |    |
|     |    | 26 |    |    |    | 30 |    |
| Nov |    |    |    |    |    | 06 |    |
|     |    | 09 |    |    |    | 13 |    |
|     |    | 16 |    |    |    |    |    |
|     |    | 23 |    |    | <span class='calendar-fexam'>26</span> | <span class='calendar-fexam'>27</span> |    |
|     |    | <span class='calendar-fexam'>30</span> |    |    |    |    |    |
| Dec |    |    | <span class='calendar-fexam'>01</span> | <span class='calendar-fexam'>02</span> |    |    |    |
|     |    | <span class='calendar-sexam'>07</span> | <span class='calendar-sexam'>08</span> | <span class='calendar-sexam'>09</span> |.  |    |    |

</div>

<div class="calendar-legend" markdown>

<div class="calendar-legend-box" markdown>

<p class="calendar-legend-title">Individual</p>

<span class='calendar-mexam'>Midterm Exam</span>
<span class='calendar-fexam'>Final Exam</span>
<span class='calendar-sexam'>Substitutive Exam</span>

</div>

<!-- <div class="calendar-legend-box" markdown>

<p class="calendar-legend-title">Team</p>

<span class='calendar-eda'>EDA</span>
<span class='calendar-classification'>Classification</span>
<span class='calendar-regression'>Regression</span>

</div> -->

</div>

</div>

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