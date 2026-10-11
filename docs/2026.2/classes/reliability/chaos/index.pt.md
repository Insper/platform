Você adicionou timeouts, um circuit breaker e um fallback à chamada do serviço de pedidos para o serviço de produtos. Eles funcionam? Os testes unitários passam, mas ninguém nunca viu o breaker abrir em produção — e a primeira vez que isso importar será durante uma indisponibilidade real, de madrugada, com clientes reais. A única forma de *saber* é causar a falha você mesmo, de propósito, enquanto está observando.

**Engenharia do Caos** (*Chaos Engineering*) é a disciplina de fazer experimentos em um sistema para ganhar confiança na sua capacidade de suportar condições turbulentas em produção[^1]. Em vez de esperar que as falhas aconteçam naturalmente, os praticantes injetam falhas controladas deliberadamente — e usam os resultados para encontrar e corrigir fraquezas antes que incidentes reais o façam.

> "The best way to avoid failure is to fail constantly." ("A melhor forma de evitar a falha é falhar constantemente.") — John Ciancutti, Netflix, 2010[^5]

A ideia é mais antiga que o nome. Na Amazon, no início dos anos 2000, Jesse Robbins (mais tarde cofundador da Opscode, a empresa por trás do Chef) conduzia exercícios de **GameDay** que causavam deliberadamente grandes falhas em sistemas de produção para expor fraquezas ocultas no software e nas equipes que o operavam[^4].

---

## Origem: a Netflix e o Simian Army

Em 2008, uma corrupção de banco de dados impediu a Netflix de enviar DVDs por três dias. A empresa decidiu sair do próprio data center e migrar para a AWS, aceitando que, na nuvem, instâncias individuais podem desaparecer a qualquer momento. Durante essa migração (por volta de 2010), os engenheiros construíram o **Chaos Monkey**: um serviço que encerra instâncias aleatoriamente em produção durante o horário comercial, obrigando todas as equipes a construir serviços que sobrevivam à perda arbitrária de instâncias[^5]. Executá-lo no horário de trabalho é proposital — os engenheiros estão em suas mesas para ver e corrigir o que quebrar.

A prática foi posta à prova de verdade em abril de 2011, quando uma grande falha da AWS na região `us-east-1` derrubou muitos sites conhecidos por horas; a Netflix continuou fazendo streaming, com alguma degradação, em grande parte porque seus serviços já eram construídos para perder instâncias. Naquele ano a Netflix descreveu todo um **Simian Army**[^6] — uma coleção de ferramentas que introduziam diferentes cenários de falha:

| Ferramenta | Falha injetada |
|---|---|
| **Chaos Monkey** | Encerra instâncias EC2 aleatórias |
| **Latency Monkey** | Introduz atrasos artificiais em chamadas REST |
| **Conformity Monkey** | Desliga instâncias que violam boas práticas |
| **Doctor Monkey** | Monitora health checks, isola instâncias não saudáveis |
| **Janitor Monkey** | Limpa recursos de nuvem não utilizados |
| **Security Monkey** | Encontra e relata violações de políticas de segurança |
| **Chaos Gorilla** | Simula a falha de uma Availability Zone inteira da AWS |

A percepção foi transformadora: **a falha não é um caso especial a ser evitado; é o ambiente em que os sistemas de produção vivem, e a única forma de saber se o seu sistema sobrevive a ela é testá-lo ali.** Em 2016, engenheiros da Netflix formalizaram a prática e lhe deram nome em um artigo da IEEE Software[^2]; os princípios abaixo vêm desse trabalho.

---

## Princípios da Engenharia do Caos

Os [Principles of Chaos Engineering](https://principlesofchaos.org){target="_blank"}[^1] definem a disciplina em torno de cinco ideias centrais:

**1. Construa uma hipótese em torno do comportamento em estado estável**
: Defina como é o "normal" antes de injetar falhas — em termos de saídas mensuráveis (taxa de requisições, taxa de erros, latência). A hipótese é: *"Este sistema continuará exibindo o estado estável mesmo quando a condição X for introduzida."*

**2. Varie eventos do mundo real**
: Simule eventos que realmente acontecem: queda de servidor, partição de rede, disco cheio, desvio de relógio, timeout de dependência, pico de tráfego. Falhas sintéticas ou artificiais que nunca ocorrem na prática produzem uma confiança enganosa.

**3. Execute os experimentos em produção**
: Ambientes de staging não reproduzem fielmente a carga, a distribuição dos dados nem o comportamento das dependências de produção. Fraquezas que só aparecem em condições de produção são invisíveis em staging. Comece com um raio de impacto pequeno e amplie à medida que a confiança cresce.

**4. Automatize os experimentos para rodarem continuamente**
: Um experimento pontual produz um resultado pontual. Os sistemas mudam o tempo todo; novos deploys podem reintroduzir fraquezas. Experimentos de caos contínuos rodam automaticamente (muitas vezes de forma agendada), de modo que regressões sejam detectadas imediatamente.

**5. Minimize o raio de impacto**
: Controle com cuidado o escopo de cada experimento. Afete o número mínimo de usuários necessário para validar a hipótese. Amplie o escopo só depois que experimentos menores não produzirem impacto observável.

---

## O ciclo de vida do experimento

Cada experimento segue o método científico[^3]: diga o que você espera, mude uma variável, meça e compare.

``` mermaid-sim
flowchart LR
    H["1. Formular hipótese\nDefinir estado estável\ne comportamento esperado"]
    D["2. Projetar\nEscolher tipo de falha\ne raio de impacto"]
    I["3. Injetar\nIntroduzir a\nfalha controlada"]
    O["4. Observar\nMedir SLIs e o\ncomportamento do sistema"]
    A["5. Analisar\nComparar o real com\no comportamento esperado"]
    R["6. Melhorar\nCorrigir fraquezas;\natualizar runbooks"]

    H --> D --> I --> O --> A --> R
    R -->|"rodar de novo\ncom escopo maior"| H
```

Um experimento de caos que **confirma a hipótese** (o sistema se comporta como esperado) gera confiança naquele modo de falha. Um experimento que **refuta a hipótese** é uma descoberta: o sistema não trata aquela falha corretamente, e a equipe agora sabe disso antes que um incidente real a ensine.

!!! example "Um experimento na loja"

    | Etapa | Conteúdo |
    |---|---|
    | **Estado estável** | `POST /orders`: disponibilidade ≥ 99,9% e latência P95 < 500 ms (do dashboard do Grafana do [Hands-on 6](../../../hands-on/6/index.md)). |
    | **Hipótese** | "Se o serviço de produtos responder em 3 s em vez de 50 ms, o circuit breaker do serviço de pedidos abre em até 30 s, os pedidos falham rápido com um `503` claro e `GET /orders` mantém sua latência normal." |
    | **Injeção** | Colocar o Toxiproxy entre order e product e adicionar um toxic de `latency` de 3 s — primeiro no ambiente Docker Compose, depois em uma réplica. |
    | **Raio de impacto** | Um ambiente, 10 minutos, abortar se a disponibilidade de `GET /orders` cair abaixo de 99%. |
    | **Observar** | `resilience4j_circuitbreaker_state`, taxa de erros e P95 por rota, threads ocupadas do serviço de pedidos, traces no Jaeger. |
    | **Descobertas possíveis** | O read timeout do Feign nunca foi configurado, então o breaker só contabiliza as chamadas depois de 60 s; ou o retry multiplica as chamadas e o breaker abre tarde demais. |

    Os dois resultados são úteis: uma hipótese confirmada é evidência de que os padrões funcionam; uma refutada é um bug encontrado nos seus termos.

---

## Tipos de injeção de falhas

| Categoria | Exemplos | Ferramentas |
|---|---|---|
| **Processo / instância** | Matar container, matar processo por OOM, encerrar VM | Chaos Monkey, LitmusChaos |
| **Rede** | Adicionar latência, descartar pacotes, corromper pacotes, particionar um segmento de rede | Toxiproxy, Gremlin, Chaos Mesh |
| **Recursos** | Saturar CPU, encher o disco, esgotar a memória, encher a tabela de descritores de arquivo | Stress-ng, Gremlin |
| **Dependência** | Retornar HTTP 500, injetar timeouts, retornar respostas malformadas | Wiremock, Toxiproxy |
| **Estado** | Corromper registros do banco, fazer rollback de um deploy, expirar certificados TLS | Manual, Gremlin |
| **Infraestrutura** | Encerrar uma Availability Zone, perder uma região, simular falha de CDN | Chaos Gorilla, AWS Fault Injection Simulator |

---

## Controle do raio de impacto

O raio de impacto de um experimento de caos é o conjunto de usuários e sistemas afetados pela falha injetada. Controlá-lo é o que separa a prática de engenharia da imprudência.

``` mermaid-sim
flowchart TD
    S1["Estágio 1\nTestes unitários / de integração\n(nenhum usuário afetado)"]
    S2["Estágio 2\nAmbiente de staging / canário\n(só usuários internos)"]
    S3["Estágio 3\n1% do tráfego de produção\n(pequeno grupo de usuários)"]
    S4["Estágio 4\nProdução completa\n(todo o tráfego, todas as regiões)"]

    S1 -->|confiança aumenta| S2
    S2 -->|sem descobertas| S3
    S3 -->|SLIs se mantêm| S4
```

Controles práticos:

- **Feature flags**: habilitar a injeção de caos só para uma porcentagem das requisições.
- **Janelas de tempo**: rodar experimentos só no horário comercial, quando a equipe está disponível para abortar.
- **Condições automáticas de aborto**: se um SLI cair abaixo de um limite, interromper o experimento automaticamente.
- **Leituras no escuro / tráfego espelhado** (*dark reads / shadow traffic*): rodar experimentos sobre uma cópia dos dados de produção, não sobre o caminho principal.

---

## GameDay

Um **GameDay** é um exercício de caos planejado, envolvendo toda a equipe, em que os engenheiros introduzem falhas deliberadamente e observam se o sistema e a equipe respondem corretamente. Diferentemente dos experimentos de caos contínuos e automatizados, GameDays são eventos colaborativos focados tanto no processo quanto na tecnologia.

Um GameDay típico:

1. **Briefing**: o cenário é descrito para a equipe (por exemplo, *"O banco de dados principal falha às 10h"*). Alternativamente, o cenário é mantido em segredo (um *GameDay surpresa*) para testar uma resposta a incidentes realista.
2. **Execução**: a falha é injetada. Os engenheiros acompanham os dashboards, executam os procedimentos de resposta a incidentes e se comunicam como fariam em um incidente real.
3. **Observação**: a equipe registra quanto tempo leva a detecção, quanto tempo leva a recuperação e quais runbooks foram eficazes.
4. **Debriefing**: um post-mortem sem culpados identifica o que funcionou bem, o que falhou e quais melhorias fazer no sistema e nos runbooks.

!!! tip "Uma cultura sem culpados é pré-requisito"
    GameDays só funcionam se os engenheiros se sentem seguros para expor problemas. Se as descobertas levam a culpa ou punição, a equipe vai evitar relatos honestos — e as fraquezas continuam ocultas. O resultado de um GameDay é uma lista de melhorias, não uma lista de culpados.

---

## Ferramentas

| Ferramenta | Mantida por | Pontos fortes |
|---|---|---|
| [Chaos Monkey](https://github.com/Netflix/chaosmonkey){target="_blank"} | Netflix | Encerramento de instâncias; a original |
| [Gremlin](https://www.gremlin.com){target="_blank"} | Gremlin Inc. | SaaS; ampla biblioteca de falhas; guiada por interface gráfica |
| [LitmusChaos](https://litmuschaos.io){target="_blank"} | CNCF | Nativa do Kubernetes; compatível com GitOps |
| [Chaos Mesh](https://chaos-mesh.org){target="_blank"} | CNCF | Nativa do Kubernetes; ampla biblioteca de falhas |
| [Toxiproxy](https://github.com/Shopify/toxiproxy){target="_blank"} | Shopify | Proxy TCP; adiciona latência/descarta pacotes; ideal para testes de integração |
| [AWS FIS](https://aws.amazon.com/fis/){target="_blank"} | Amazon | Integração nativa com a AWS; controlada por IAM; condições de aborto seguras |

---

## Pré-requisito: observabilidade primeiro

Engenharia do caos sem observabilidade é perigosa e improdutiva. Antes de rodar qualquer experimento, a equipe precisa ser capaz de:

1. **Medir o estado estável**: dashboards de SLI precisam existir e mostrar os valores de referência.
2. **Detectar desvios**: alertas precisam disparar segundos depois de um SLI cair.
3. **Atribuir causalidade**: o rastreamento distribuído precisa permitir que a equipe identifique qual componente introduziu a latência ou os erros.
4. **Abortar com segurança**: um kill switch automatizado precisa conseguir interromper o experimento imediatamente se ele ultrapassar o raio de impacto definido.

> **Comece pela observabilidade. Depois adicione os padrões de resiliência. Depois rode experimentos de caos para validar que os padrões realmente funcionam.**

!!! warning "Armadilhas comuns"

    - **Caos sem hipótese** é só quebrar coisas: se você não disse de antemão o que deveria acontecer, não consegue aprender com o que aconteceu.
    - **Começar em produção**: o princípio diz que a produção é o objetivo, não o primeiro passo. Comece em um ambiente de teste e amplie o raio de impacto só quando experimentos menores passarem.
    - **Sem botão de aborto**: todo experimento precisa de uma forma de ser interrompido em segundos.
    - **Não corrigir nada**: um experimento cujas descobertas nunca viram tickets só consumiu error budget.

---

## Conexões

- [SLI / SLO / SLA](../sli-slo-sla/index.md) — o estado estável é expresso como SLIs, e os experimentos gastam error budget.
- [Padrões de Resiliência](../patterns/index.md) — o que os experimentos de caos verificam.
- [Observabilidade](../../observability/index.md) e [Hands-on 10](../../../hands-on/10/index.md) — você precisa de métricas e traces para observar um experimento.
- [Hands-on 5](../../../hands-on/5/index.md) — apagar um pod manualmente (`kubectl delete pod`) é o experimento de caos mais simples que você pode rodar no Kubernetes.

## Pontos-chave

- Engenharia do caos é **experimentação**: uma hipótese de estado estável, uma injeção controlada, medição e análise.
- Ela nasceu do Chaos Monkey da Netflix (2010) e do Simian Army, e dos GameDays da Amazon.
- Injete falhas **do mundo real** (perda de instância, latência, erros de dependência) e mantenha o **raio de impacto** pequeno, ampliando-o passo a passo.
- Uma hipótese refutada é uma **descoberta**, não um fracasso.
- Pré-requisitos: observabilidade, padrões de resiliência, um aborto automatizado — e uma cultura sem culpados.

---

[^1]: [Principles of Chaos Engineering](https://principlesofchaos.org){target="_blank"}. principlesofchaos.org.
[^2]: BASIRI, A. et al. [Chaos Engineering](https://ieeexplore.ieee.org/document/7436642){target="_blank"}. *IEEE Software*, v. 33, n. 3, p. 35–41, 2016.
[^3]: ROSENTHAL, C.; JONES, N. *Chaos Engineering: System Resiliency in Practice*. O'Reilly, 2020.
[^4]: ROBBINS, J. et al. [Resilience Engineering: Learning to Embrace Failure](https://queue.acm.org/detail.cfm?id=2371297){target="_blank"}. *ACM Queue*, v. 10, n. 9, 2012.
[^5]: CIANCUTTI, J. [5 Lessons We've Learned Using AWS](https://techblog.netflix.com/2010/12/5-lessons-weve-learned-using-aws.html){target="_blank"}. Netflix Tech Blog, dez. 2010.
[^6]: IZRAILEVSKY, Y.; TSEITLIN, A. [The Netflix Simian Army](https://techblog.netflix.com/2011/07/netflix-simian-army.html){target="_blank"}. Netflix Tech Blog, jul. 2011.
