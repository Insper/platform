**Engenharia do Caos** (Chaos Engineering) é a disciplina de fazer experimentos em um sistema para ganhar confiança na sua capacidade de suportar condições turbulentas em produção[^1]. Em vez de esperar que as falhas aconteçam naturalmente, os praticantes injetam falhas controladas de propósito — e usam os resultados para encontrar e corrigir fraquezas antes que incidentes reais o façam.

> "A forma de tornar os sistemas mais confiáveis é fazê-los falhar o tempo todo." — Jesse Robbins, cofundador da Chef e um dos primeiros praticantes de Engenharia do Caos na Amazon[^2]

---

## Origem: a Netflix e o Simian Army

Em abril de 2011, uma falha da Amazon Web Services na região `us-east-1` causou uma indisponibilidade de várias horas em boa parte da internet. A Netflix, que havia migrado recentemente para a AWS, sofreu uma degradação significativa — apesar de ter investido pesadamente em um projeto tolerante a falhas.

O incidente revelou uma lacuna crítica: a Netflix havia *projetado* para a falha, mas nunca havia *testado* se esses projetos realmente funcionavam em condições reais. A resposta da equipe de engenharia foi o **Chaos Monkey**: um serviço que encerra aleatoriamente instâncias EC2 em produção durante o horário comercial, obrigando os engenheiros a construir sistemas capazes de sobreviver à perda arbitrária de instâncias.

O Chaos Monkey se tornou o primeiro membro do **Simian Army** (exército de símios) — um conjunto de ferramentas que introduziam diferentes cenários de falha:

| Ferramenta | Falha injetada |
|---|---|
| **Chaos Monkey** | Encerra instâncias EC2 aleatórias |
| **Latency Monkey** | Introduz atrasos artificiais em chamadas REST |
| **Conformity Monkey** | Desliga instâncias que violam as boas práticas |
| **Doctor Monkey** | Monitora health checks e isola instâncias não saudáveis |
| **Janitor Monkey** | Limpa recursos de nuvem não utilizados |
| **Security Monkey** | Encontra e reporta violações de políticas de segurança |
| **Chaos Gorilla** | Simula a falha de uma Availability Zone inteira da AWS |

A percepção foi transformadora: **a falha não é um caso especial a ser evitado; é o ambiente em que os sistemas de produção vivem, e a única forma de saber se o seu sistema sobrevive a ela é testá-lo lá.**

---

## Princípios da Engenharia do Caos

Os [Principles of Chaos Engineering](https://principlesofchaos.org){target="_blank"}[^1] definem a disciplina em cinco ideias centrais:

**1. Construa uma hipótese em torno do comportamento em estado estável**
: Defina como é o "normal" antes de injetar falhas — em termos de saídas mensuráveis (taxa de requisições, taxa de erros, latência). A hipótese é: *"Este sistema continuará exibindo o estado estável mesmo quando a condição X for introduzida."*

**2. Varie eventos do mundo real**
: Simule eventos que realmente acontecem: queda de servidores, partição de rede, disco cheio, desvio de relógio, timeout de dependências, pico de tráfego. Falhas sintéticas ou artificiais que nunca ocorrem na prática produzem uma confiança enganosa.

**3. Execute os experimentos em produção**
: Ambientes de staging não reproduzem fielmente a carga de produção, a distribuição dos dados nem o comportamento das dependências. Fraquezas visíveis apenas em condições de produção ficam invisíveis em staging. Comece com um raio de impacto pequeno e amplie à medida que a confiança cresce.

**4. Automatize os experimentos para rodarem continuamente**
: Um experimento único produz um resultado único. Os sistemas mudam constantemente; novos deploys podem reintroduzir fraquezas. Experimentos de caos contínuos rodam automaticamente (muitas vezes de forma agendada), de modo que as regressões sejam detectadas imediatamente.

**5. Minimize o raio de impacto**
: Controle com cuidado o escopo de cada experimento. Afete o número mínimo de usuários necessário para validar a hipótese. Amplie o escopo apenas depois que experimentos menores não produzirem impacto observável.

---

## O ciclo de vida de um experimento

``` mermaid
flowchart LR
    H["1. Formular hipótese\nDefinir o estado estável\ne o comportamento esperado"]
    D["2. Projetar\nEscolher o tipo de falha\ne o raio de impacto"]
    I["3. Injetar\nIntroduzir a\nfalha controlada"]
    O["4. Observar\nMedir os SLIs\ne o comportamento do sistema"]
    A["5. Analisar\nComparar o comportamento real\ncom o da hipótese"]
    R["6. Melhorar\nCorrigir fraquezas;\natualizar runbooks"]

    H --> D --> I --> O --> A --> R
    R -->|"rodar de novo\ncom escopo maior"| H
```

Um experimento de caos que **confirma a hipótese** (o sistema se comporta como esperado) aumenta a confiança naquele modo de falha. Um experimento que **refuta a hipótese** é uma descoberta: o sistema não trata essa falha corretamente, e a equipe agora sabe disso antes que um incidente real ensine.

---

## Tipos de injeção de falhas

| Categoria | Exemplos | Ferramentas |
|---|---|---|
| **Processo / instância** | Matar um container, matar um processo por OOM, encerrar uma VM | Chaos Monkey, LitmusChaos |
| **Rede** | Adicionar latência, descartar pacotes, corromper pacotes, particionar um segmento de rede | Toxiproxy, Gremlin, Chaos Mesh |
| **Recursos** | Saturar a CPU, encher o disco, esgotar a memória, encher a tabela de descritores de arquivo | Stress-ng, Gremlin |
| **Dependência** | Retornar HTTP 500, injetar timeouts, retornar respostas malformadas | Wiremock, Toxiproxy |
| **Estado** | Corromper registros do banco de dados, fazer rollback de um deploy, expirar certificados TLS | Manual, Gremlin |
| **Infraestrutura** | Derrubar uma Availability Zone, perder uma região, simular a falha de uma CDN | Chaos Gorilla, AWS Fault Injection Simulator |

---

## Controle do raio de impacto

O raio de impacto (blast radius) de um experimento de caos é o conjunto de usuários e sistemas afetados pela falha injetada. Controlá-lo é o que separa a prática de engenharia da imprudência.

``` mermaid
flowchart TD
    S1["Etapa 1\nTestes unitários / de integração\n(nenhum usuário afetado)"]
    S2["Etapa 2\nAmbiente de staging / canary\n(apenas usuários internos)"]
    S3["Etapa 3\n1% do tráfego de produção\n(pequeno grupo de usuários)"]
    S4["Etapa 4\nProdução completa\n(todo o tráfego, todas as regiões)"]

    S1 -->|a confiança aumenta| S2
    S2 -->|nenhuma descoberta| S3
    S3 -->|os SLIs se mantêm| S4
```

Controles práticos:

- **Feature flags**: habilitar a injeção de caos apenas para uma porcentagem das requisições.
- **Janelas de tempo**: rodar os experimentos apenas no horário comercial, quando a equipe está disponível para abortar.
- **Condições automáticas de aborto**: se um SLI cair abaixo de um limite, interromper o experimento automaticamente.
- **Dark reads / tráfego sombra**: rodar os experimentos contra uma cópia dos dados de produção, e não no caminho principal.

---

## GameDay

Um **GameDay** é um exercício de caos planejado, envolvendo toda a equipe, em que os engenheiros introduzem falhas deliberadamente e observam se o sistema e a equipe respondem corretamente. Diferentemente dos experimentos de caos contínuos e automatizados, os GameDays são eventos colaborativos focados tanto no processo quanto na tecnologia.

Um GameDay típico:

1. **Briefing**: o cenário é descrito para a equipe (por exemplo, *"O banco de dados primário falha às 10h00"*). Alternativamente, o cenário é mantido em segredo (um *GameDay surpresa*) para testar uma resposta a incidentes realista.
2. **Execução**: a falha é injetada. Os engenheiros monitoram os dashboards, executam os procedimentos de resposta a incidentes e se comunicam como fariam em um incidente real.
3. **Observação**: a equipe registra quanto tempo leva a detecção, quanto tempo leva a recuperação e quais runbooks foram eficazes.
4. **Debriefing**: um post-mortem sem culpados identifica o que deu certo, o que falhou e quais melhorias fazer no sistema e nos runbooks.

!!! tip "Uma cultura sem culpados é pré-requisito"
    GameDays só funcionam se os engenheiros se sentirem seguros para expor problemas. Se as descobertas levam a culpa ou punição, a equipe vai evitar relatar com honestidade — e as fraquezas continuam escondidas. O resultado de um GameDay é uma lista de melhorias, não uma lista de culpados.

---

## Ferramentas

| Ferramenta | Mantida por | Pontos fortes |
|---|---|---|
| [Chaos Monkey](https://github.com/Netflix/chaosmonkey){target="_blank"} | Netflix | Encerramento de instâncias; a original |
| [Gremlin](https://www.gremlin.com){target="_blank"} | Gremlin Inc. | SaaS; ampla biblioteca de falhas; operada por interface gráfica |
| [LitmusChaos](https://litmuschaos.io){target="_blank"} | CNCF | Nativa do Kubernetes; compatível com GitOps |
| [Chaos Mesh](https://chaos-mesh.org){target="_blank"} | CNCF | Nativa do Kubernetes; ampla biblioteca de falhas |
| [Toxiproxy](https://github.com/Shopify/toxiproxy){target="_blank"} | Shopify | Proxy TCP; adiciona latência/descarta pacotes; ideal para testes de integração |
| [AWS FIS](https://aws.amazon.com/fis/){target="_blank"} | Amazon | Integração nativa com a AWS; controlada por IAM; condições de aborto seguras |

---

## Pré-requisito: observabilidade primeiro

Engenharia do caos sem observabilidade é perigosa e improdutiva. Antes de rodar qualquer experimento, a equipe precisa ser capaz de:

1. **Medir o estado estável**: dashboards de SLI devem existir e mostrar os valores de referência.
2. **Detectar desvios**: os alertas devem disparar poucos segundos após a queda de um SLI.
3. **Atribuir causalidade**: o rastreamento distribuído deve permitir à equipe identificar qual componente introduziu a latência ou os erros.
4. **Abortar com segurança**: um kill switch automatizado deve ser capaz de interromper o experimento imediatamente se ele ultrapassar o raio de impacto definido.

> **Comece pela observabilidade. Depois, adicione os padrões de resiliência. Por fim, rode experimentos de caos para validar que os padrões realmente funcionam.**

---

[^1]: [Principles of Chaos Engineering](https://principlesofchaos.org){target="_blank"}. principlesofchaos.org.
[^2]: BASIRI, A. et al. [Chaos Engineering](https://dl.acm.org/doi/10.1145/2842766.2899390){target="_blank"}. ACM Queue, 2016.
[^3]: ROSENTHAL, C.; JONES, N. *Chaos Engineering: System Resiliency in Practice*. O'Reilly, 2020.
[^4]: CASEY, J. [Resilience Engineering: Learning to Embrace Failure](https://www.infoq.com/presentations/resilience-failure-netflix/){target="_blank"}. Netflix Tech Blog, 2012.
