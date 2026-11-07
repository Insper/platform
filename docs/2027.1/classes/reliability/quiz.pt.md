Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Disponibilidade e falhas { #availability-and-failure }

**Q1.** O serviço `catalog` falha em média a cada **500 horas** e leva **30 minutos** para se recuperar. Qual é a sua disponibilidade?

- A. 99%
- B. 99,5%
- C. 99,9%
- D. 99,99%

??? success "Resposta"
    **C — 99,9%.**

    Disponibilidade = MTTF / (MTTF + MTTR) = 500 / 500,5 ≈ 0,999. Repare na alavanca: reduzir o MTTR para 3 minutos (reinício automático) daria 500 / 500,05 ≈ 99,99% sem mudar a frequência das falhas.

---

**Q2.** O time de produto pede **99,99%** de disponibilidade mensal no caminho de compra. O que isso implica na operação?

- A. Nada de especial: é só 0,09% melhor que 99,9%
- B. Cerca de 4,4 minutos de indisponibilidade por mês — menos do que leva para acionar alguém e fazer rollback à mão, então detecção e recuperação precisam ser automatizadas
- C. Cerca de 43 minutos por mês, o suficiente para um rollback manual
- D. Zero indisponibilidade: os deploys precisam ser feitos de madrugada

??? success "Resposta"
    **B — cerca de 4,4 minutos por mês; automação é obrigatória.**

    Cada nove é 10× menos indisponibilidade: 99,9% permite ≈ 43,8 min por mês, 99,99% ≈ 4,38 min. Uma resposta humana (alerta, acordar, diagnosticar, fazer rollback) não cabe nesse orçamento, então failover, rollback e roteamento por saúde precisam ser automáticos — e dependências síncronas com 99,9% (como um provedor de pagamento) tornam a meta impossível sem redundância.

---

**Q3.** O gateway roda **3 réplicas independentes com 99% cada** e toda requisição também precisa de um **banco de dados com 99,95%**. Qual é a disponibilidade aproximada do caminho?

- A. 97%
- B. 99%
- C. 99,95%
- D. 99,9999%

??? success "Resposta"
    **C — cerca de 99,95%.**

    As réplicas estão em paralelo: $1 - 0.01^3 = 99.9999\%$. O banco está em série: $0.999999 \times 0.9995 \approx 99.95\%$. Depois que um componente é replicado, os componentes não replicados dominam; a próxima melhoria precisa mirar o banco (por exemplo, um standby com failover automático).

---

**Q4.** O `order` recebe **50 requisições/s** que chamam o `payment` e tem um pool de **100 threads**. A latência do pagamento vai de **100 ms para 5 s** e não há timeout. O que acontece?

- A. Nada: 50 requisições/s está bem abaixo de 100 threads
- B. Cerca de 250 chamadas estariam em voo (50 × 5), mais que o pool: o `order` esgota suas threads e suas outras rotas também começam a falhar
- C. 25 threads são usadas, então sobram 75 livres
- D. As chamadas ao pagamento falham rápido com um erro

??? success "Resposta"
    **B — esgotamento de threads e uma cascata.**

    Lei de Little: chamadas em voo = taxa de chegada × tempo por chamada. Com 100 ms, 5 threads ficam ocupadas; com 5 s, seriam 250 — além do pool de 100. As requisições enfileiram, todas as rotas do `order` ficam lentas (inclusive as que não chamam o pagamento) e quem chama o `order` começa a esgotar os próprios pools. Um timeout, um circuit breaker e um bulkhead quebram, cada um, essa cadeia.

---

## SLIs, SLOs e error budgets { #slis-slos-and-error-budgets }

**Q5.** Qual destes é o melhor **SLI** para a jornada de reserva de lugares?

- A. Uso médio de CPU dos pods do `inventory`
- B. Número de pods do `inventory` rodando
- C. Proporção das requisições `POST /holds`, medidas no gateway, que devolvem não-5xx em menos de 500 ms
- D. Latência média de `POST /holds` ao longo do dia

??? success "Resposta"
    **C — uma razão entre eventos bons e eventos válidos, medida perto do usuário.**

    CPU e número de pods são métricas de infraestrutura: um serviço pode estar com CPU baixa e totalmente quebrado. Uma média esconde a cauda (5% dos fãs esperando 4 s quase não a mexe). Um bom SLI diz que fração das requisições dos usuários foi boa — rápida o bastante *e* com sucesso — e pode ser comparado com uma meta.

---

**Q6.** O caminho de compra atende **2.000.000 de requisições por dia** com um SLO de **99,95% em 28 dias**. Quantas requisições com falha o error budget permite na janela?

- A. 1.000
- B. 28.000
- C. 56.000
- D. 2.800

??? success "Resposta"
    **B — 28.000.**

    Requisições na janela: $2\,000\,000 \times 28 = 56\,000\,000$. Orçamento: $(1 - 0.9995) \times 56\,000\,000 = 0.0005 \times 56\,000\,000 = 28\,000$ requisições com falha.

---

**Q7.** Com um SLO de **99,9%** em 28 dias, a taxa de erros está estável em **0,6%**. Qual é o burn rate e quando o orçamento se esgota?

- A. 0,6×; nunca
- B. 6×; em cerca de 4,7 dias
- C. 60×; em cerca de 11 horas
- D. 6×; em 6 horas

??? success "Resposta"
    **B — 6×, cerca de 4,7 dias.**

    Burn rate = taxa de erros / (1 − SLO) = 0,006 / 0,001 = 6. O orçamento dura a janela dividida pelo burn rate: 28 / 6 ≈ 4,7 dias. No esquema do SRE Workbook, uma queima de 6× sustentada por 6 horas (5% do orçamento) é um alerta que aciona o plantão.

---

## Padrões de resiliência { #resilience-patterns }

**Q8.** O gateway, o `order` e o adaptador `payment` **cada um** repetem chamadas que falharam, com até **3 tentativas** por camada. O provedor está fora do ar. Quantas chamadas ao provedor um clique de um fã pode gerar?

- A. 3
- B. 9
- C. 27
- D. 81

??? success "Resposta"
    **C — 27.**

    As tentativas se multiplicam entre as camadas: $3 \times 3 \times 3 = 27$. Retries em todas as camadas transformam uma indisponibilidade numa tempestade justamente quando a dependência está mais fraca. Faça retry em uma só camada (perto da dependência), limite as tentativas, use backoff com jitter e um retry budget, e deixe o circuit breaker parar os retries quando a dependência está sabidamente fora.

---

**Q9.** Depois de um failover do banco, **1.000 clientes** recebem um erro de conexão no mesmo instante e todos repetem com backoff exponencial (0,5 s, 1 s, 2 s…) **sem jitter**. O que dá errado e qual é a correção?

- A. Nada: o backoff exponencial já espalha os retries
- B. Todos os clientes repetem nos mesmos instantes, criando picos sincronizados acima da capacidade; a maioria falha de novo. O full jitter torna cada espera aleatória para os retries se espalharem
- C. Os retries são lentos demais; repita imediatamente
- D. O banco precisa ser escalado para aguentar 1.000 conexões concorrentes

??? success "Resposta"
    **B — ondas sincronizadas; adicione full jitter.**

    Backoff sem jitter mantém em sincronia os clientes que falharam juntos: 1.000 requisições em 0,5 s, os sobreviventes em 1,5 s e assim por diante, cada onda acima da capacidade. O full jitter ($\text{random}(0, \text{base} \cdot 2^n)$) os espalha e a maioria tem sucesso na primeira rodada.

---

**Q10.** O circuit breaker do `payment` abre várias vezes por dia embora o provedor esteja saudável. A investigação mostra que ondas de **cartões recusados** (bots testando cartões roubados) são contadas como falhas. O que deve mudar?

- A. Aumentar o limite de falhas para 95%
- B. Remover o circuit breaker
- C. Configurar erros de negócio como "cartão recusado" como exceções ignoradas, para que só falhas técnicas (erros, timeouts, chamadas lentas) contem
- D. Repetir os cartões recusados três vezes

??? success "Resposta"
    **C — não contar respostas de negócio corretas como falhas.**

    Um cartão recusado é uma resposta válida de um provedor saudável. Contá-lo abre o breaker para todos os fãs honestos. Repeti-lo (D) nunca está certo: a resposta é definitiva. Breakers devem contar falhas técnicas — e chamadas lentas, para pegar gray failures.

---

**Q11.** No lab 9, o `order` faz **20 chamadas de pagamento por segundo** com latência normal de **200 ms** e o seu **bulkhead de pagamento permite 10** chamadas concorrentes (de 50 threads). O que isso dá?

- A. As chamadas ao pagamento ficam limitadas a 10 por segundo
- B. Normalmente cerca de 4 chamadas estão em voo; o bulkhead tolera a latência crescer cerca de 2,5× antes de rejeitar e quando o pagamento fica muito lento no máximo 10 threads esperam por ele, sobrando as outras 40 para outras rotas
- C. 10 threads ficam reservadas e sempre ocupadas
- D. As chamadas ao pagamento serão repetidas 10 vezes

??? success "Resposta"
    **B — folga de cerca de 2,5× e um teto para o estrago.**

    Lei de Little: $20 \times 0.2 = 4$ chamadas concorrentes normalmente. Com 10 permissões, a latência pode chegar a cerca de 500 ms antes de as chamadas serem rejeitadas. Se o pagamento vai para 3 s, no máximo 10 threads esperam (em vez de 60, mais que o pool de 50) e as chamadas além disso falham na hora para o fallback (`max-wait-duration: 0`), enquanto o `GET /orders/{id}` mantém as suas threads.

**Q12.** Um time adiciona uma verificação do banco ao probe de **liveness** do `order`. O banco tem uma oscilação de 20 segundos. O que acontece?

- A. Nada: o Kubernetes ignora probes menores que um minuto
- B. Todas as réplicas do `order` falham no liveness ao mesmo tempo e são reiniciadas; uma oscilação de 20 segundos do banco vira uma indisponibilidade de vários minutos enquanto todas as JVMs sobem
- C. Só a réplica que percebeu a oscilação é reiniciada
- D. As réplicas são removidas do load balancer e voltam quando o banco voltar

??? success "Resposta"
    **B — um reinício da frota inteira.**

    Falha de liveness significa "reinicie o container". Uma dependência compartilhada no liveness faz todas as réplicas falharem juntas. O liveness deve detectar só um processo travado; o readiness remove uma instância do load balancer (D descreve o readiness) — e mesmo o readiness precisa ser usado com cuidado com dependências compartilhadas.

---

## Recuperação de desastres e caos { #disaster-recovery-and-chaos }

**Q13.** Às 22:00 um script apaga todas as linhas de `orders` em produção. O standby síncrono em outra zona replicou o delete. O que restaura os dados e qual objetivo o tempo de restauração afeta?

- A. Promover o standby; afeta o RPO
- B. Uma restauração para um ponto no tempo a partir dos backups (backup base + replay do WAL até 21:59:59); a duração da restauração determina o RTO e o atraso do arquivamento, o RPO
- C. Nada consegue restaurar: a replicação é o backup
- D. Fazer failover para outra região; afeta o RPO

??? success "Resposta"
    **B — PITR a partir dos backups.**

    Réplicas (na zona ou em outra região) copiam o erro. Recuperar de uma falha lógica exige uma cópia de *antes* dela: um backup base mais o WAL arquivado, reaplicado até o instante anterior ao delete. O RPO é limitado pela frequência de arquivamento do WAL; o RTO, pelo tempo da restauração — que precisa ser medido (2 TB a 200 MB/s são quase 3 horas).

---

**Q14.** Para o caminho de compra do BoxOffice, o negócio pede **RTO ≤ 15 minutos** e **RPO de segundos** no caso de uma indisponibilidade **regional**, a um custo razoável. Lugares nunca podem ser vendidos duas vezes. Qual estratégia se encaixa melhor?

- A. Backup e restore em outra região
- B. Pilot light com os serviços escalados a zero
- C. Warm standby: bancos replicados de forma assíncrona para uma segunda região, uma cópia reduzida dos serviços rodando lá, promovida e escalada no failover (com fencing do primário antigo)
- D. Multi-site ativo-ativo com as duas regiões aceitando reservas e replicando uma para a outra

??? success "Resposta"
    **C — warm standby.**

    Backup e restore (A) leva horas; pilot light (B) exige iniciar e escalar os serviços a partir de zero, o que é difícil de caber em 15 minutos com segurança. Ativo-ativo com escritas nas duas regiões (D) arrisca vender um lugar duas vezes, a menos que se use um banco globalmente consistente ou uma região de origem por evento — a um custo bem maior. Um warm standby atende ao RPO (atraso de replicação de segundos) e ao RTO (detectar + decidir + promover + escalar + TTL do DNS), desde que seja ensaiado em exercícios de DR.

---

**Q15.** O time quer verificar se o circuit breaker do `payment` realmente protege o catálogo. Qual plano é um **experimento de caos** adequado?

- A. Matar pods aleatórios de produção durante a próxima abertura de vendas do estádio e ver o que acontece
- B. Definir o estado estável (p99 do catálogo < 300 ms, reservas com sucesso ≥ 99,9%) e a hipótese (com 3 s de latência no provedor o breaker abre em até 10 s e a latência do catálogo fica estável); injetar a latência com Toxiproxy sob carga k6, primeiro em homologação, com uma condição de aborto pelo burn rate
- C. Escrever um teste unitário que simula o breaker aberto com um mock
- D. Esperar o próximo incidente real do provedor e ler o postmortem

??? success "Resposta"
    **B — hipótese, injeção controlada, raio de impacto pequeno, condição de aborto.**

    Engenharia do caos é um experimento: prever o estado estável, injetar uma falha realista, observar os SLIs, comparar. A (falhas aleatórias durante uma abertura de vendas, sem hipótese, sem aborto) é imprudente; C não exercita timeouts, pools e tráfego real; D é esperar a produção rodar o experimento por você, no pior momento.

---

## Orçamentos e limites { #budgets-and-thresholds }

**Q16.** O page de queima rápida do caminho da compra só dispara quando o burn rate está acima de **14,4 na última hora *e* nos últimos 5 minutos**. Para que serve a janela de 5 minutos?

- A. Ela faz o page disparar mais cedo durante uma indisponibilidade total
- B. Ela faz o alerta parar logo depois que o problema é corrigido: a média de 1 hora fica acima de 14,4 por até uma hora depois da recuperação, a de 5 minutos cai em minutos
- C. Ela filtra oscilações curtas, que a janela de 1 hora acionaria
- D. O Prometheus não consegue avaliar uma janela de 1 hora sozinha

??? success "Resposta"
    **B — ela prova que a queima *ainda está acontecendo*.**

    A janela longa (1 h) prova que a queima é significativa: quando ela dispara, 2% do orçamento de 28 dias já se foi. Mas uma média de uma hora se lembra do incidente por uma hora, então sozinha ela continuaria acionando muito depois da correção. A janela curta — 1/12 da longa — só fica acima do limite enquanto os erros continuam, então o alerta se desarma cerca de 5 minutos depois da recuperação. A detecção é dada pela janela longa, não pela curta (A); as oscilações são filtradas pela janela longa (C).

**Q17.** O gateway espera no máximo **5 s** pelo `order`. O `order` chama o `payment` com **timeout de leitura de 1 s** e o time aumenta o retry para **4 tentativas** com backoff de 200 ms, 400 ms e 800 ms. O provedor para de responder. O que acontece?

- A. Nada muda: cada tentativa é limitada pelo timeout de 1 s
- B. No pior caso o `order` precisa de 4 × 1 s + 0,2 + 0,4 + 0,8 s = 5,4 s: o gateway desiste em 5 s e responde `504`, enquanto o `order` continua trabalhando — e cobrando — para ninguém
- C. O breaker impede a quarta tentativa, então o total fica sempre abaixo de 5 s
- D. O gateway espera o `order`, porque os timeouts de baixo têm precedência

??? success "Resposta"
    **B — o orçamento de dentro precisa caber no de fora.**

    Timeouts se aninham: tentativas × timeout + as esperas precisam ficar abaixo do prazo de quem chama. Com 3 tentativas (1 + 0,2 + 1 + 0,4 + 1 ≈ 3,6 s) o lab 9 cabe nos 5 s do gateway; uma quarta tentativa não cabe. O breaker (C) só ajuda depois de abrir e nada faz quem chama esperar mais que o seu próprio timeout (D).

**Q18.** O `order` lê o `payment` com **timeout de 1 s** e o seu breaker conta como lentas as chamadas acima de **1,5 s**. O provedor responde em **900 ms** em vez de 200 ms. O que o breaker faz?

- A. Abre pela taxa de chamadas lentas, já que 900 ms são 4,5× a latência normal
- B. Nada: 900 ms está abaixo do timeout e do limite de 1,5 s, então toda chamada é um sucesso; e uma chamada mais lenta que 1 s estoura o timeout — uma falha —, então nenhuma chamada pode contar como lenta
- C. Abre depois de 60 s, a duração padrão de chamada lenta do Resilience4j
- D. Fica meio-aberto para testar o provedor

??? success "Resposta"
    **B — um limite de chamada lenta acima do timeout nunca dispara.**

    Uma chamada mais lenta que o timeout de leitura nunca termina, então um limite de chamada lenta acima do timeout só vê chamadas que já deram certo rápido o bastante. Defina-o **abaixo** do timeout — o lab 9 usa 800 ms contra um timeout de leitura de 1 s, com taxa de chamadas lentas de 50% —, para que um provedor lento abra o breaker antes que as threads se encham esperando timeouts.
