Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Por que o cache funciona e a matemática da taxa de acerto

**Q1.** A página do evento da BoxOffice recebe **40.000 leituras por segundo**. Com o cache atual, a taxa de acerto é **95%**. O time a melhora para **99%**. O que acontece com o número de leituras que chegam ao banco?

- A. Cai cerca de 4%, de 2.000 para 1.920 QPS
- B. Cai de 2.000 para 400 QPS — cinco vezes menos
- C. Cai de 38.000 para 39.600 QPS
- D. Não muda; a taxa de acerto só afeta a latência

??? success "Resposta"
    **B — De 2.000 para 400 QPS.**

    O banco recebe as faltas: $(1-h) \times \text{QPS}$. Com 95%, 0,05 × 40.000 = 2.000 QPS; com 99%, 0,01 × 40.000 = 400 QPS. Quatro pontos de taxa de acerto viraram um **corte de 5×** na carga do banco. Raciocine sempre com a **taxa de falta** — é o número que o banco sente.

---

**Q2.** Um acerto no cache custa **0,5 ms** e uma falta custa **10,5 ms** (consulta frustrada + banco). Qual é a latência média (efetiva) de uma leitura com taxa de acerto de **90%**?

- A. 0,5 ms
- B. 1,5 ms
- C. 5,5 ms
- D. 9,5 ms

??? success "Resposta"
    **B — 1,5 ms.**

    $t_{\text{eff}} = h \cdot t_{\text{hit}} + (1-h) \cdot t_{\text{miss}} = 0{,}9 \times 0{,}5 + 0{,}1 \times 10{,}5 = 0{,}45 + 1{,}05 = 1{,}5$ ms. Note que os 10% de faltas contribuem mais que o dobro dos 90% de acertos — e também definem a cauda (p95/p99) da latência.

---

**Q3.** Por que um cache que guarda apenas **1%** de um catálogo de 100.000 eventos consegue responder mais da metade das leituras?

- A. Porque o Redis comprime os valores, então 1% da memória guarda o catálogo inteiro
- B. Porque a popularidade é concentrada (aproximadamente Zipf): poucos itens recebem a maioria das requisições, e o cache guarda esses
- C. Porque o banco também tem um cache, então os dois juntos cobrem 100%
- D. Não consegue; um cache com 1% dos dados responde no máximo 1% das leituras

??? success "Resposta"
    **B — Popularidade concentrada.**

    Cargas web seguem distribuições do tipo Zipf: o item de posição $i$ é pedido com probabilidade ∝ $1/i^s$. Com $s \approx 1$, o 1% de itens mais populares recebe cerca de 60% das requisições. Com concentração fraca (muitos itens com popularidade parecida), o mesmo cache pequeno ajudaria bem menos — verifique o padrão de acesso antes de adicionar um cache.

---

**Q4.** Qual dado da BoxOffice **nunca** deve ser decidido a partir de um valor cacheado?

- A. A descrição do evento mostrada na página do evento
- B. A lista de eventos "deste fim de semana em São Paulo"
- C. Se o assento A-12 pode ser reservado para o fã que acabou de clicar nele
- D. O layout de assentos do local

??? success "Resposta"
    **C — A reserva do assento.**

    O mapa de assentos pode ser cacheado para exibição (um mapa defasado só produz uma mensagem de "lugar não disponível"), mas a **decisão** de dar o assento a um fã precisa ser tomada na fonte da verdade, numa transação SQL, ou dois fãs podem ficar com o mesmo lugar. Regra prática: cacheie o que você exibe, não aquilo sobre o que você decide.

---

## Padrões

**Q5.** Um organizador edita o evento 42. O serviço `catalog` usa cache-aside. Qual sequência de escrita é a escolha padrão e mais segura?

- A. Remover a chave do cache e depois atualizar o banco
- B. Atualizar o banco, fazer o commit e depois remover a chave do cache
- C. Atualizar o cache com o valor novo e depois atualizar o banco
- D. Atualizar o banco e o cache em qualquer ordem — os dois vão ficar iguais

??? success "Resposta"
    **B — Escrever no banco, fazer o commit e depois remover.**

    Remover primeiro (A) deixa um leitor recolocar no cache a linha antiga antes da atualização. Atualizar o cache (C, D) deixa escritores concorrentes se reordenarem: o banco termina com um valor e o cache com o outro. Remover depois do commit é idempotente e independe da ordem; a próxima leitura carrega a linha nova. Um TTL continua como rede de segurança para a corrida rara que ainda é possível.

---

**Q6.** Um gerente de produto quer contar **visualizações por evento** e mostrar "1.834 pessoas viram este evento hoje", com dezenas de milhares de incrementos por segundo. Qual padrão se encaixa melhor?

- A. Write-through no PostgreSQL a cada visualização
- B. Write-behind: `INCR` no Redis, descarregado no banco em lotes a cada poucos segundos
- C. Cache-aside com TTL de 5 minutos
- D. Write-around: gravar cada visualização no banco e nunca cachear

??? success "Resposta"
    **B — Write-behind.**

    Contadores são o caso clássico de write-behind: os incrementos são agrupados em memória e persistidos em lotes, protegendo o banco da taxa de escrita. Perder alguns segundos de contagem numa falha do cache é aceitável para esse dado. O mesmo padrão seria inaceitável para pedidos, pagamentos ou reservas de assento.

---

**Q7.** Qual é o principal risco do cache **write-behind** (write-back)?

- A. Leituras depois de uma escrita sempre erram
- B. Escritas já confirmadas ao cliente podem ser perdidas se o nó do cache falhar antes de descarregar no banco
- C. Exige um lock distribuído para cada leitura
- D. Não pode ser usado com Redis

??? success "Resposta"
    **B — Escritas confirmadas podem se perder.**

    O write-behind confirma a escrita quando ela chega à memória do cache; o banco só a recebe depois. Se o nó morrer (ou fizer failover com replicação assíncrona) antes do descarregamento, a escrita some, embora o cliente tenha sido informado de que deu certo.

---

## Invalidação e despejo

**Q8.** No cache-aside, o código já remove a chave depois de toda escrita. Por que os eventos cacheados **ainda** devem ter TTL?

- A. O Redis exige um TTL em toda chave
- B. Porque a invalidação explícita, em algum momento, vai deixar algo passar — uma corrida, um processo que caiu, um job em lote ou uma correção manual em SQL — e o TTL limita quanto tempo o valor velho vive
- C. Porque sem TTL a taxa de acerto seria 100%, o que sobrecarrega o Redis
- D. Não devem; um TTL só acrescenta faltas

??? success "Resposta"
    **B — O TTL é a rede de segurança.**

    A corrida do cache-aside (um leitor lento gravando um valor antigo depois da remoção do escritor), escritas que contornam a aplicação, ou um failover que perde um `DEL` deixam entradas velhas. Sem TTL, esses erros são permanentes. Com TTL, são limitados.

---

**Q9.** Um relatório noturno lê **todos** os eventos uma vez, em ordem de id, pelo mesmo cache usado pelo site. Na manhã seguinte, a taxa de acerto fica muito baixa nos primeiros minutos. Qual política de despejo provavelmente estava em uso, e o que resistiria a isso?

- A. LFU estava em uso; trocar por LRU
- B. LRU estava em uso; a varredura substituiu os itens quentes por itens lidos uma única vez. LFU ou W-TinyLFU (ou fazer o relatório ignorar o cache) resistiriam
- C. Despejo aleatório estava em uso; trocar por FIFO
- D. `noeviction` estava em uso; trocar por `volatile-ttl`

??? success "Resposta"
    **B — Poluição do LRU por varredura.**

    O LRU trata "lido uma vez há um segundo" como mais valioso que "lido mil vezes por minuto há um minuto", então uma varredura sequencial maior que o cache despeja todo o conjunto quente. Políticas baseadas em frequência (LFU, W-TinyLFU) mantêm os itens popularmente estáveis. A correção mais simples, muitas vezes, é manter as leituras em lote fora do cache compartilhado.

---

**Q10.** A BoxOffice roda 20 réplicas do `catalog`, cada uma com um cache em processo (L1) Caffeine na frente do Redis. Um organizador corrige um erro de digitação no nome do evento. Por que alguns usuários ainda podem ver o erro depois que o Redis foi invalidado, e o que resolve?

- A. O Redis replica de forma assíncrona; a solução é o `WAIT`
- B. O cache L1 de cada réplica ainda tem a própria cópia; resolva com um TTL curto no L1 e/ou uma invalidação difundida (pub/sub ou CDC) para todas as réplicas
- C. A CDN cacheou o banco; faça purge do banco
- D. O Caffeine ignora TTLs; troque-o por um `HashMap`

??? success "Resposta"
    **B — Vinte cópias privadas.**

    Remover a chave no Redis não alcança os 20 caches locais. Um cache em dois níveis precisa da sua própria invalidação: um TTL curto no L1 (aceitando alguns segundos de defasagem), uma mensagem difundida para cada réplica (pub/sub do Redis, client-side caching com rastreamento ou um pipeline de CDC), ou ambos.

---

## Modos de falha

**Q11.** A página do evento cacheada do show de estádio é lida **20.000 vezes por segundo**. Recalculá-la leva **200 ms**. Quando a chave expira e nada a protege, cerca de quantas requisições chegam ao banco com a mesma consulta?

- A. 1
- B. 20
- C. Cerca de 4.000
- D. 20.000 por segundo, para sempre

??? success "Resposta"
    **C — Cerca de 4.000 (um *stampede* de cache).**

    Pela lei de Little, as requisições que chegam durante a janela de recálculo = taxa × tempo = 20.000 × 0,2 s = 4.000, cada uma errando e executando a mesma consulta. Sob essa carga a consulta fica mais lenta, então o número real tende a ser maior. Correções: agrupamento de requisições, um lock/lease para que só uma recalcule, stale-while-revalidate ou expiração antecipada probabilística (XFetch).

---

**Q12.** Às 9h50 um job aquece o cache com as 5.000 páginas mais quentes, todas com `TTL = 600 s`. A abertura de vendas começa às 10h00. Qual é o problema e a correção?

- A. Nenhum problema; um cache aquecido é sempre bom
- B. As 5.000 chaves expiram juntas às 10h00, no pico — uma avalanche de cache. Acrescente jitter aleatório aos TTLs (por exemplo, 600 + aleatório 0–120 s)
- C. O TTL é longo demais; use 60 s
- D. As chaves serão despejadas pelo LRU antes das 10h00

??? success "Resposta"
    **B — Avalanche, corrigida com jitter no TTL.**

    Chaves escritas juntas com o mesmo TTL expiram juntas. Espalhar as expirações com jitter (e atualizar as chaves mais quentes antecipadamente) evita uma onda sincronizada de faltas no pior momento possível.

---

**Q13.** Bots pedem `GET /events/{id aleatório}` para ids que não existem, a 5.000 requisições por segundo. A taxa de acerto do cache está boa para o tráfego real, mas a carga no banco dispara. O que está acontecendo e o que ajuda?

- A. Chave quente; use replicação da chave
- B. Penetração de cache: ids inexistentes nunca são cacheados, então toda requisição chega ao banco. Valide a entrada, cacheie "não encontrado" com TTL curto, use um filtro de Bloom dos ids válidos e limite a taxa na borda
- C. Avalanche de cache; acrescente jitter ao TTL
- D. Chave grande; divida o valor

??? success "Resposta"
    **B — Penetração de cache.**

    Não há o que cachear para uma chave que não existe, então o cache-aside puro manda toda requisição desse tipo ao banco. O cache negativo guarda a ausência; um filtro de Bloom (~9,6 bits por id para 1% de falsos positivos) rejeita ids que certamente não existem antes de tocar o cache ou o banco.

---

## Redis

**Q14.** No Redis Cluster, um script Lua precisa atualizar `seats:42` e `prices:42` atomicamente, mas falha com erro `CROSSSLOT`. Qual é a correção?

- A. Aumentar o número de hash slots
- B. Renomear as chaves com uma hash tag, por exemplo `{event:42}:seats` e `{event:42}:prices`, para que só `event:42` entre no hash e as duas chaves caiam no mesmo slot
- C. Usar `KEYS *` para descobrir os slots antes
- D. Desligar o modo cluster para scripts Lua

??? success "Resposta"
    **B — Hash tags.**

    O Redis Cluster mapeia cada chave para um de 16.384 slots com `CRC16(key) mod 16384`; operações multichave exigem que todas as chaves estejam no mesmo slot. Com uma hash tag, só o texto dentro de `{...}` entra no hash. Escolha tags de alta cardinalidade (uma por evento), ou a tag vira um ponto quente.

---

**Q15.** Um colega propõe implementar as reservas de assento **apenas** no Redis com `SET hold:42:A-12 fan:1017 NX PX 600000`, replicado com Sentinel, para não tocar no PostgreSQL durante a venda relâmpago. Qual é a objeção mais forte?

- A. `SET NX` não é atômico
- B. A replicação do Redis é assíncrona: depois de um failover o novo primário pode não ter uma reserva já concedida, e o assento pode ser concedido de novo — a decisão precisa ficar no banco, com o Redis apenas como pré-filtro rápido
- C. O Redis não aceita chaves com dois-pontos
- D. `PX` só aceita segundos

??? success "Resposta"
    **B — A replicação assíncrona pode perder reservas confirmadas.**

    `SET NX` é atômico num nó, o que o torna um ótimo **filtro**, que rejeita a maioria dos cliques concorrentes em microssegundos. Mas um failover, um despejo ou um flush podem apagar uma reserva silenciosamente, e então dois fãs podem ter sucesso. A reserva do assento é feita numa transação SQL com uma restrição que torna a venda dupla impossível; o Redis só reduz quantas requisições chegam até ela.
