Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Servidores stateless e escala

**Q1.** A primeira versão do `inventory` da BoxOffice guarda as reservas de assento (holds) em um `ConcurrentHashMap` dentro de cada réplica. Tudo funciona no notebook do desenvolvedor. O que acontece com três réplicas atrás de um load balancer round-robin?

- A. A próxima requisição do fã pode cair numa réplica que não conhece o hold, um reinício esquece todos os holds, e duas réplicas podem reservar o mesmo assento para fãs diferentes
- B. Nada muda: cada réplica tem seu próprio mapa, então os holds ficam três vezes mais rápidos
- C. O load balancer sincroniza automaticamente os três mapas
- D. Só o desempenho piora, porque os mapas precisam ser copiados entre as réplicas

??? success "Resposta"
    **A — O estado está preso em um processo.**

    Uma réplica stateless não guarda nada de que outra réplica precise. O hold é estado compartilhado com um invariante ("um assento, um hold"), então precisa morar num armazenamento que o garanta — uma linha no PostgreSQL com restrição de unicidade, ou uma chave no Redis criada com `NX` e expiração. Sticky sessions só esconderiam parte do problema e ainda perderiam holds a cada reinício.

---

**Q2.** Uma réplica do `catalog` atende no máximo **500 requisições/s**. O pico é de **6.000 requisições/s** e o time mira **60% de utilização**, mais uma réplica de folga. Quantas réplicas?

- A. 12
- B. 20
- C. 21
- D. 24

??? success "Resposta"
    **C — 21 réplicas.**

    Na meta, cada réplica deve atender 500 × 0,6 = 300 requisições/s; logo 6.000 / 300 = 20 réplicas, mais uma de folga = **21**. A opção A (12) é a conta com 100% de utilização (6.000 / 500), que não deixa margem: a latência explode perto da saturação e perder uma réplica significa sobrecarga. A opção B esquece a réplica de folga.

---

**Q3.** Por que os times miram **50–70% de utilização** nos app servers em vez de operá-los perto de 100%?

- A. Os provedores de nuvem cobram mais por CPUs acima de 70%
- B. O tempo de espera em fila cresce bruscamente quando a utilização se aproxima de 100%; a folga mantém a latência (principalmente a cauda) baixa e absorve rajadas e falhas de réplicas
- C. O garbage collector da JVM não roda acima de 70% de CPU
- D. Os load balancers param de enviar tráfego para réplicas acima de 70% de utilização

??? success "Resposta"
    **B — A latência não é linear na carga.**

    Numa fila, o tempo de espera cresce como 1 / (1 − ρ): com 50% de utilização uma requisição espera mais ou menos o seu tempo de serviço; com 90%, cerca de dez vezes isso, e o p99 piora ainda antes. A folga também cobre rajadas e a perda de uma réplica ou de uma zona.

---

## Serviços e fronteiras

**Q4.** A BoxOffice tem três times e uma única base de código Spring Boot. Qual situação é o motivo **mais forte** para extrair o `inventory` como serviço próprio?

- A. A base de código tem mais de 100.000 linhas
- B. Um desenvolvedor novo prefere Kotlin
- C. Microsserviços são o padrão moderno
- D. Durante a abertura de vendas, o `inventory` recebe muitas escritas, precisa de consistência forte e de escala e ajuste próprios, enquanto o `catalog` é de leitura intensa e cacheável; um time é dono do inventory e precisa publicar versões de forma independente

??? success "Resposta"
    **D — Uma força real: perfil diferente de escala/consistência e autonomia do time.**

    Tamanho sozinho (A) e moda (C) não são motivos; preferência de linguagem (B) é um motivo fraco. Dividir compensa quando você consegue nomear a força — escala independente, autonomia do time, isolamento de falhas, escopo de compliance, tecnologia diferente — e essa força diz onde cortar.

---

**Q5.** Na BoxOffice, a palavra *Event* significa "artista, data, local, imagens" no catálogo e "mapa de assentos, setores, holds" no inventário. O que o DDD recomenda?

- A. Que cada **bounded context** tenha seu próprio modelo de `Event`, trocando ids e eventos entre os contextos
- B. Criar uma única classe `Event` compartilhada numa biblioteca comum usada por todos os serviços
- C. Renomear um deles para que a palavra seja única na empresa
- D. Guardar tudo numa tabela `events` que os dois serviços leem e escrevem

??? success "Resposta"
    **A — Um modelo por bounded context.**

    Um bounded context é a fronteira dentro da qual valem um modelo e um significado para cada palavra. Uma classe compartilhada (B) ou uma tabela compartilhada (D) acopla os times e gera um modelo inchado — o caminho clássico para um monolito distribuído. Os contextos se referenciam por id e se comunicam por APIs e eventos.

---

**Q6.** O serviço `payment` conversa com um provedor externo cuja API usa status como `requires_action` e `processing`. Onde essas strings devem aparecer no código da BoxOffice?

- A. Em todo lugar onde o status de um pagamento é verificado, para que os desenvolvedores aprendam o vocabulário do provedor
- B. No banco de dados, como valores da coluna de status do pagamento
- C. Apenas dentro do **adapter** do provedor (camada anticorrupção), que os traduz para os estados de pagamento da própria BoxOffice atrás de uma porta como `PaymentGateway`
- D. No front-end, que os mostra ao fã

??? success "Resposta"
    **C — Somente dentro do adapter.**

    A porta (`PaymentGateway`) pertence ao núcleo e fala a língua da BoxOffice; o adapter é a única classe que conhece a API do provedor. Isso mantém os testes dos casos de uso independentes do provedor e transforma a adição de um segundo provedor num novo adapter, e não numa reescrita.

---

## Estilos de API

**Q7.** O serviço interno `order` chama o `inventory` milhares de vezes por segundo durante a abertura de vendas; os dois pertencem à BoxOffice. Qual estilo se encaixa melhor, e qual é o principal cuidado operacional?

- A. GraphQL; o cuidado é que ele não pode ser usado entre serviços
- B. Webhooks; o cuidado é que eles precisam de assinaturas
- C. REST com XML; o cuidado é o tamanho do payload
- D. gRPC; o cuidado é que as conexões HTTP/2 de longa duração anulam o balanceamento L4, então é preciso um proxy L7, uma service mesh ou balanceamento no cliente

??? success "Resposta"
    **D — gRPC, com balanceamento L7 ou no cliente.**

    O gRPC oferece clientes tipados gerados, payloads protobuf compactos, multiplexação e deadlines — ideal para chamadas internas de alto volume. Como todas as chamadas de um cliente compartilham uma conexão HTTP/2, um balanceador L4 as prende a uma réplica; balanceie por requisição com Envoy, uma service mesh ou balanceamento no cliente.

---

**Q8.** Qual mudança numa API REST pública é **incompatível** (breaking)?

- A. Adicionar um novo parâmetro de consulta opcional `?city=`
- B. Adicionar o campo `doorsOpenAt` à resposta do evento
- C. Mudar `price` de reais (`450.00`) para centavos (`45000`) no mesmo campo
- D. Adicionar um novo endpoint `GET /v1/venues/{id}`

??? success "Resposta"
    **C — Mudar o significado de um campo.**

    Os clientes existentes mostrariam preços 100 vezes maiores sem nenhum erro. Adições (A, B, D) são compatíveis desde que os clientes sejam leitores tolerantes, que ignoram campos desconhecidos. Uma mudança incompatível exige uma nova versão (ou um campo novo) e uma migração do tipo expand and contract.

---

**Q9.** Uma página de eventos do app móvel, construída sobre GraphQL, lista 20 eventos, cada um com sua `availability` resolvida pelo serviço `inventory`. A latência está ruim e o `inventory` recebe 21 chamadas por visualização de página. Qual é o problema e a correção usual?

- A. O problema N+1; agrupar as 20 consultas em uma chamada com um DataLoader
- B. Over-fetching; trocar para REST
- C. Faltam índices no banco do catálogo
- D. GraphQL não pode chamar outros serviços; mover os dados para o banco próprio do BFF

??? success "Resposta"
    **A — N+1, corrigido com agrupamento (DataLoader).**

    Uma consulta para a lista mais uma chamada de resolver por item é o padrão N+1. Um DataLoader coleta os ids pedidos durante um passo de execução e os resolve numa única chamada agrupada (e os guarda em cache durante a requisição).

---

## Trabalho assíncrono

**Q10.** Depois que a venda abre, chegam 100 pedidos/s para renderização de ingressos; cada job leva 0,8 s de um worker. Há 40 workers. Depois de 10 minutos de pico, qual é aproximadamente o tamanho do backlog?

- A. 0 — 40 workers bastam
- B. 3.000 jobs
- C. 30.000 jobs
- D. 60.000 jobs

??? success "Resposta"
    **C — cerca de 30.000 jobs.**

    40 workers / 0,8 s = 50 jobs/s de capacidade. O backlog cresce 100 − 50 = 50 jobs/s; em 600 s são 30.000 jobs. Acompanhar o ritmo exigiria 100 × 0,8 = 80 workers (lei de Little) — e só se o downstream (por exemplo, o rate limit do provedor de e-mail) permitir.

---

**Q11.** O `inventory` roda 10 réplicas, e um método `@Scheduled(fixedRate = 30_000)` libera os holds expirados. O que está errado, e o que uma correção correta exige?

- A. Nada está errado; o Spring roda métodos agendados em uma réplica só
- B. O job roda nas 10 réplicas; um lock distribuído com expiração (por exemplo, ShedLock) reduz as duplicações, mas como locks podem expirar durante uma pausa, a própria liberação também precisa ser idempotente (um `UPDATE` condicional) ou protegida por fencing token
- C. O job roda 10 vezes; usar uma réplica maior resolve
- D. O job nunca roda, porque `@Scheduled` é desabilitado em containers

??? success "Resposta"
    **B — Roda N vezes; locks sozinhos não garantem correção.**

    O Spring agenda o método em todas as réplicas. Um CronJob, um lock ou a eleição de líder evitam a duplicação no caso normal, mas quem detém o lock e pausa além da expiração pode rodar ao mesmo tempo que o próximo detentor. A correção vem de escritas idempotentes e condicionais (`... WHERE status = 'ACTIVE' AND expires_at < now()`) ou de fencing tokens.

---

## Serverless e autoscaling

**Q12.** Uma função atende 1.500 requisições/s com duração média de 200 ms no AWS Lambda (uma requisição por ambiente de execução). Quantos ambientes simultâneos ela precisa, e que risco isso cria para um banco PostgreSQL atrás dela?

- A. 30 ambientes; nenhum risco
- B. 1.500 ambientes; um por requisição por segundo
- C. 7.500 ambientes; o Lambda vai rejeitar as requisições
- D. 300 ambientes; até 300 conexões simultâneas com o banco, a menos que um pooler (RDS Proxy, PgBouncer) ou a concorrência reservada as limitem

??? success "Resposta"
    **D — 300 ambientes simultâneos.**

    Concorrência = taxa × duração = 1.500 × 0,2 = 300 (lei de Little). Cada ambiente normalmente abre sua própria conexão com o banco, então a camada de funções pode esgotar as conexões do banco; coloque um pooler no meio ou limite a função com concorrência reservada.

---

**Q13.** Uma venda de estádio abre às 10:00 e o tráfego salta 20× em segundos. O HPA do Kubernetes mira 60% de CPU. Por que os fãs ainda veem erros nos primeiros minutos, e qual é a melhor mitigação para esse evento **conhecido**?

- A. O escalonamento reativo precisa de métricas, de uma decisão, possivelmente de nós novos, de download de imagens e de aquecimento da JVM — minutos no total; escale **por agendamento** (por exemplo, às 09:45) até a previsão e pré-aqueça caches e pools
- B. O HPA está quebrado; troque-o por um VPA
- C. CPU é a métrica errada para qualquer serviço; escale pela latência
- D. Defina `maxReplicas` como 1.000 para o HPA reagir mais rápido

??? success "Resposta"
    **A — Atraso do autoscaling; pré-escalar por agendamento.**

    Cada passo do escalonamento reativo é pequeno, mas juntos levam de um a alguns minutos, enquanto o pico chega em segundos. Para picos anunciados, aumente o mínimo com antecedência; para picos desconhecidos, conte com folga, sala de espera e load shedding. Aumentar `maxReplicas` (D) não deixa o escalonamento mais rápido e pode sobrecarregar o banco.

---

## Integrações externas

**Q14.** O `payment` chama o provedor para criar uma cobrança; a chamada dá **timeout**. O que o serviço deve fazer?

- A. Marcar o pagamento como falho e liberar os assentos do fã
- B. Marcar o pagamento como bem-sucedido, já que a maioria das cobranças dá certo
- C. Marcá-lo como `UNKNOWN`, depois repetir com a **mesma chave de idempotência** ou consultar o status no provedor, e também aceitar o resultado por webhook
- D. Repetir imediatamente com uma nova chave de idempotência, para o provedor não rejeitar como duplicata

??? success "Resposta"
    **C — O resultado é desconhecido; resolva-o com segurança.**

    Um timeout depois do envio significa que a cobrança pode ou não existir. Falhar (A) libera os assentos de um fã que talvez tenha sido cobrado; dar sucesso (B) entrega ingressos que talvez não estejam pagos. Uma chave nova (D) é exatamente como cobranças duplicadas acontecem. A mesma chave torna o retry seguro: o provedor devolve o pagamento original se ele foi criado.

---

**Q15.** Qual desenho de receptor de webhooks está correto?

- A. Fazer o parse do JSON, serializá-lo de novo, verificar o HMAC sobre o resultado, processar o pagamento na hora e então responder `200`
- B. Responder `500` para eventos duplicados, para que o provedor pare de enviá-los
- C. Pular a verificação de assinatura se a requisição chega por HTTPS
- D. Verificar o HMAC sobre o **corpo bruto** (com o timestamp e uma comparação em tempo constante), gravar o evento com um id de evento único, enfileirá-lo, responder `2xx` imediatamente e aplicá-lo num worker como uma transição de estado monotônica

??? success "Resposta"
    **D — Verificar, deduplicar, confirmar rápido, processar de forma assíncrona.**

    JSON serializado de novo (A) muda os bytes e quebra a assinatura; processar na hora causa timeouts e retries do provedor. HTTPS (C) protege o canal, não a identidade de quem envia. Responder `500` (B) faz o provedor tentar *mais*. Duplicatas devem receber `2xx` e ser ignoradas.

---

**Q16 (bônus).** Webhooks e chaves de idempotência já estão implementados. Por que a BoxOffice ainda roda um job de **reconciliação** contra os relatórios do provedor?

- A. Para recalcular a taxa de câmbio de cada pagamento
- B. Porque o provedor exige isso para a chave de API continuar válida
- C. Porque webhooks podem se perder depois que os retries do provedor acabam, estornos podem ser feitos no painel do provedor, bugs podem pular atualizações, e tarifas e chargebacks só aparecem nos relatórios — os dois lados precisam ser comparados e as diferenças resolvidas
- D. Reconciliação só é necessária quando não há idempotência

??? success "Resposta"
    **C — Segurança por interação não garante que os registros batam.**

    A reconciliação compara os pagamentos da BoxOffice com os registros do provedor (um sweeper quase em tempo real para pagamentos travados, mais uma conferência diária do relatório), corrige automaticamente os tipos de divergência conhecidos (por exemplo, confirmar ou estornar um pagamento cujo webhook se perdeu) e envia o resto para uma fila de exceções.
