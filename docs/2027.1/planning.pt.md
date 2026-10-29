# Planejamento { #planning }

Dois encontros por semana, cerca de vinte semanas. Em geral, o **primeiro encontro** da semana é uma aula teórica (leia as páginas da aula antes ou depois; cada uma tem slides, um quiz e cenários do playground) e o **segundo encontro** é um lab prático sobre o BoxOffice. As entregas vencem no **último dia de aula da semana, às 23:59**, salvo aviso em contrário.

!!! info "Datas"

    As semanas são relativas. As datas do calendário, os dias de quiz e os dias de prova serão incluídos aqui quando o calendário acadêmico do Insper para 2027.1 for publicado.

| Semana | Encontro 1 | Encontro 2 | Entrega |
|:-:|-|-|-|
| 1 | [1. O que é Design de Sistemas](classes/intro/index.md) | [Lab 0 — Ambiente](hands-on/0/index.md) | |
| 2 | [2. Estimativas e Matemática de Desempenho](classes/estimation/index.md) | [Lab 1 — Primeiro serviço](hands-on/1/index.md) | |
| 3 | [3. Sistemas Distribuídos](classes/distributed/index.md) | [Lab 2 — Meça primeiro (k6)](hands-on/2/index.md) | [Ex. 1 Estimativas](exercises/estimation/index.md) · inscrição das equipes |
| 4 | [4. Tráfego e Borda](classes/edge/index.md) | [Lab 3 — Borda (Nginx, scale-out)](hands-on/3/index.md) | |
| 5 | [5. Computação e Serviços](classes/compute/index.md) | [Lab 4 — Gateway e identidade](hands-on/4/index.md) | [M1 Documento de design](exercises/project/design-doc/index.md) |
| 6 | [6. Bancos de Dados e Sistemas de Dados](classes/databases/index.md) | [7. Cache](classes/caching/index.md) | [Ex. 2 Relatório de teste de carga](exercises/load-test-report/index.md) |
| 7 | [Lab 5 — Cache (Redis)](hands-on/5/index.md) | [Lab 6 — Dados em escala](hands-on/6/index.md) | [M2 Caminho principal](exercises/project/milestones/index.md#m2-core-path-running) · **Quiz 1** |
| 8 | [8. Mensageria e Eventos](classes/messaging/index.md) | [Lab 7 — Assíncrono (Kafka, outbox)](hands-on/7/index.md) | [Ex. 3 Cache e banco de dados](exercises/cache-db/index.md) |
| 9 | [9. Observabilidade](classes/observability/index.md) | [10. Confiabilidade e Resiliência](classes/reliability/index.md) | [M3 Escala e cache](exercises/project/milestones/index.md#m3-scale-cache) |
| 10 | **Provas intermediárias** | | |
| 11 | [Lab 8 — Observabilidade (OTel)](hands-on/8/index.md) | [Lab 9 — Resiliência e caos](hands-on/9/index.md) | [Ex. 4 Orientado a eventos](exercises/event-driven/index.md) |
| 12 | [11. Plataformas Cloud-Native](classes/cloud-native/index.md) | [12. Redes e Segurança](classes/network-security/index.md) | [M4 Assíncrono e resiliência](exercises/project/milestones/index.md#m4-async-resilience) · **Quiz 2** |
| 13 | [Lab 10 — Kubernetes (HPA)](hands-on/10/index.md) | [Lab 11 — Entrega (CI/CD, GitOps)](hands-on/11/index.md) | |
| 14 | [13. Sistemas de IA e Agentes](classes/ai-systems/index.md) | [Lab 12 — Assistente de IA](hands-on/12/index.md) | [Ex. 5 Autoscaling no Kubernetes](exercises/kubernetes-autoscaling/index.md) · [M5 K8s + CI/CD](exercises/project/milestones/index.md#m5-kubernetes-cicd) |
| 15 | [14. Entrega Assistida por IA](classes/ai-delivery/index.md) | [Lab 13 — IA no CI/CD](hands-on/13/index.md) | [Ex. 6 Design no playground](exercises/playground-design/index.md) |
| 16 | [15. Engenharia de Desempenho](classes/performance/index.md) | [16. Estudos de Caso](classes/case-studies/index.md) — entrevistas simuladas, rodada 1 | [M6 Campanha de testes de carga](exercises/project/load-test-campaign/index.md) · **Quiz 3** |
| 17 | [Game day de caos](exercises/project/game-day/index.md) | [Entrevistas simuladas](support/interview/mock/index.md), rodada 2 · defesas dos documentos de design | [M7 Game day](exercises/project/game-day/index.md) · [Ex. 7 Documento de design](exercises/design-doc/index.md) |
| 18 | Revisões de design (estudos de caso) | Trabalho no projeto | [M8 Relatório de custos](exercises/project/cost-report/index.md) |
| 19 | [Apresentações finais](exercises/project/presentation/index.md) | Apresentações finais | M9 Apresentação |
| 20 | **Provas finais** | | |

``` diagram
flowchart LR
    F["Fundamentos<br/>semanas 1–3"] --> B["Blocos de construção<br/>semanas 4–9"]
    B --> O["Operando em escala<br/>semanas 11–13"]
    O --> A["IA<br/>semanas 14–15"]
    A --> P["Prove<br/>semanas 16–19"]
```

A ordem segue a [história da disciplina](index.md#story): cada aula parte do problema que a anterior deixou, e cada lab constrói, no BoxOffice, a resposta de uma aula que você já viu. Algumas semanas juntam duas aulas e a semana seguinte junta os dois labs correspondentes, porque os labs precisam de ambas: cache (lab 5) e dados em escala (lab 6) depois das aulas 6 e 7; observabilidade (lab 8) e resiliência (lab 9) depois das aulas 9 e 10; Kubernetes (lab 10) e entrega (lab 11) depois das aulas 11 e 12. A observabilidade vem antes da confiabilidade de propósito: não dá para melhorar o que não se vê, o SLO é definido onde é medido, e nos labs você instrumenta o BoxOffice (lab 8) antes de quebrá-lo de propósito (lab 9) — senão os experimentos de caos não têm nada para mostrar.

## Como funciona uma semana { #how-a-week-works }

1. **Antes da aula**: passe os olhos na visão geral da aula e experimente o primeiro cenário do playground da página.
2. **Na aula**: teoria com os slides, uma pergunta para "pensar primeiro", uma execução ao vivo no playground.
3. **Depois da aula**: leia as subpáginas, faça o quiz da aula e a atividade correspondente do [caderno](support/workbook/index.md).
4. **Dia de lab**: construa a peça do BoxOffice e **meça**; faça push do código para o seu repositório.
5. **Toda semana**: uma etapa do projeto (veja os [marcos](exercises/project/milestones/index.md)).
