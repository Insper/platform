Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Falhas em cascata e timeouts { #cascading-failures-and-timeouts }

**Q1.** O `order` tem 50 threads. Os pagamentos chegam a 20 por segundo e o `payment` de repente leva 3 s para responder. O `GET /orders/{id}` não chama o `payment`. O que acontece com ele, e por quê?

- A. Nada: ele não depende do `payment`
- B. Ele também fica lento e estoura o timeout: seriam necessárias 20/s × 3 s = 60 threads só para esperar o `payment`, mais que as 50 disponíveis, então toda requisição vai para a fila
- C. Ele fica mais rápido, porque os pagamentos são lentos e deixam a CPU ociosa
- D. Ele só falha se o banco de dados também estiver lento

??? success "Resposta"
    **B — esgotamento de threads: uma falha em cascata.**

    Pela Lei de Little, concorrência = taxa de chegada × tempo no sistema. Chamadas que esperam uma dependência lenta seguram threads; quando o pool se esgota, requisições que nunca tocam a dependência ficam na fila atrás delas. O cenário `browse` do k6 existe para tornar esse dano colateral visível.

---

**Q2.** Por que um timeout é a primeira proteção a adicionar?

- A. Ele deixa a dependência mais rápida
- B. Ele transforma uma falha lenta numa falha rápida: cada chamada segura uma thread por no máximo o timeout, o que limita a concorrência gasta naquela dependência
- C. Ele faz retry automaticamente
- D. Ele é exigido pelo HTTP/1.1

??? success "Resposta"
    **B — espera limitada.**

    Com um timeout de leitura de 1 s, 20 pagamentos/s seguram no máximo cerca de 20 threads, por mais lento que o `payment` fique. O preço: chamadas que teriam dado certo em 1,5 s agora falham. Os clientes HTTP Java esperam para sempre por padrão, então a falta de um timeout é a causa raiz mais comum das cascatas.

---

**Q3.** A borda estoura o timeout depois de 5 s, o gateway depois de 10 s, e o `order` espera o `payment` por até 3 retries × 4 s. O que está errado?

- A. Nada; timeouts internos mais longos são mais seguros
- B. Os orçamentos internos excedem os externos: a borda desiste enquanto o `order` e o gateway continuam trabalhando em requisições que ninguém está esperando. Os orçamentos precisam encolher a cada salto
- C. O timeout do gateway deveria ser 0
- D. Os retries deveriam ser infinitos para garantir o sucesso

??? success "Resposta"
    **B — os orçamentos de timeout precisam diminuir de fora para dentro.**

    Trabalho feito depois que quem chamou desistiu é puro desperdício — e segura threads e conexões. Um orçamento consistente é algo como borda 10 s > gateway 5 s > order→payment (1 s × 3 tentativas + backoff).

---

## Retries e idempotência { #retries-and-idempotency }

**Q4.** Uma tentativa de chamar o `payment` falha com probabilidade 0,2, de forma independente. Com `max-attempts: 3`, qual é a probabilidade de um pagamento falhar?

- A. 0,6
- B. 0,2
- C. 0,008
- D. 0,04

??? success "Resposta"
    **C — 0,2³ = 0,008 (0,8%).**

    Uma chamada só falha se as três tentativas falharem. Retries são muito eficazes contra erros independentes e transitórios — e inúteis (ou prejudiciais) contra erros persistentes: se o `payment` está fora do ar, três tentativas só triplicam a carga e a latência.

---

**Q5.** Por que o `PaymentClient` envia `Idempotency-Key: order-<id>` em toda tentativa?

- A. Para autenticar o `order` junto ao `payment`
- B. Para que o retry de uma chamada cuja resposta se perdeu (mas que deu certo) não cobre o fã duas vezes: o `payment` e o provedor devolvem o primeiro resultado para uma chave conhecida
- C. Para fazer o circuit breaker contar chamadas por pedido
- D. Porque o HTTP a exige para `POST`

??? success "Resposta"
    **B — retries só são seguros em operações idempotentes.**

    Um timeout não significa que a chamada falhou — a cobrança pode ter dado certo e só a resposta se perdeu. Sem uma chave de idempotência, o retry cria uma segunda cobrança. Com ela, a segunda requisição encontra a chave (`UNIQUE` em `payments`, repassada ao provedor) e recebe o resultado original.

---

**Q6.** Que problema o **jitter** (espera aleatória) resolve no backoff dos retries?

- A. Ele reduz o número de retries
- B. Ele impede que clientes que falharam no mesmo momento tentem de novo no mesmo momento, o que criaria ondas sincronizadas de carga sobre uma dependência em recuperação
- C. Ele deixa os timeouts mais curtos
- D. Ele criptografa as requisições de retry

??? success "Resposta"
    **B — dessincronizar os retries.**

    O backoff exponencial sozinho espalha as tentativas no tempo, mas todos os clientes seguem o mesmo cronograma: uma queda que atinge 1.000 clientes de uma vez produz ondas de 1.000 retries em +200 ms, +400 ms… Adicionar ±50% de aleatoriedade transforma as ondas num fluxo mais suave. O cenário `retry-storm` do playground mostra a amplificação.

---

## Circuit breaker e bulkhead { #circuit-breaker-and-bulkhead }

**Q7.** O circuit breaker tem `minimum-number-of-calls: 10`, `failure-rate-threshold: 50` e `wait-duration-in-open-state: 10s`. O `payment` cai. O que o breaker faz?

- A. Tenta de novo para sempre até o `payment` voltar
- B. Depois de pelo menos 10 chamadas registradas com ≥ 50% de falhas, ele abre: por 10 s as chamadas falham imediatamente com `CallNotPermittedException`; depois ele passa a half-open e deixa passar algumas chamadas de teste para decidir se fecha
- C. Reinicia o `payment`
- D. Envia todas as chamadas para uma instância reserva do `payment`

??? success "Resposta"
    **B — fechado → aberto → half-open → fechado (ou aberto de novo).**

    O estado aberto poupa as threads e o tempo de quem chama, e dá espaço para a dependência se recuperar em vez de uma enxurrada de chamadas condenadas. As sondas do half-open detectam a recuperação automaticamente. Um breaker não conserta nada — ele limita o estrago.

---

**Q8.** Por que a `CallNotPermittedException` está nas `ignore-exceptions` do retry?

- A. Porque o Resilience4j tecnicamente não consegue fazer retry dela
- B. Porque, quando o circuito está aberto, tentar de novo imediatamente é inútil e só adiciona latência; a chamada deve falhar rápido para o fallback
- C. Porque ela é uma checked exception
- D. Porque o bulkhead cuida dela

??? success "Resposta"
    **B — um circuito aberto é uma decisão, não um erro transitório.**

    Com a ordem padrão dos aspectos, Retry(CircuitBreaker(Bulkhead(call))), o retry vê a rejeição do breaker. Repeti-la só juntaria três rejeições e os atrasos do backoff. Ignorá-la manda a requisição direto para o fallback — rápido e honesto.

---

**Q9.** As chamadas ao `payment` dão certo, mas levam 700 ms, abaixo tanto do timeout de leitura quanto do limite de chamada lenta. A 70 pagamentos/s, as 50 threads do `order` ficam quase todas ocupadas e o `GET /orders/{id}` fica lento. Que padrão resolve isso?

- A. Um timeout menor
- B. Mais retries
- C. Um bulkhead: limitar as chamadas concorrentes ao `payment` (por exemplo, 10), rejeitando o excedente imediatamente para que o resto das threads continue servindo os outros endpoints
- D. Uma janela maior no circuit breaker

??? success "Resposta"
    **C — um bulkhead limita a concorrência que uma dependência pode usar.**

    Nada está falhando, então nem o timeout nem o breaker reagem. 70/s × 0,7 s ≈ 49 chamadas concorrentes enchem o pool. O bulkhead reserva a capacidade restante para todo o resto; alguns pagamentos recebem um `503` rápido, o que é melhor que o serviço inteiro ficar lento.

---

**Q10.** No `PaymentGateway`, por que o `fallbackMethod` está no `@Retry` e não no `@CircuitBreaker`?

- A. Porque o `@CircuitBreaker` não suporta fallbacks
- B. Porque o Retry é o aspecto mais externo: um fallback no circuit breaker interno converteria toda falha na exceção do fallback antes que o retry pudesse ver — e repetir — o erro transitório original
- C. Porque os fallbacks precisam estar na primeira anotação do arquivo-fonte
- D. Não há diferença

??? success "Resposta"
    **B — o fallback pertence à camada mais externa.**

    A ordem padrão do Resilience4j é Retry(CircuitBreaker(RateLimiter(TimeLimiter(Bulkhead(call))))). Um fallback substitui a exceção da camada que ele decora. No breaker interno, uma `ResourceAccessException` viraria `PaymentUnavailableException`, que não está em `retry-exceptions`: o retry pararia de funcionar silenciosamente.

---

## Caos e game days { #chaos-and-game-days }

**Q11.** Por que o `OrderService.pay` chama o `payment` **fora** de uma transação de banco?

- A. Porque o JDBC não permite chamadas HTTP dentro de transações
- B. Porque uma transação segura uma conexão do banco: esperar 3 s pelo `payment` dentro dela levaria o esgotamento das threads do Tomcat para o pool de conexões, afetando toda consulta do `order`
- C. Para deixar o pagamento mais rápido
- D. Porque o Resilience4j exige isso

??? success "Resposta"
    **B — nunca segure recursos escassos enquanto espera uma chamada remota.**

    O pool tem ~10 conexões; alguns pagamentos lentos dentro de transações deixariam todas as outras consultas sem conexão. A chamada remota roda primeiro, depois uma transação curta atualiza o status (o `WHERE status = 'PENDING_PAYMENT'` a mantém idempotente) e grava o evento do outbox.

---

**Q12.** Qual é o propósito da **hipótese de estado estável** num game day?

- A. Provar que o sistema nunca falha
- B. Declarar, antes de injetar uma falha, o comportamento mensurável que o sistema deve manter (por exemplo, p95 do `browse` < 200 ms enquanto o `payment` está lento), para que o resultado seja uma confirmação ou refutação clara
- C. Agendar o game day para quando o tráfego estiver estável
- D. Decidir quem é o culpado pelas falhas

??? success "Resposta"
    **B — sem hipótese, não há experimento.**

    Engenharia do caos é um experimento: linha de base, hipótese, injeção, observação, conclusão. Uma hipótese refutada (o sistema *não* se comportou como projetado) é o resultado mais valioso — encontrado numa terça à tarde em vez de durante a próxima venda relâmpago. A revisão é sem culpados: ela corrige sistemas e processos, não pessoas.

[Voltar ao lab](index.md){ .md-button }
