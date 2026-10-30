Duas noites ruins, dois desastres muito diferentes.

Na primeira, a região de nuvem onde o BoxOffice roda sofre uma grande indisponibilidade: a rede dentro da região fica degradada por horas. Todas as réplicas de todos os serviços estão nessa região — três zonas de disponibilidade, todas afetadas. A redundância *dentro* da região não ajuda.

Na segunda, tudo está no ar. Às 22:00, um engenheiro roda um script de limpeza contra o que ele acha que é o banco de homologação. É o de produção: `DELETE FROM orders WHERE created_at < now()` — todos os pedidos somem. O standby do PostgreSQL em outra zona replica fielmente o delete em milissegundos. A redundância também não ajuda aqui; ela *espalhou* o estrago.

**Recuperação de desastres** (DR, *disaster recovery*) é o conjunto de estratégias, ferramentas e procedimentos para restaurar serviço e dados depois de eventos como esses — eventos maiores do que os padrões de resiliência da [página anterior](../patterns/index.md) absorvem. Ela começa com dois números.

---

## RPO e RTO { #rpo-rto }

**RPO — Recovery Point Objective**
: A quantidade máxima de **dados**, medida em tempo, que você aceita perder. RPO = 5 minutos significa que, depois da recuperação, no máximo os últimos 5 minutos de escritas podem faltar.

**RTO — Recovery Time Objective**
: O **tempo** máximo desde o desastre até o serviço ser restaurado. RTO = 1 hora significa que os fãs podem voltar a comprar ingressos no máximo uma hora depois da falha.

``` diagram
flowchart LR
    lb["último ponto de<br/>recuperação bom"] -->|"RPO: dados perdidos"| d(("desastre<br/>22:00"))
    d -->|"RTO: serviço fora"| r["serviço<br/>restaurado"]
```

São decisões de negócio expressas em minutos, e se traduzem em dinheiro: cada minuto de RTO durante uma abertura de vendas é venda perdida; cada minuto de RPO são pedidos (e pagamentos!) que precisam ser reconstruídos à mão ou estornados. Números menores custam mais, de forma aproximadamente exponencial.

!!! example "BoxOffice: RPO e RTO por serviço"

    | Serviço / dado | Por quê | RPO | RTO |
    |---|---|---|---|
    | `order` + livro-razão do `payment` | Dinheiro; os fãs foram cobrados | ≈ 0 para pagamentos confirmados (reconciliar com o provedor) | 15 min |
    | `inventory` (lugares, reservas) | Nada de venda duplicada depois da recuperação | ≈ segundos; reservas podem se perder, lugares vendidos não | 15 min |
    | `catalog` (eventos, locais) | Mudanças são raras e podem ser refeitas | 1 h | 1 h (servido desatualizado pela CDN enquanto isso) |
    | Índice do `search` | Reconstruído a partir do catálogo | n/a (dado derivado) | 4 h |
    | Analytics / warehouse | Não é voltado ao cliente | 24 h | 2 dias |

    Dados diferentes merecem metas diferentes. Dar a meta mais rígida a tudo é o plano mais caro possível.

??? question "Pense antes: o standby replicou o DELETE. Em qual número a redundância ajudou?"

    Em nenhum. Um standby síncrono dá RPO e RTO excelentes para falhas de **infraestrutura** (a máquina do primário morre: promova o standby, sem perder nada). Para falhas **lógicas** — um script errado, um deploy com bug gravando lixo, um ransomware cifrando linhas — o standby é uma cópia exata do estrago. Recuperar exige uma cópia dos dados **como estavam antes** do erro: um backup, com recuperação para um ponto no tempo. Replicação e backups resolvem problemas diferentes; você precisa dos dois.

---

## Backups { #backups }

Um **backup** é uma cópia dos dados, mantida de forma independente do original, a partir da qual você pode restaurar. Os tipos:

| Tipo | O que copia | Para restaurar precisa de | Trade-off |
|---|---|---|---|
| **Completo** | Tudo | Só ele | Lento e grande; feito raramente (por exemplo, semanal) |
| **Incremental** | Mudanças desde o último backup de qualquer tipo | Último completo + todos os incrementais desde então | Pequeno e rápido de fazer; mais lento de restaurar |
| **Diferencial** | Mudanças desde o último completo | Último completo + último diferencial | Meio-termo |
| **Snapshot** | Imagem de um disco ou volume num instante (copy-on-write) | O snapshot | Rápido; consistente só como um crash, a menos que o banco seja avisado |
| **Arquivamento contínuo (PITR)** | Um backup base + todo segmento do write-ahead log (WAL) | Backup base + WALs reaplicados até o instante escolhido | Restaura para **qualquer momento**, por exemplo 21:59:30 |

A **recuperação para um ponto no tempo** (PITR, *point-in-time recovery*) é o que salva a segunda noite. O PostgreSQL arquiva continuamente seu WAL[^3] em object storage (com ferramentas como pgBackRest ou WAL-G, ou automaticamente em bancos gerenciados como o Amazon RDS e o Cloud SQL). Para desfazer o delete das 22:00, restaure o backup base mais recente e reaplique o WAL até logo antes dele:

```bash
# restore the order database to 21:59:30, just before the accidental DELETE at 22:00
pgbackrest --stanza=order --type=time "--target=2027-03-14 21:59:30-03" \
  --target-action=promote restore
```

O RPO passa a ser o atraso do arquivamento do WAL (segundos a um minuto), e o RTO é o **tempo de restauração**, que você precisa estimar — e medir:

$$
t_{\text{restore}} \approx \frac{\text{base backup size}}{\text{restore throughput}} + \frac{\text{WAL to replay}}{\text{replay throughput}}
$$

!!! example "BoxOffice: quanto tempo leva a restauração?"

    O banco do `order` tem 2 TB. Restaurar de object storage a 200 MB/s leva $2\,000\,000 / 200 = 10\,000$ s ≈ **2,8 horas**, antes de reaplicar um dia de WAL. Isso estoura o RTO de 15 minutos. Opções: restaurar num banco já provisionado e próximo do alvo (backups base diários menores, armazenamento mais rápido), manter uma **réplica atrasada** (um standby que aplica o WAL com 1 hora de atraso, para que um erro possa ser pego antes de chegar a ela), ou dividir os dados para que a parte crítica (pedidos em aberto, o livro-razão de pagamentos) seja pequena. O número decide o projeto.

### Regras para backups que funcionam de verdade { #rules-for-backups-that-actually-work }

- **3-2-1**: pelo menos **3** cópias dos dados, em **2** tipos diferentes de armazenamento, **1** delas fora do local (outra região ou conta). A prática moderna acrescenta uma cópia **imutável** (object lock / WORM — escreva uma vez, leia muitas) que nem um atacante com credenciais de administrador consegue apagar, contra ransomware.
- **Separe o raio de impacto.** Backups na mesma conta, com as mesmas credenciais da produção, podem ser apagados pelo mesmo erro ou pelo mesmo atacante.
- **Cifre** os backups e gerencie as chaves separadamente; um backup é uma cópia completa dos dados dos seus clientes (a LGPD/GDPR se aplica).
- **Teste restaurações regularmente.** Um backup que nunca foi restaurado é uma esperança. Automatize uma restauração periódica num ambiente descartável e verifique os dados (contagem de linhas, checksums, um smoke test da aplicação).
- **Monitore** os jobs de backup e o atraso do arquivamento do WAL; alerte quando falharem ou atrasarem.

!!! warning "A lição do GitLab"
    Em janeiro de 2017, o GitLab.com perdeu cerca de seis horas de dados do banco de produção depois que um engenheiro apagou o diretório de dados no servidor errado durante um incidente. Dos vários mecanismos de backup e replicação existentes, nenhum pôde ser usado como previsto — alguns falhavam em silêncio havia muito tempo. A empresa publicou um postmortem franco[^4] que vale a leitura: backups que você não testa não são backups.

---

## Multi-AZ e multi-região { #multi-region }

| | Multi-AZ (uma região) | Multi-região |
|---|---|---|
| **Protege contra** | Perda de um data center / zona | Perda de uma região inteira; algumas dependências regionais |
| **Distância e latência** | Quilômetros, ~1 ms | Centenas a milhares de km, dezenas de ms ou mais |
| **Replicação** | Síncrona é viável (RPO ≈ 0) | Em geral **assíncrona** (RPO = atraso da replicação) |
| **Failover** | Automático, de segundos a minutos (bancos gerenciados fazem isso) | Uma decisão maior: DNS, dados, capacidade; de minutos a horas |
| **Custo** | Moderado | Alto: uma segunda cópia de (parte de) tudo, mais transferência de dados |
| **Complexidade** | Baixa | Alta: consistência dos dados, deploys em duas regiões, testes |

A replicação síncrona entre regiões coloca uma ida e volta entre regiões em cada escrita: $\approx 30$–$100$ ms por commit costuma ser inaceitável no caminho de reserva de lugares. Por isso, DR multi-região em geral significa replicação **assíncrona**, e um RPO igual ao atraso da replicação no momento do desastre. É por isso que "RPO = 0 entre regiões" ou é muito caro (replicação síncrona, ou um banco globalmente consistente como Spanner ou CockroachDB pagando a latência) ou é um mal-entendido.

Multi-região também é uma questão **jurídica**: dados pessoais podem estar sujeitos a regras de residência (LGPD no Brasil, GDPR na União Europeia), que restringem quais regiões podem guardar a cópia.

!!! info "Experimente no playground: RPO e RTO de um failover"

    O cenário `db-failover` é o checkout da venda relâmpago — 1.500 req/s, metade escritas — num primário com um seguidor replicado de forma **assíncrona**. Em t = 90 s o primário morre e a promoção leva 30 s. Aperte **Run** e leia dois números: cerca de **1.600 escritas perdidas** (pedidos confirmados pelo primário mas ainda dentro do atraso de replicação: o RPO) e uma disponibilidade de cerca de **90,6%** (30 s em que toda escrita falha: o RTO). Depois selecione o cluster e mude um parâmetro por vez:

    - **Replicação: sync** — as escritas perdidas caem para **0**, a disponibilidade fica em 90,6%: um RPO melhor, o mesmo RTO, e toda escrita agora paga uma ida e volta ao seguidor.
    - **Tempo de failover: 5 s** (de volta ao async) — a disponibilidade sobe para cerca de **98,1%**, mas os ~1.600 pedidos continuam perdidos.

    A solução possível faz as duas coisas — replicação por quorum com 2 seguidores, failover de 5 s — e divide as chaves em 2 shards, para que um primário morto leve só metade das escritas: 0 perdidas, cerca de 99,2% de disponibilidade. RPO e RTO são parâmetros separados, e cada um tem seu preço.

<div class="sdp" data-scenario="db-failover" data-mode="compact" data-height="520"></div>

---

## As quatro estratégias de DR { #dr-strategies }

O whitepaper de recuperação de desastres da AWS descreve um espectro de quatro estratégias, da barata e lenta à cara e instantânea[^1]. As mesmas ideias valem em qualquer nuvem[^2].

| Estratégia | O que roda na região de recuperação antes do desastre | RPO típico | RTO típico | Custo |
|---|---|---|---|---|
| **Backup e restore** | Nada além dos backups (e da infraestrutura como código) | Horas | Horas a um dia | $ |
| **Pilot light** | Dados replicados continuamente; infraestrutura central provisionada mas **desligada** ou no mínimo (sem servidores de aplicação) | Minutos | Dezenas de minutos a horas | $$ |
| **Warm standby** | Uma cópia completa, **em escala reduzida**, rodando sem atender nada (ou tráfego de teste) | Segundos a minutos | Minutos | $$$ |
| **Multi-site ativo-ativo** | Cópias completas em duas ou mais regiões, **todas atendendo** tráfego de produção | ≈ 0 a segundos | ≈ 0 (o tráfego muda de lugar) | $$$$ |

=== "Backup e restore"

    ``` mermaid
    flowchart LR
        subgraph A ["Região A (primária)"]
            appA["serviços"] --> dbA[("bancos")]
        end
        subgraph B ["Região B (recuperação)"]
            bk[("backups + WAL<br/>(object storage)")]
            iac["infraestrutura como código<br/>(nada rodando)"]
        end
        dbA -->|"backups, arquivo do WAL"| bk
    ```

    Depois de um desastre, crie a infraestrutura a partir do código, restaure os bancos, implante os serviços, troque o DNS. O mais barato; o RTO é dominado pelo tempo de restauração e por quão ensaiado está o procedimento.

=== "Pilot light"

    ``` mermaid
    flowchart LR
        subgraph A ["Região A (primária)"]
            appA["serviços"] --> dbA[("bancos")]
        end
        subgraph B ["Região B (recuperação)"]
            dbB[("réplicas dos bancos<br/>(rodando)")]
            appB["serviços<br/>(desligados: 0 réplicas)"]
        end
        dbA -->|"replicação assíncrona"| dbB
    ```

    A "chama piloto" são os dados, sempre ligados e atualizados. Num desastre, promova as réplicas, inicie os serviços (escalando a partir de 0), troque o DNS.

=== "Warm standby"

    ``` mermaid
    flowchart LR
        subgraph A ["Região A (primária, 100%)"]
            appA["serviços × 12"] --> dbA[("bancos")]
        end
        subgraph B ["Região B (standby, ~10%)"]
            appB["serviços × 2<br/>(rodando, ociosos)"] --> dbB[("réplicas")]
        end
        dbA -->|"replicação assíncrona"| dbB
    ```

    Tudo já roda na região B em pequena escala e é testado continuamente. Num desastre, promova, **escale para cima**, mude o tráfego. Escalar não pode depender da região A (imagens, segredos, cotas disponíveis em B).

=== "Multi-site ativo-ativo"

    ``` mermaid
    flowchart LR
        dns["GeoDNS / LB global"] --> A
        dns --> B
        subgraph A ["Região A (atendendo)"]
            appA["serviços"] --> dbA[("dados")]
        end
        subgraph B ["Região B (atendendo)"]
            appB["serviços"] --> dbB[("dados")]
        end
        dbA <-->|"replicação nos dois sentidos"| dbB
    ```

    As duas regiões atendem usuários o tempo todo; perder uma significa mandar o tráfego dela para a outra (que precisa ter capacidade). A parte difícil são os dados: duas regiões aceitando escritas nos mesmos registros precisam de resolução de conflitos ou de um banco globalmente consistente.

### Ativo-ativo e o inventário de lugares { #active-active-and-the-seat-inventory }

Ativo-ativo é fácil para dados **de leitura predominante**: o catálogo pode ser lido em qualquer região a partir de réplicas locais e da CDN. É difícil para dados com **invariantes fortes**: se São Paulo e Virgínia aceitam reservas do lugar B-12 e replicam de forma assíncrona, dois fãs podem comprar o mesmo lugar — exatamente o que o BoxOffice nunca pode fazer (veja [Consistência](../../distributed/consistency/index.md)). As opções:

- **Região de origem por entidade**: cada evento (show) pertence a uma região; todas as reservas e vendas dele vão para lá; a outra região é o warm standby dele. Fãs em outras regiões pagam um pouco de latência por aquele show. A posse só muda durante um failover.
- **Um banco globalmente consistente** (Spanner, CockroachDB, YugabyteDB): consenso entre regiões em toda escrita, ao custo da latência entre regiões no caminho de reserva.
- **Multi-líder com resolução de conflitos** (last-writer-wins, CRDTs): ótimo para um carrinho de compras ou uma lista de "favoritos", **inaceitável** para lugares.

---

## Failover entre regiões { #failover-between-regions }

Um failover regional é uma sequência de passos, cada um com uma duração que se soma ao RTO:

``` diagram-sim
sequenceDiagram
    participant M as monitores externos
    participant OC as plantão
    participant DNS as DNS (com health check)
    participant A as região A
    participant B as região B (warm standby)
    Note over A: região degradada às 22:00
    M->>OC: probes de compra falhando em 3 locais (2 min)
    OC->>OC: confirma que é regional, declara desastre (5 min)
    OC->>A: fencing: bloqueia escritas em A (se alcançável)
    OC->>B: promove as réplicas dos bancos (1 min)
    OC->>B: escala os serviços de 2 para 12 réplicas (5 min)
    OC->>DNS: aponta boxoffice.example para a região B
    Note over DNS: os clientes seguem depois do TTL (60 s)
    DNS-->>B: o tráfego chega, RTO ≈ 14 min
```

$$
\text{RTO} \approx t_{\text{detect}} + t_{\text{decide}} + t_{\text{promote}} + t_{\text{scale}} + t_{\text{DNS TTL}}
$$

Pontos que decidem se funciona:

- **Detecção de fora.** Probes que rodam dentro da região com falha podem falhar com ela. Use verificações sintéticas externas da jornada de compra.
- **Decisão automática ou humana?** Failover automático é rápido mas arriscado: uma oscilação de rede que dispara um failover regional (e depois um failback) pode causar mais estrago do que evita (*flapping*). Muitos times automatizam *dentro* de uma região e mantêm uma decisão humana, com runbook ensaiado, *entre* regiões.
- **Fencing.** Antes de o standby aceitar escritas, garanta que o primário antigo não consegue (revogue as credenciais, pare-o, ou use um lease). Dois primários aceitando reservas é **split brain**: lugares vendidos em dobro.
- **TTL do DNS.** Clientes e resolvedores guardam as respostas de DNS pelo TTL; um TTL de 1 hora significa uma cauda de 1 hora de tráfego indo para a região morta. Use registros de DNS com health check (por exemplo, registros de failover do Amazon Route 53) e TTLs curtos no ponto de entrada (veja [DNS e CDN](../../edge/dns-cdn/index.md)).
- **Estabilidade estática.** A região de recuperação não pode depender da que falhou: imagens de container, segredos, configuração e cotas de capacidade já precisam estar na região B.
- **Failback.** Voltar é outra migração: ressincronize os dados de B para A e então troque num horário tranquilo. Planeje e ensaie isso também.

!!! info "Experimente no playground"

    O cenário `multi-region` tem failover de DNS entre duas regiões. Rode com o perfil **load** e depois provoque uma **indisponibilidade da região** primária. Observe a taxa de erros até o health check do DNS fazer o failover, e anote quanto tempo leva. Mude o TTL do DNS e o intervalo do health check e meça o novo tempo de recuperação; depois reduza a capacidade da região standby e veja o que acontece com a latência logo após o failover.

<div class="sdp" data-scenario="multi-region" data-mode="compact" data-chaos="off" data-height="540"></div>

---

## O plano de DR do BoxOffice { #the-boxoffice-dr-plan }

| Camada | Serviços | Estratégia | RPO | RTO |
|---|---|---|---|---|
| **Camada 0** — receita | `order`, `payment`, `inventory` | Standby síncrono multi-AZ na região + **warm standby** numa segunda região (replicação assíncrona), backups com PITR e retenção de 35 dias, cópia imutável em outra conta | Segundos (na região: 0) | 15 min |
| **Camada 1** — navegação | `catalog`, `gateway`, `auth`, sala de espera | Leituras ativo-ativo (CDN + réplicas nas duas regiões); escritas do catálogo só na primária | 1 h para edições do catálogo | 5 min (principalmente DNS) |
| **Camada 2** — derivados | `search`, `notification` | **Pilot light**: reconstruir o índice a partir do catálogo; reenviar notificações pendentes a partir do Kafka | Derivado / reprocessável | 4 h |
| **Camada 3** — interno | analytics, warehouse | **Backup e restore** | 24 h | 2 dias |

Por que um **warm standby** para a camada 0, e não algo mais barato ou mais forte: o RTO de 15 minutos descarta backup e restore (só restaurar os 2 TB do banco do `order` leva cerca de 2,8 horas) e torna o pilot light arriscado (promover e escalar do zero leva dezenas de minutos); o ativo-ativo deixaria duas regiões venderem o assento B-12 ao mesmo tempo. O preço é uma segunda região rodando a cerca de um décimo da escala o ano todo, mais os exercícios que provam que ela consegue assumir.

E as práticas que mantêm o plano honesto:

- **Um runbook** por cenário (perda de região, corrupção de banco, conta comprometida) com os comandos exatos, os responsáveis e os critérios de decisão.
- **Exercícios de DR** duas vezes por ano: fazer de fato o failover para a região B por uma hora num período tranquilo, e restaurar um backup de produção num ambiente descartável todo mês. A página de [engenharia do caos](../chaos/index.md) mostra como conduzi-los como game days.
- **Revisar RPO/RTO com o negócio** todo ano: o contrato do estádio pode exigir mais, ou a camada de analytics pode aceitar menos.

!!! tip "Na entrevista"
    Quando perguntarem "e se a região cair?" ou "e se alguém apagar a tabela?", comece pelo **RPO e RTO por classe de dados** — e escolha a estratégia mais barata que os atende. Diferencie com clareza: **replicação** protege contra perda de infraestrutura, **backups com PITR** contra corrupção lógica. Para um sistema com invariantes fortes (lugares, saldos), explique por que ativo-ativo é difícil (escritas conflitantes) e proponha uma região de origem por entidade com warm standby. Apresente o RTO como uma soma de passos, incluindo o TTL do DNS.

!!! success "Boas práticas"

    - **Combine RPO e RTO por classe de dados com o negócio e escreva-os no runbook** — uma meta única e rígida para tudo é o plano mais caro; o livro-razão de pagamentos e o data warehouse de analytics diferem em um dia.
    - **Cronometre todo teste de restore e compare com o RTO** — a aritmética decide o projeto: 2 TB a 200 MB/s são 2,8 horas contra um RTO de 15 minutos.
    - **Alerte sobre o atraso de arquivamento do WAL** — ele *é* o RPO real da recuperação point-in-time; um atraso de uma hora é uma hora de pedidos a reconstruir à mão.
    - **Mantenha o TTL de DNS do ponto de entrada em 60 s ou menos, com registros verificados por health check** — cada segundo de TTL é uma cauda de fãs ainda mandados para a região morta.
    - **Implante a região standby a partir do mesmo código de infraestrutura a cada release** — imagens, segredos e configuração já na região B; um standby atualizado à mão se desvia até o dia em que é necessário.

!!! warning "Armadilhas comuns"

    - **"Temos réplicas, então temos backups."** Réplicas copiam o erro.
    - **Nunca testar uma restauração** — ou medir o tempo dela só durante o desastre.
    - **Backups na mesma conta e região** da produção, apagáveis pelas mesmas credenciais.
    - **Uma região de recuperação que depende da região que falhou** (imagens, segredos, o sistema de CI, o plano de controle do provedor de DNS naquela região).
    - **Ignorar a capacidade**: um warm standby que não consegue escalar porque a região não tem cota livre num dia movimentado.
    - **Sem fencing**: o primário antigo volta e aceita escritas — split brain, lugares vendidos em dobro.

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    BIZ["RPO e RTO<br/>por classe de dado"] --> STRAT["backup e restauração · pilot light ·<br/>warm standby · ativo-ativo"]
    INFRA["perda de infraestrutura<br/>(zona, região)"] --> REPL["replicação, multi-AZ<br/>→ Bancos de dados — replicação"]
    LOGIC["corrupção lógica<br/>(o DELETE errado)"] --> PITR["backups PITR, 3-2-1,<br/>cópia imutável"]
    REPL --> STRAT
    PITR --> STRAT
    STRAT --> AA["ativo-ativo vs a invariante dos assentos<br/>→ Distribuídos — consistência"]
    STRAT --> FO["failover regional:<br/>detectar, cercar, promover, escalar"]
    FO --> FENCE["fencing, sem split brain<br/>→ Distribuídos — consenso"]
    FO --> DNS["DNS com health check, TTL curto<br/>→ Borda — DNS"]
    FO --> DRILL["simulações de DR, testes de restauração<br/>→ Engenharia do caos"]
```

**Componentes da paleta:** [`sql`](../../../reference/components/storage/index.md#sql) (standby, réplicas, PITR) · [`objstore`](../../../reference/components/storage/index.md#objstore) (backups base e o arquivo de WAL) · [`dns`](../../../reference/components/edge/index.md#dns) (registros de failover e TTL) · [`cdn`](../../../reference/components/edge/index.md#cdn) (serve o catálogo desatualizado enquanto a origem se recupera) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (reprocessa notificações não enviadas) · [`app`](../../../reference/components/compute/index.md#app) (escalado de 2 para 12 réplicas na região standby). **Cenários:** `db-failover`, `multi-region`, `db-replicas`. **Continua em:** [Bancos de dados — replicação](../../databases/replication/index.md), [Distribuídos — consistência](../../distributed/consistency/index.md), [Distribuídos — consenso](../../distributed/consensus/index.md), [Borda — DNS e CDN](../../edge/dns-cdn/index.md#dns-routing), [Cloud-native — entrega](../../cloud-native/delivery/index.md) (infraestrutura como código), [Projeto — game day](../../../exercises/project/game-day/index.md).

---

[^1]: AMAZON WEB SERVICES. [Disaster Recovery of Workloads on AWS: Recovery in the Cloud](https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-workloads-on-aws.html){target="_blank"}. AWS Whitepaper, 2021.
[^2]: GOOGLE CLOUD. [Disaster recovery planning guide](https://cloud.google.com/architecture/dr-scenarios-planning-guide){target="_blank"}. Cloud Architecture Center.
[^3]: [PostgreSQL Documentation — Continuous Archiving and Point-in-Time Recovery (PITR)](https://www.postgresql.org/docs/current/continuous-archiving.html){target="_blank"}.
[^4]: GITLAB. [Postmortem of database outage of January 31](https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/){target="_blank"}. GitLab Blog, 2017.
