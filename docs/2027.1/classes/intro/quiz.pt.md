Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Design de sistemas e requisitos

**Q1.** Qual pergunta é de **design de sistemas**, e não de design de software (no nível do código)?

- A. O `OrderService` deve depender de uma interface ou de uma classe concreta de cliente de pagamento?
- B. Qual algoritmo de ordenação deve ordenar os eventos por data?
- C. Reservas de lugares e o catálogo de eventos devem ficar no mesmo banco, sabendo que um tem consistência forte e escritas quentes e o outro é dominado por leituras e cacheável?
- D. Um método deve lançar uma exceção checada ou não checada?

??? success "Resposta"
    **C — Trata de componentes em execução, posicionamento dos dados e carga.**

    Design de sistemas decide os componentes, as interfaces entre processos em execução e onde os dados ficam, para que o sistema cumpra seus requisitos sob carga e falha parcial. A e D são design no nível do código; B é uma questão de algoritmo.

---

**Q2.** Qual dos itens abaixo é um requisito **não funcional**?

- A. Um fã pode reservar até 6 lugares por 10 minutos.
- B. Organizadores podem agendar a data de abertura das vendas.
- C. Reservas de lugares terminam em menos de 300 ms no percentil 99, com 5.000 reservas por segundo.
- D. Fãs recebem seus ingressos por e-mail.

??? success "Resposta"
    **C — Descreve *quão bem*, com um número, um percentil e um nível de carga.**

    A, B e D descrevem *o que* o sistema faz (funcionais). C é uma meta de latência mensurável para um throughput declarado — um atributo de qualidade.

---

**Q3.** Por que "o sistema deve ser escalável" é um requisito ruim?

- A. Escalabilidade não pode ser obtida com bancos relacionais.
- B. Não diz qual parâmetro de carga cresce, quanto, nem que desempenho deve ser mantido enquanto ele cresce.
- C. Escalabilidade é um requisito funcional, não um não funcional.
- D. As nuvens modernas escalam sozinhas, então o requisito é redundante.

??? success "Resposta"
    **B — Escalabilidade não tem sentido sem um parâmetro de carga e uma meta.**

    Uma versão útil nomeia a carga ("2 M de fãs no primeiro minuto de uma abertura de vendas", "1.500 leituras/s no catálogo") e o desempenho a manter ("reserva p99 < 300 ms"). As nuvens fornecem recursos, não uma arquitetura capaz de usá-los.

---

**Q4.** A BoxOffice precisa de **consistência forte** para qual dado?

- A. A descrição do evento mostrada nos resultados de busca.
- B. O contador "1.234 pessoas estão vendo este evento".
- C. O estado de cada lugar (livre, reservado, vendido).
- D. A lista de eventos recomendados na página inicial.

??? success "Resposta"
    **C — Dois fãs nunca podem comprar o mesmo lugar.**

    Consistência forte custa latência e disponibilidade, então só se paga por ela onde o negócio exige. Descrições e recomendações podem ter segundos ou minutos de atraso; o contador de visualizações é só uma dica.

---

**Q5.** Um banco de dados fica inacessível por 20 minutos por causa de um problema de rede, mas nenhum dado confirmado é perdido. Qual afirmação está correta?

- A. A durabilidade foi violada; a disponibilidade, não.
- B. A disponibilidade foi violada; a durabilidade, não.
- C. Disponibilidade e durabilidade foram violadas.
- D. Nenhuma foi violada, porque os dados continuam lá.

??? success "Resposta"
    **B — Indisponível, mas durável.**

    Disponibilidade é atender requisições quando necessário; durabilidade é nunca perder dados confirmados. Um sistema pode estar fora do ar sem perder nada (este caso), ou no ar sem guardar nada de forma durável (um cache).

---

**Q6.** Qual afirmação descreve melhor o trade-off introduzido ao colocar o catálogo de eventos em cache?

- A. Melhora a consistência ao custo da latência.
- B. Melhora a latência e reduz a carga no banco ao custo do frescor (os leitores podem ver dados desatualizados).
- C. Melhora a durabilidade ao custo da disponibilidade.
- D. Não há trade-off se o TTL for curto.

??? success "Resposta"
    **B — Velocidade e alívio do banco comprados com frescor.**

    Uma página em cache pode ficar desatualizada até o TTL expirar ou a chave ser invalidada. Um TTL menor reduz o atraso, mas também a taxa de acerto — ele se move ao longo do trade-off, não o elimina.

---

## A jornada de escala

**Q7.** A BoxOffice roda três réplicas do servidor de aplicação atrás de um load balancer. Depois do login, os fãs são "deslogados" aleatoriamente na página seguinte. Qual é a causa mais provável?

- A. Os health checks do load balancer são frequentes demais.
- B. O estado de sessão fica na memória do servidor que atendeu o login.
- C. O banco não tem réplicas de leitura.
- D. A CDN está guardando a página de login em cache.

??? success "Resposta"
    **B — Os servidores de aplicação não são sem estado.**

    A próxima requisição cai em outra réplica, que não conhece a sessão. Guarde o estado de sessão num token assinado (JWT) ou num armazenamento compartilhado (Redis). Servidores sem estado são a pré-condição da escala horizontal e dos deploys graduais.

---

**Q8.** O banco do catálogo está com 80% de CPU, e 95% das suas consultas são leituras de dados que mudam algumas vezes por dia. Acrescentar qual componente dá a maior redução de carga no banco por real (R$) gasto?

- A. Mais réplicas do servidor de aplicação.
- B. Um cache com cache-aside, chegando a 95% de acerto.
- C. Uma fila de mensagens entre a aplicação e o banco.
- D. Particionar (sharding) o banco do catálogo.

??? success "Resposta"
    **B — Com 95% de acerto, só 5% das leituras chegam ao banco (uma redução de 20×).**

    Mais réplicas da aplicação (A) só aumentariam a carga no banco. Uma fila (C) não ajuda leituras síncronas. O sharding (D) acrescenta muita complexidade para um problema que é volume de leitura, não tamanho dos dados nem volume de escrita.

---

**Q9.** Depois de acrescentar réplicas de leitura, um fã paga, é redirecionado para "Meus pedidos" e não vê o pedido novo. O que está acontecendo, e qual é uma correção padrão?

- A. O pedido foi perdido; ative replicação síncrona em tudo.
- B. Atraso de replicação: a leitura caiu numa réplica que ainda não aplicou a escrita; leia do primário os dados recentes do próprio fã (*read-your-writes*).
- C. A CDN guardou a página em cache; desative a CDN.
- D. O load balancer mandou a requisição a um servidor não saudável; reduza o intervalo dos health checks.

??? success "Resposta"
    **B — Atraso de replicação; use read-your-writes.**

    As réplicas aplicam as alterações do primário de forma assíncrona, de milissegundos a segundos depois. Mandar ao primário as leituras que um usuário faz das próprias escritas recentes (ou o fluxo crítico inteiro) corrige o sintoma sem abrir mão das réplicas para todo o resto.

---

**Q10.** Por que a BoxOffice coloca uma **sala de espera** (uma fila) na frente do inventário nas grandes aberturas de vendas?

- A. Para guardar os ingressos de forma durável.
- B. Para converter um pico de milhões de requisições simultâneas em linhas quentes numa taxa de admissão estável, que o inventário aguenta.
- C. Para tornar as reservas de lugares eventualmente consistentes.
- D. Para guardar o mapa de lugares em cache.

??? success "Resposta"
    **B — Ela molda o pico numa carga plana e sustentável.**

    60 mil lugares não aceitam 2 M de reservas simultâneas: as linhas estão quentes e o banco tem capacidade finita. A sala de espera admite fãs nessa capacidade e mantém o inventário com consistência forte.

---

**Q11.** Uma equipe de quatro engenheiros está começando um produto novo, com domínio incerto e algumas centenas de usuários. Qual arquitetura é o ponto de partida mais sensato?

- A. Doze microsserviços no Kubernetes com Kafka entre eles.
- B. Um monólito modular com um banco, extraindo serviços depois, quando um sintoma medido justificar.
- C. Uma função serverless por tabela do banco.
- D. Uma implantação multi-região ativo-ativo.

??? success "Resposta"
    **B — Primeiro o monólito.**

    A distribuição tem um custo fixo alto (falhas de rede, dados distribuídos, muitos artefatos, trabalho de plataforma). Com um domínio incerto, as fronteiras dos serviços ainda não são conhecidas; um monólito modular as mantém baratas de mudar.

---

## O método da entrevista

**Q12.** Numa entrevista de system design de 45 minutos, qual é o principal objetivo do passo de estimativa?

- A. Mostrar que você multiplica números grandes depressa.
- B. Calcular o número exato de servidores do design final.
- C. Obter ordens de grandeza que mudem decisões de design — por exemplo, se é preciso cache, sharding ou fila.
- D. Ocupar o tempo enquanto pensa no design.

??? success "Resposta"
    **C — Uma estimativa que não leva a nenhuma decisão é só aritmética.**

    "40 GB/ano de pedidos cabem num banco por anos — sem sharding" ou "100 mil req/s na abertura de vendas — o inventário precisa de uma sala de espera" são o tipo de conclusão para o qual uma estimativa existe.

---

**Q13.** Vinte minutos depois do início da entrevista, o candidato tem um esquema SQL detalhado e nenhum diagrama do sistema como um todo. Qual princípio foi violado?

- A. Pensar em voz alta.
- B. Primeiro amplo, depois fundo — um design simples e completo antes de qualquer aprofundamento.
- C. Declarar as premissas explicitamente.
- D. Estimar antes de projetar.

??? success "Resposta"
    **B — Amplitude primeiro.**

    O entrevistador não consegue avaliar profundidade num design que ainda não viu. Desenhe um design de alto nível que cubra todo requisito funcional (passo 4) antes dos aprofundamentos (passo 5) e confira o relógio a cada transição.

---

**Q14.** Durante o aprofundamento sobre venda duplicada, qual resposta mostra o **raciocínio sobre trade-offs** mais forte?

- A. "Vou usar locks no Redis, porque o Redis é rápido."
- B. "Vou usar um banco, porque bancos são consistentes."
- C. "Opções: locks pessimistas, um `UPDATE … WHERE status = 'FREE'` condicional ou um lock distribuído. O update condicional é atômico na fonte única da verdade e não segura locks longos; um lock no Redis acrescenta um segundo sistema que precisa concordar com o banco. Vou usar o update condicional."
- D. "Venda duplicada é rara, então resolvo depois com reembolsos."

??? success "Resposta"
    **C — Alternativas, comparação, escolha e do que se abre mão.**

    A e B citam uma tecnologia sem compará-la com nada. D ignora um requisito que o próprio candidato escreveu no quadro ("nenhuma venda duplicada, jamais").

---

**Q15.** O entrevistador pergunta: *"O que acontece se o provedor de pagamentos ficar muito lento?"* Qual é a melhor reação?

- A. Explicar que o provedor tem um SLA, então isso não vai acontecer.
- B. Tratar como uma dica sobre tratamento de falhas: acrescentar timeouts e um circuit breaker na chamada de pagamento, manter a reserva viva enquanto o pagamento está pendente e explicar o custo (lugares presos por mais tempo).
- C. Trocar o provedor por um sistema de pagamentos próprio.
- D. Pedir ao entrevistador para passar a outro assunto.

??? success "Resposta"
    **B — As perguntas do entrevistador são dicas sobre o que ele quer avaliar.**

    Uma dependência lenta sem timeouts esgota as threads de quem chama e se propaga em cascata (aula 9). Nomear a mitigação *e o seu custo* mostra profundidade e raciocínio sobre trade-offs.
