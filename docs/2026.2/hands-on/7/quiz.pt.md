Clique em **"Resposta"** para ver a resposta correta e a explicação.

---

## Balanceador de carga

**Q1.** Qual é o papel do **Nginx** neste hands-on?

- A. Atua como registro de serviços (service registry), acompanhando quais réplicas do gateway estão vivas
- B. Faz a terminação TLS e descriptografa o tráfego HTTPS antes de encaminhá-lo ao gateway
- C. É um proxy reverso e balanceador de carga de camada 7 que recebe todo o tráfego externo (porta 8080 do host, porta 80 do Nginx) e o distribui entre as réplicas do gateway
- D. Substitui o serviço de gateway, roteando diretamente para os microsserviços

??? success "Resposta"
    **C — Proxy reverso e balanceador de carga L7.**

    O Nginx fica na borda: todo o tráfego externo chega ao Nginx (o serviço `lb`, porta 8080 do host → porta 80). Ele inspeciona a requisição HTTP e a encaminha para uma das réplicas do gateway, de acordo com o algoritmo configurado. As réplicas do gateway não têm portas expostas — só são acessíveis de dentro da rede Docker, através do Nginx.

---

**Q2.** O que `least_conn`, no bloco `upstream` do Nginx, configura?

- A. O número mínimo de conexões saudáveis exigido antes de o upstream ser usado
- B. O algoritmo de balanceamento de carga — cada nova requisição vai para o backend com menos conexões ativas
- C. O número máximo de conexões simultâneas que o Nginx aceita dos clientes
- D. A política de remoção LRU (menos recentemente usado) dos caches de conexões upstream

??? success "Resposta"
    **B — Algoritmo de menos conexões ativas.**

    Com `least_conn`, o Nginx acompanha quantas requisições cada réplica do gateway está processando no momento e roteia a próxima requisição para a que tiver a menor contagem. Isso é melhor que o round-robin para requisições de duração variável — evita que uma réplica lenta acumule uma fila.

---

**Q3.** Depois de escalar o gateway para 5 réplicas, por que o Nginx precisa ser **recarregado**?

- A. O Nginx faz cache das respostas HTTP e precisa limpá-lo quando os backends mudam
- B. O escalonamento cria novas redes Docker que o Nginx não consegue detectar automaticamente
- C. O Nginx resolve o DNS de `gateway` uma única vez na inicialização e guarda em cache todos os IPs retornados; um reload força uma nova consulta ao DNS do Docker para descobrir os IPs das novas réplicas
- D. As novas réplicas usam portas diferentes, que o Nginx precisa ser configurado para aceitar

??? success "Resposta"
    **C — DNS resolvido uma vez na inicialização; o reload força uma nova consulta.**

    O bloco `upstream` do Nginx resolve o hostname `gateway` quando os processos worker iniciam e guarda em cache os endereços IP resultantes. Ao escalar para 5 réplicas, o Docker atribui novos IPs aos novos containers, mas o Nginx continua usando os 3 IPs originais da inicialização. Executar `nginx -s reload` faz o Nginx resolver `gateway` novamente, descobrindo os 5 IPs.

---
