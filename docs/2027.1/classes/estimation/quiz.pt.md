Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Números e estimativas { #numbers-and-estimation }

**Q1.** A BoxOffice tem 2 M de fãs ativos por dia, cada um vendo cerca de 20 páginas por dia. Qual é a taxa **média** de leituras, e para o que você deve dimensionar?

- A. ~40 leituras/s; dimensionar para a média
- B. ~400 leituras/s em média; dimensionar para a hora de pico, ~2–3× maior (~1.000–1.200 leituras/s)
- C. ~4.000 leituras/s; dimensionar para a média
- D. ~40.000 leituras/s; dimensionar para 10× a média

??? success "Resposta"
    **B — ~400 leituras/s em média, dimensionando para o pico.**

    2 × 10⁶ × 20 = 4 × 10⁷ leituras/dia; um dia ≈ 10⁵ s, então ≈ 400 leituras/s (463 com os 86.400 exatos). O tráfego não é plano: a hora mais movimentada costuma ser 2–3× a média, e é isso que a capacidade precisa aguentar. Os picos das aberturas de vendas são estimados separadamente.

---

**Q2.** Qual ordenação de latências, da mais rápida para a mais lenta, está correta?

- A. Leitura aleatória em SSD < referência à RAM < ida e volta na mesma zona < ida e volta entre continentes
- B. Referência à RAM < leitura aleatória em SSD < ida e volta na mesma zona < ida e volta entre continentes
- C. Referência à RAM < ida e volta na mesma zona < leitura aleatória em SSD < ida e volta entre continentes
- D. Ida e volta na mesma zona < referência à RAM < leitura aleatória em SSD < ida e volta entre continentes

??? success "Resposta"
    **B — ~100 ns < ~20–100 µs < ~0,1–0,5 ms < ~100+ ms.**

    A memória é cerca de mil vezes mais rápida que uma leitura aleatória em SSD, que é um pouco mais rápida que uma ida e volta de rede dentro de um data centre; uma ida e volta entre continentes é ainda centenas de vezes mais lenta, limitada pela velocidade da luz na fibra (~5 µs por km).

---

**Q3.** Um handler de página faz 40 chamadas **sequenciais** ao Redis na mesma zona de disponibilidade, cada uma quase sem trabalho no servidor. Aproximadamente quanto tempo o handler gasta nessas chamadas, e qual é a correção?

- A. ~40 µs; nada a corrigir
- B. ~4–20 ms, dominados pelas idas e voltas de rede; agrupe as chamadas (`MGET`, pipelining) ou use cache no próprio processo
- C. ~4 s; substitua o Redis por um banco de dados
- D. ~400 ms; acrescente réplicas do Redis

??? success "Resposta"
    **B — As idas e voltas dominam.**

    Cada chamada custa uma ida e volta na mesma zona de ~0,1–0,5 ms, então 40 delas custam ~4–20 ms, mesmo com o Redis fazendo microssegundos de trabalho por chamada. Agrupar transforma 40 idas e voltas em uma.

---

**Q4.** A BoxOffice emite 200 mil PDFs de ingressos por dia, com ~100 KB cada, e quer guardá-los por 5 anos. Aproximadamente quanto armazenamento é isso, e onde ele deve ficar?

- A. ~36 GB, na tabela de pedidos
- B. ~3,6 TB, no Redis
- C. ~36 TB, num object store (ou gerar os PDFs sob demanda em vez de armazená-los)
- D. ~360 TB, no data warehouse

??? success "Resposta"
    **C — ~36 TB.**

    2 × 10⁵ × 10⁵ B = 2 × 10¹⁰ B = 20 GB/dia; × 365 ≈ 7,3 TB/ano; × 5 ≈ 36 TB. Arquivos grandes e imutáveis pertencem a um object store (barato, durável, praticamente ilimitado) — e, como um PDF pode ser regenerado a partir do pedido, armazená-los é uma escolha de design que vale questionar.

---

**Q5.** As páginas de eventos carregam ~1 MB de imagens, e o pico é de 1.200 visualizações de página por segundo. De quanta banda a origem precisa sem uma CDN?

- A. ~1,2 Mbit/s
- B. ~120 Mbit/s
- C. ~10 Gbit/s
- D. ~1 Tbit/s

??? success "Resposta"
    **C — ~10 Gbit/s.**

    1.200 × 1 MB = 1,2 GB/s; × 8 bits = 9,6 Gbit/s. Isso satura um link de 10 Gbit/s e é caro em tráfego de saída — um forte motivo para servir imagens por uma CDN, onde 95% de acerto na borda deixam ~0,5 Gbit/s para a origem. Lembre-se: rede em **bits**, armazenamento em **bytes**.

---

## Filas e escalabilidade { #queueing-and-scalability }

**Q6.** O serviço de inventário recebe 1.000 reservas/s e cada reserva passa 40 ms dentro do serviço. Em média, quantas reservas estão em andamento?

- A. 25
- B. 40
- C. 400
- D. 40.000

??? success "Resposta"
    **B — Lei de Little: L = λ × W = 1.000 × 0,040 = 40.**

    Essa é a concorrência mínima de que o serviço precisa (threads, ou vagas num event loop) — mais folga para rajadas e para a perda de uma réplica.

---

**Q7.** Dois milhões de fãs estão na sala de espera da BoxOffice, que admite 1.000 fãs por segundo no inventário. Quanto tempo espera o **último** fã da fila?

- A. ~33 segundos
- B. ~3,3 minutos
- C. ~33 minutos
- D. ~5,5 horas

??? success "Resposta"
    **C — W = L / λ = 2.000.000 / 1.000 = 2.000 s ≈ 33 min.**

    Na prática, os 60 mil lugares acabam muito antes, e a sala de espera deveria avisar o resto da fila que o show esgotou em vez de fazê-los esperar.

---

**Q8.** Um teste de carga roda 100 usuários virtuais em laço fechado, sem tempo de pensar. O tempo de resposta do servidor é 50 ms. Qual é o throughput **máximo** que esse teste consegue gerar — e o que acontece se o servidor ficar lento, com 500 ms?

- A. 2.000 req/s; com 500 ms, continua 2.000 req/s
- B. 2.000 req/s; com 500 ms, cai para 200 req/s — o teste reduz a carga exatamente quando o sistema sofre
- C. 100 req/s nos dois casos
- D. 20.000 req/s; não é afetado pelo tempo de resposta

??? success "Resposta"
    **B — N = X × (R + Z), então X = 100 / 0,05 = 2.000 req/s, depois 100 / 0,5 = 200 req/s.**

    Testes em laço fechado são estrangulados pelo próprio sistema sob teste. Para testar uma taxa de chegada-alvo, use um modelo aberto (taxa de chegada constante) e confira os resultados com a Lei de Little.

---

**Q9.** Um único servidor de banco (modelado como M/M/1) tem tempo de serviço de 5 ms. Qual é o seu tempo médio de resposta a 50% e a 90% de utilização?

- A. 5 ms e 5 ms
- B. 7,5 ms e 9,5 ms
- C. 10 ms e 50 ms
- D. 10 ms e 500 ms

??? success "Resposta"
    **C — R = S / (1 − ρ): 5 / 0,5 = 10 ms; 5 / 0,1 = 50 ms.**

    Menos que o dobro da carga deixou a média 5× pior; o p99 (≈ 4,6 × a média na M/M/1) vai de ~46 ms para ~230 ms. Esse é o joelho da curva de latência.

---

**Q10.** Por que serviços sensíveis à latência costumam mirar ~50–70% de utilização no pico em vez de ~95%?

- A. Porque as CPUs superaquecem acima de 70%
- B. Porque os provedores de nuvem cobram mais acima de 70%
- C. Porque o tempo de resposta cresce como 1 / (1 − ρ), explodindo perto da saturação, e as réplicas restantes precisam absorver a carga de uma que falhe
- D. Porque utilizações acima de 70% não podem ser medidas com precisão

??? success "Resposta"
    **C — Fique à esquerda do joelho e mantenha folga para o failover.**

    Com 4 réplicas a 60%, perder uma leva as outras a 80% — ainda atendendo. A 80% cada, perder uma exige ~107%: as sobreviventes colapsam.

---

**Q11.** Testes de carga de um serviço dão o throughput relativo C(1) = 1, C(8) = 5,5, C(32) = 9 e C(64) = 8. Qual modelo e causa se encaixam melhor?

- A. Escala linear; as medições são ruído
- B. Só a lei de Amdahl; há uma fração serial, mas nenhum outro custo
- C. A Universal Scalability Law: contenção mais um custo de coerência (nós se coordenando entre si) que faz o throughput **cair** depois de um pico
- D. A Lei de Little; o teste usou poucos usuários virtuais

??? success "Resposta"
    **C — Throughput diminuindo com mais nós é a assinatura do termo de coerência (κ).**

    A lei de Amdahl sozinha se achata em 1/σ, mas nunca diminui. Uma queda depois de N* = √((1 − σ)/κ) indica conversa cruzada: locks distribuídos, tráfego de coerência de cache, comunicação de todos com todos. A correção é particionar o trabalho para que os nós compartilhem menos, não acrescentar nós.

---

## Percentis e disponibilidade { #percentiles-and-availability }

**Q12.** O servidor A reporta p99 = 100 ms e o servidor B reporta p99 = 1.000 ms; eles atenderam o mesmo número de requisições. Qual é o p99 dos dois servidores juntos?

- A. 550 ms, a média
- B. 1.000 ms, o máximo
- C. Não dá para calcular a partir desses dois números; some os histogramas de latência e calcule o percentil a partir do resultado
- D. 100 ms, o mínimo

??? success "Resposta"
    **C — Não se tira média de percentis.**

    O p99 combinado depende da forma completa das duas distribuições. Sistemas de monitoramento guardam histogramas justamente para poder somá-los entre servidores e janelas de tempo.

---

**Q13.** O serviço de busca consulta 100 shards em paralelo e espera por todos. Cada shard é mais lento que 200 ms em 1% das suas chamadas (o seu p99), de forma independente. Aproximadamente que fração das buscas dos usuários leva mais de 200 ms?

- A. 1%
- B. 10%
- C. 63%
- D. 99%

??? success "Resposta"
    **C — 1 − 0,99¹⁰⁰ ≈ 63%.**

    Sob fan-out, a cauda do backend vira a experiência típica do usuário. Mitigações: hedged requests depois do p95, resultados parciais depois de um prazo, menos shards no caminho crítico.

---

**Q14.** O checkout chama de forma síncrona cinco componentes, cada um 99,9% disponível, com falhas independentes. Qual é a melhor estimativa da disponibilidade do checkout, e a melhor primeira melhoria?

- A. 99,9%; nada a melhorar
- B. ~99,5%; tirar do caminho crítico qualquer componente pelo qual o usuário não precisa esperar (por exemplo, enviar o e-mail de forma assíncrona)
- C. ~95%; acrescentar um cache na frente de cada componente
- D. ~99,99%; componentes em série melhoram a disponibilidade

??? success "Resposta"
    **B — 0,999⁵ ≈ 99,5%.**

    Em série, as disponibilidades se multiplicam, então a cadeia é pior que qualquer elo. A melhoria mais barata costuma ser tirar dependências rígidas do caminho (trabalho assíncrono, fallbacks); depois, acrescentar redundância aos elos fracos e fazer cada elo restante ter cerca de um nove a mais que a meta.

---

**Q15.** O serviço de inventário tem três réplicas, cada uma 99,5% disponível. A fórmula do paralelo dá 1 − 0,005³ ≈ 99,99999%. Por que a disponibilidade real pode ser muito menor?

- A. Porque a fórmula deveria usar soma, não multiplicação
- B. Porque as réplicas frequentemente falham juntas — mesma versão, mesma configuração, mesma zona ou uma dependência compartilhada —, quebrando a premissa de independência
- C. Porque três réplicas são sempre mais lentas que uma
- D. Porque load balancers reduzem a disponibilidade pela metade

??? success "Resposta"
    **B — Falhas correlacionadas.**

    Um deploy ruim aplicado a todas as réplicas em poucos minutos, a queda de uma zona ou um certificado expirado derrubam todas as réplicas de uma vez. Espalhe as réplicas por zonas, faça as mudanças de forma gradual (canário) e reduza o MTTR com rollback rápido.
