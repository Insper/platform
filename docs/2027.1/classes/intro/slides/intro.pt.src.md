---
marp: true
lang: pt-BR
title: O que é Design de Sistemas
description: Arquitetura de Sistemas · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Arquitetura de Sistemas · Insper</div>

# O que é Design de Sistemas

**Projetar, construir, medir e defender sistemas que aguentam carga real**

<!--
Roteiro: (1) o que é design de sistemas; (2) BoxOffice, o exemplo da disciplina; (3) a paleta de
componentes e o playground; (4) requisitos e atributos de qualidade; (5) a jornada de escala;
(6) o método da entrevista.
-->

---

## Sexta-feira, 10:00

<div class="q">

A BoxOffice abre a venda de um show de estádio: **60.000 lugares, 2 milhões de fãs** no mesmo segundo.
Às 10:00:20 o site não responde nada; às 10:03 ele volta — e **312 lugares foram vendidos duas vezes**.
Qual linha de código tinha o bug?

</div>

* Nenhuma: cada função fez exatamente o que foi escrita para fazer.
* O que falhou foi o **sistema**: quantas máquinas, onde ficam os dados, o que espera pelo quê.
* Esta disciplina trata dessa camada — e de provar, com números, que as 10:00 serão um não-evento.

<!--
Deixe a turma chutar primeiro. Recolha respostas como "o banco", "o servidor", "o código". O ponto:
a falha está nas decisões acima do código.
-->

---

## Design de sistemas

Definir os **componentes**, suas **interfaces** e os **dados** que passam por eles, para que o sistema cumpra o que deve fazer **e quão bem**.

| Nível | Pergunta típica | Unidade de design |
|---|---|---|
| **Algoritmo** | como calculo isto de forma eficiente? | função, estrutura de dados |
| **Design de software** | como organizo o código para ser fácil de mudar? | classes, módulos |
| **Design de sistemas** | como processos em execução em muitas máquinas cooperam sob carga e falha? | serviços, bancos, filas, caches, redes |

<p class="small">De <b>um processo</b> para <b>muitos processos em muitas máquinas</b>, sobre uma rede não confiável.</p>

---

## Três realidades novas

- **Carga** — 10 usuários e 10 milhões de usuários pedem arquiteturas *diferentes*, não mais do mesmo.
- **Falha parcial** — um disco enche, um nó reinicia, um provedor fica lento; o resto precisa cumprir suas promessas.
- **Trade-offs** — um cache compra latência com frescor; uma réplica compra disponibilidade com consistência; uma fila compra resiliência com imediatismo.

<div class="ok">

Não existe arquitetura certa — só arquiteturas **justificadas**. A habilidade é transformar "qual é o melhor banco?" em "qual banco serve para *estes* números e restrições?" — e então escolher, dizendo do que abriu mão.

</div>

---

## BoxOffice, o exemplo da disciplina

| Propriedade | Onde aparece |
|---|---|
| **Picos** extremos | a abertura de vendas das 10:00: 2 M de fãs, 60 mil lugares |
| Tráfego **dominado por leituras** | eventos, locais, mapas de lugares |
| **Consistência forte** | um lugar é vendido exatamente uma vez |
| **Dependências externas** | provedor de pagamento, e-mail, push |
| **Abuso** e **trabalho assíncrono** | robôs (WAF, rate limits); ingressos por e-mail, sala de espera |
| **IA** | um assistente de suporte (RAG + ferramentas) |

<p class="small">Serviços: <code>gateway</code>, <code>auth</code>, <code>catalog</code>, <code>inventory</code>, <code>order</code>, <code>payment</code>, <code>notification</code>, <code>search</code>, <code>assistant</code> — construídos nos laboratórios, no repositório da disciplina.</p>

---

<!-- _class: tight -->

## A paleta de componentes

| Categoria | Componentes | Aula |
|---|---|---|
| **Cliente** | Client, Mobile | 1 |
| **Tráfego e borda** | DNS, CDN, Load Balancer, WAF, API Gateway, Ingress | 4 |
| **Computação** | App Server, Worker, Serverless, Auth, Search, Scheduler, Notifications, Analytics | 5 |
| **Armazenamento** | SQL, NoSQL, Cache, Object Store, Data Warehouse, Vector DB | 6, 7 |
| **Mensageria** | Message Queue, Pub/Sub, Event Stream, Kafka | 8 |
| **Observabilidade** | Metrics, Logs, Tracing, Alerting, Health Check | 10 |
| **Rede** | VPC, Subnet, NAT Gateway, VPN, Service Mesh | 11 |
| **IA e agentes** | LLM Gateway, Orchestrator, Tool Registry, Memory Fabric, Safety Mesh | 13 |
| **Externo** | 3rd Party API, Payment, Email | 5 |

<p class="small">Cada componente tem uma entrada no <b>catálogo de componentes</b>: o que é, quando (não) usar, números, modos de falha, produtos reais.</p>

---

## Como a disciplina é organizada

<div class="cols">
<div>

### Teoria (15 aulas)

- **Fundamentos**: introdução, estimativas, sistemas distribuídos
- **A paleta**: borda, computação, bancos de dados, cache, mensageria
- **Produção**: confiabilidade, observabilidade, rede e segurança, cloud-native
- **Juntando tudo**: sistemas de IA, desempenho, estudos de caso

</div>
<div>

### Prática

- **Laboratórios** toda semana: a BoxOffice real (Spring Boot, PostgreSQL, Redis, Kafka, Kubernetes…), **medida** com k6
- **Exercícios**: estimativas, designs no playground, relatórios de teste de carga
- **Projeto em equipe**: documento de design → teste de carga contra um SLO → game day de caos
- Preparação para **entrevistas** o tempo todo

</div>
</div>

---

## O System Design Playground

Um simulador em que cada componente da paleta é um bloco que você solta, conecta e **coloca sob carga**.

1. **Montar** — escolha componentes, conecte-os.
2. **Configurar** — capacidades, réplicas, taxas de acerto, timeouts.
3. **Carregar** — `smoke`, `load`, `stress`, `spike`, `soak`, `breakpoint`, `chaos`.
4. **Ler** — throughput, p50/p99, taxa de erros, utilização, custo.
5. **Mudar uma coisa e rodar de novo.**

<div class="warn">

É um **modelo**, não código real — mas reproduz o que importa para o design: filas perto da saturação, falhas em cascata, custo por réplica.

</div>

---

## O que você vai ver primeiro

<div class="q">

Cenário `monolith`: um servidor de aplicação, um banco SQL. Aumente a carga. O que quebra primeiro — e o que acontece com a latência **antes** de os erros aparecerem?

</div>

* A latência fica plana… e então **explode** perto da saturação: o **joelho**.
* Os erros chegam **tarde**; a latência é o alerta precoce.
* Cenário `scale-out`: mais réplicas da aplicação ajudam — até o **banco único** saturar.
* O próximo passo é um componente *diferente* (cache, réplicas, fila), não mais do mesmo.

---

## Requisitos: o quê e quão bem

| | Funcionais | Não funcionais |
|---|---|---|
| **Descrevem** | *o que* o sistema faz | *quão bem* ele faz |
| **Exemplo** | "um fã reserva até 6 lugares por 10 min" | "reservas p99 < 300 ms com 5.000 reservas/s" |
| **Respondidos por** | APIs, modelo de dados | arquitetura |
| **Se faltarem** | sistema errado | sistema certo — para 10 usuários num dia bom |

<p class="small">Os requisitos não funcionais comandam quase toda decisão de arquitetura: a mesma funcionalidade "vender um ingresso" é uma tabela para um teatro e uma sala de espera + event stream para um estádio.</p>

---

<!-- _class: tight -->

## Oito atributos de qualidade

| Atributo | Pergunta | Meta da BoxOffice (premissa) |
|---|---|---|
| **Escalabilidade** | mais carga com mais recursos? | 2 M de fãs em 1 min de abertura |
| **Disponibilidade** | no ar quando preciso? | checkout 99,95% em 28 dias móveis |
| **Latência** | quanto o usuário espera? | catálogo p99 < 200 ms |
| **Consistência** | leitores veem a última escrita? | lugares: nunca vendidos duas vezes |
| **Durabilidade** | dado confirmado nunca se perde? | RPO = 0 para pedidos pagos |
| **Custo** | quanto custa rodar? | < R$ 0,10 por ingresso vendido |
| **Segurança** | protegido contra abuso? | nenhum dado de cartão guardado; robôs bloqueados |
| **Operabilidade** | a equipe consegue rodar e consertar? | MTTR < 30 min; deploys diários |

---

## Torne mensurável

**Cenário de atributo de qualidade**: fonte → estímulo → ambiente → artefato → resposta → **medida da resposta**.

> 2 M de fãs chegam em até 60 s depois das 10:00 e pedem reservas; a sala de espera e o `inventory` dão a todos um lugar na fila e nunca reservam um lugar duas vezes — admissão p99 < 500 ms, reserva p99 < 300 ms, **0 vendas duplicadas**.

<div class="warn">

"Rápido", "escalável", "nunca cai" não são requisitos. Acrescente um número, um percentil, um nível de carga e uma janela.

</div>

---

## Atributos puxam uns contra os outros

| Melhorar… | …normalmente custa |
|---|---|
| Consistência | latência e disponibilidade |
| Latência (cache) | frescor |
| Disponibilidade (redundância) | custo e complexidade |
| Durabilidade (replicação síncrona) | latência de escrita |
| Escalabilidade (particionamento) | simplicidade, consultas entre partições |
| Custo (menos recursos) | folga para picos |

<div class="ok">

Partes diferentes, qualidades diferentes: catálogo **com cache em tudo**, inventário **com transação em tudo**, notificações **tentam de novo até entregar**.

</div>

---

<!-- _class: tight -->

## A jornada de escala (1/2)

| Etapa | Sintoma | Acrescentar | Problema novo |
|---|---|---|---|
| 0 | — | uma caixa: app + banco | tudo falha junto |
| 1 | app e banco disputam recursos | **SQL Database** separado | salto de rede |
| 2 | um deploy ou uma queda = indisponibilidade | **Load Balancer** + réplicas sem estado + **Health Check** | o estado de sessão sai do servidor |
| 3 | CPU do banco alta, 95% leituras | **réplicas de leitura** | atraso de replicação |
| 4 | p99 do catálogo cresce com o tráfego | **Cache** (cache-aside) | invalidação, estouro |
| 5 | 1 MB de imagens por página | **CDN** + **Object Store** | invalidação na borda |

<p class="small">Regra: acrescente um componente só quando um <b>sintoma medido</b> pedir — e conheça o problema novo que ele traz.</p>

---

<!-- _class: tight -->

## A jornada de escala (2/2)

| Etapa | Sintoma | Acrescentar | Problema novo |
|---|---|---|---|
| 6 | checkout espera o e-mail; o pico da abertura | **Queue** + **Workers**; sala de espera | duplicatas, backlog |
| 7 | equipes e deploys colidem | **serviços**, **API Gateway**, **Event Stream** | falhas de rede, dados distribuídos |
| 8 | um banco grande / quente demais | **particionamento**, **Search**, **Data Warehouse** | partições quentes |
| 9 | robôs, DDoS, queda de região | **WAF**, rate limiting, **multi-região** + DNS | dados entre regiões |

<div class="warn">

**Primeiro o monólito**: a distribuição tem um custo fixo alto. Comece com um monólito modular; extraia serviços quando um sintoma justificar.

</div>

---

## O método da entrevista (45 min)

| # | Passo | Tempo |
|---|---|---|
| 1 | **Esclarecer** os requisitos — e dizer o que é difícil | 0–5 |
| 2 | **Estimar** — números que mudam decisões | 5–10 |
| 3 | **API e modelo de dados** | 10–15 |
| 4 | **Design de alto nível** — todo requisito, de ponta a ponta | 15–25 |
| 5 | **Aprofundamentos** — 1–3 partes mais difíceis, com alternativas | 25–37 |
| 6 | **Gargalos e trade-offs** | 37–42 |
| 7 | **Fechamento** | 42–45 |

<p class="small">Os entrevistadores pontuam navegação do problema, design da solução, profundidade técnica, raciocínio sobre trade-offs e comunicação.</p>

---

## Aprofundamento: nunca vender um lugar duas vezes

- Opções: lock pessimista (`SELECT … FOR UPDATE`), **update condicional**, lock distribuído.
- Escolha: uma instrução atômica na fonte única da verdade.

```sql
UPDATE seat
   SET status = 'HELD', hold_id = :holdId, version = version + 1
 WHERE event_id = :eventId
   AND seat_id IN (:seatIds)
   AND status = 'FREE';
```

<p class="small">Linhas alteradas = lugares pedidos → reserva criada; senão, rollback e resposta <code>409</code>. Reservas expiradas liberadas por um job agendado.</p>

---

## Como se comunicar

- **Pense em voz alta** — o silêncio é o pior sinal.
- **Primeiro amplo, depois fundo** — um design simples e completo vale mais que meio design perfeito.
- **Declare as premissas** — "Vou assumir 2 M de fãs por dia; me avise se estiver fora."
- **Acolha a contestação** — as perguntas do entrevistador são dicas.
- **Conduza** — anuncie as transições; confira o relógio.
- **Quantifique os trade-offs** — "+1 ms por requisição, 10× menos carga no banco".

<div class="ok">

Diga os sete passos no começo: o entrevistador vê um plano, e você ganha uma lista de verificação para quando o nervosismo bater.

</div>

---

<!-- _class: tight -->

## O mapa de conceitos da introdução

| Componente | Pergunta que responde | Conceitos-chave |
|---|---|---|
| `client` `mobile` | *quem* usa, e para quê? | atores, requisitos funcionais |
| `lb` `app` `healthcheck` | como um crash deixa de ser indisponibilidade? | réplicas stateless, escalar horizontalmente |
| `sql` | onde mora a verdade? | réplicas, atraso, consistência forte para assentos |
| `cache` `cdn` `objstore` | como parar de enviar os mesmos bytes? | taxa de acerto, TTL, arquivos versionados |
| `queue` `worker` | o que pode acontecer *depois*? e o pico? | trabalho assíncrono, sala de espera, idempotência |
| `apigw` `stream` `nosql` `search` `dwh` | muitos times, dados demais? | serviços, particionamento, armazenamentos especializados |
| `waf` `dns` | bots, ataques, queda de uma região? | rate limiting, failover multirregião |

<p class="small">Cada componente compra um <b>atributo de qualidade</b> e traz um problema novo — adicione-o só quando um sintoma medido pedir.</p>

---

## Pontos-chave

1. Design de sistemas decide **componentes, interfaces e dados** para carga e falha parcial.
2. É uma disciplina de **trade-offs**: diga o que cada componente compra e quanto custa.
3. A disciplina segue a **paleta de componentes**; o **playground** permite montar, carregar e quebrar designs.
4. Requisitos: **funcionais** (o quê) e **não funcionais** (quão bem) — mensuráveis, por parte do sistema.
5. Arquiteturas **evoluem** um sintoma medido de cada vez; **primeiro o monólito**.
6. Entrevista: **esclarecer → estimar → API e dados → alto nível → aprofundamentos → gargalos → fechamento**.
