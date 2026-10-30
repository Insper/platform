Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

**Q1.** No **cache-aside**, quem escreve um valor no cache?

- A. O banco, por meio de um trigger
- B. A aplicação, depois de um miss: ela carrega do banco e guarda o resultado com um TTL
- C. O Redis, automaticamente, lendo o banco
- D. O cliente

??? success "Resposta"
    **B — A aplicação, sob demanda.**

    O cache só contém o que foi pedido recentemente. O read-through leva o carregamento para a camada de cache; o write-through escreve no cache a cada atualização. O cache-aside é o mais simples e o mais comum.

---

**Q2.** Com um hit ratio de 90%, que fração das leituras chega ao PostgreSQL? E com 99%?

- A. 90% e 99%
- B. 10% e 1%
- C. 9% e 0,9%
- D. 50% e 5%

??? success "Resposta"
    **B — 10% e 1%.**

    Ir de 90% para 99% de hit ratio divide a carga no banco por dez. Pequenas melhorias em hit ratios altos valem muito — e é por isso que a popularidade concentrada (poucas chaves muito quentes) torna os caches tão eficazes.

---

**Q3.** Por que o `catalog` **remove** a chave do evento numa atualização em vez de escrever o novo valor no cache?

- A. O Redis não consegue sobrescrever chaves
- B. Atualizações concorrentes poderiam escrever no cache numa ordem diferente da dos commits no banco, deixando um valor antigo em cache; apagar é idempotente e a próxima leitura carrega o estado confirmado
- C. Remover é mais rápido que escrever
- D. Para reduzir o uso de memória

??? success "Resposta"
    **B — Evitar corridas de ordenação.**

    Mesmo a remoção tem uma corrida estreita (um leitor lento recolocando em cache um valor antigo depois da remoção), e é por isso que toda chave também tem um TTL: o TTL limita quanto tempo qualquer inconsistência pode durar.

---

**Q4.** As chaves de listagem não são removidas nas atualizações. Qual é a consequência?

- A. As listagens estão sempre erradas
- B. Uma listagem pode mostrar dados antigos por até `CACHE_TTL_LIST` (10 s + jitter): defasagem limitada, aceita para não ter de rastrear quais páginas de listagem contêm cada evento
- C. As atualizações falham
- D. O Redis fica sem memória

??? success "Resposta"
    **B — Defasagem limitada por design.**

    Um evento aparece em muitas páginas de listagem (cidade, página, tamanho). Uma invalidação precisa exigiria um índice de evento para chaves. Um TTL curto é um trade-off simples e explícito — declare-o numa revisão de design.

---

**Q5.** O Redis é parado. O que o `catalog` faz na implementação deste lab?

- A. Devolve `503 Service Unavailable`
- B. Trava por 60 s a cada requisição
- C. Trata todo erro do cache como miss e atende pelo PostgreSQL (com timeouts de 200 ms no Redis), então fica mais lento, mas funciona
- D. Passa a usar um cache em memória

??? success "Resposta"
    **C — O cache é uma otimização, não uma dependência.**

    Mas cuidado: se o cache absorvia 95% das leituras, a falha dele manda 20× a carga normal para o banco — que pode cair. Planeje a capacidade do banco (ou o descarte de carga) para uma queda do cache.

---

**Q6.** Por que acrescentar **jitter** ao TTL?

- A. Para que as chaves expirem em ordem aleatória, por segurança
- B. Chaves escritas ao mesmo tempo (uma partida a frio, uma carga em massa) expirariam ao mesmo tempo e causariam uma onda sincronizada de misses
- C. O Redis exige
- D. Para economizar memória

??? success "Resposta"
    **B — Dessincronizar as expirações.**

    O jitter espalha as expirações por uma janela. Ele não resolve uma única chave quente expirando — isso é o stampede, que precisa de um lock, de atualização antecipada ou de stale-while-revalidate.

---

**Q7.** No teste de stampede sem proteção, `cache_misses` é 3.000 em um minuto com um TTL de 3 s. Com proteção, é ~20. O que cada miss representa?

- A. Uma requisição que falhou
- B. Uma execução da consulta cara de listagem no PostgreSQL
- C. Uma remoção no Redis
- D. Uma iteração do k6 que deu timeout

??? success "Resposta"
    **B — Uma consulta pesada cada.**

    20 expirações por minuto deveriam custar 20 consultas. Sem coordenação, toda requisição que chega durante a recarga roda a sua própria cópia; o lock as junta em uma só ("single flight").

---

**Q8.** Por que o lock tem uma expiração (`PX 2000`)?

- A. O Redis exige que toda chave expire
- B. Se a requisição que tem o lock cair, o lock se libera sozinho e outra requisição pode reconstruir o valor; sem expiração, a chave poderia ficar travada para sempre
- C. Para deixar o lock mais rápido
- D. Para contar requisições

??? success "Resposta"
    **B — Vivacidade do lock.**

    E dimensione-o acima do p99 da consulta: se o trabalho demorar mais do que o lock vive, um segundo carregador entra. A liberação precisa conferir o token, para que uma requisição nunca apague o lock de outra (de forma atômica, com um script Lua, em produção).

---

**Q9.** O cache é **compartilhado** no Redis em vez de um `HashMap` local em cada réplica. Que vantagem você observou?

- A. O Redis é mais rápido que um HashMap
- B. Um valor carregado por uma réplica é hit para as outras, e todas as réplicas veem a mesma versão (uma remoção invalida em todo lugar)
- C. Caches locais não podem ter TTLs
- D. O Redis comprime JSON

??? success "Resposta"
    **B — Um cache para todas as réplicas.**

    Caches locais são mais rápidos (sem salto de rede), mas cada réplica aquece separadamente e elas podem discordar. Muitos sistemas usam os dois: um cache local minúsculo com TTL curto para as chaves mais quentes, na frente do compartilhado.

---

**Q10.** O HOT_SHARE cai de 0,8 para 0,2 (popularidade quase uniforme entre 200.000 eventos). O que acontece com o hit ratio dos detalhes, e por quê?

- A. Aumenta, porque mais chaves ficam em cache
- B. Cai muito: com um TTL de 60 s e acesso uniforme, a maioria dos eventos não é pedida de novo antes de a sua chave expirar
- C. Fica igual; o Redis dá conta
- D. Vira 100% depois do aquecimento

??? success "Resposta"
    **B — Caches se alimentam de concentração.**

    O hit ratio depende de quantas vezes a mesma chave é pedida dentro do seu TTL. Acesso uniforme sobre um espaço de chaves grande derrota o cache; para essas cargas, torne a própria consulta barata (lab 6) ou faça cache numa granularidade maior.
