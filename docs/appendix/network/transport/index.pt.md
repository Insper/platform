
Um endereço IP leva o pacote à máquina certa; a **camada de transporte** o leva ao programa certo nessa máquina, e decide o que acontece quando um pacote se perde. Neste curso todo serviço escuta numa porta (`8080` para uma aplicação Spring Boot, `5432` para o PostgreSQL), toda linha `ports:` de um `compose.yaml` mapeia uma porta em outra, e a maioria das chamadas entre serviços anda sobre TCP — enquanto o DNS, e o HTTP/3, andam sobre UDP. Esta página trata das portas, da diferença entre TCP e UDP, do handshake que abre uma conexão TCP e de quanto custa a confiabilidade do TCP quando a rede perde pacotes.

---

## Portas { #ports }

Um endereço IP identifica um **host**; uma **porta** identifica um **processo** específico nesse host. Juntos, `IP:porta` (chamado de *endereço de socket*) identificam um ponto de comunicação na rede.

As portas são números de 16 bits (0–65535) divididos em três faixas[^1]:

| Faixa | Nome | Uso |
|---|---|---|
| 0–1023 | Portas de sistema (bem conhecidas) | Serviços padrão; no Linux, ocupar uma exige root (ou a capability `CAP_NET_BIND_SERVICE`) |
| 1024–49151 | Portas de usuário (registradas) | Registradas na IANA para aplicações comuns |
| 49152–65535 | Portas dinâmicas (efêmeras) | Atribuídas a clientes para conexões de saída |

### Portas bem conhecidas { #well-known }

| Porta | Protocolo | Serviço |
|---|---|---|
| 22 | TCP | SSH (shell seguro) |
| 25 | TCP | SMTP (envio de e-mail) |
| 53 | UDP/TCP | DNS |
| 80 | TCP | HTTP |
| 443 | TCP (UDP no HTTP/3) | HTTPS |
| 3000 | TCP | Grafana / servidores de desenvolvimento Node.js |
| 3306 | TCP | MySQL |
| 5432 | TCP | PostgreSQL |
| 6379 | TCP | Redis |
| 8080 | TCP | HTTP (servidores de desenvolvimento, HTTP alternativo) |
| 9090 | TCP | Prometheus |

### Portas efêmeras e conexões { #ephemeral }

Um servidor escuta numa porta fixa; o lado do cliente recebe uma temporária. Quando um navegador se conecta a `https://example.com`, ele se conecta à porta `443` do endereço do servidor, e o sistema operacional escolhe uma **porta efêmera** (por exemplo, `52413`) para o lado do cliente, de modo que a conexão completa é `ip_cliente:52413 ↔ ip_servidor:443`. Cada sistema operacional escolhe da sua própria faixa: a IANA sugere 49152–65535, enquanto o Linux usa 32768–60999 por padrão[^2].

Uma conexão é identificada por quatro números — IP e porta de origem, IP e porta de destino —, então uma única porta de servidor comporta milhares de conexões ao mesmo tempo, uma por socket de cliente. Você pode listar as portas em que a sua máquina está escutando:

```bash
ss -tlnp                         # Linux: TCP sockets in LISTEN state, with the process
lsof -iTCP -sTCP:LISTEN -n -P    # macOS (and Linux)
```

No Docker, `ports: - "8081:8080"` significa "a porta 8081 do host encaminha para a porta 8080 do contêiner": o serviço lá dentro continua escutando na sua própria porta, e o host a publica sob outra ([Endereçamento e NAT](../addressing/index.md#docker)).

---

## TCP e UDP { #tcp-udp }

A camada de Transporte oferece dois modelos de entrega fundamentalmente diferentes:

=== "TCP — Transmission Control Protocol"

    O TCP estabelece uma **conexão** antes de trocar dados e garante que[^3]:

    - Cada byte é entregue exatamente uma vez, em ordem
    - Pacotes perdidos são retransmitidos automaticamente
    - O emissor desacelera se o receptor ou a rede estiverem sobrecarregados (controle de fluxo e de congestionamento)

    **Use quando:** a correção importa mais que a velocidade — HTTP/1.1 e HTTP/2, conexões de banco de dados, SSH, brokers de mensagens.

=== "UDP — User Datagram Protocol"

    O UDP envia **datagramas** sem estabelecer conexão, sem garantia de entrega e sem ordenação[^4].

    - Sem handshake — menor latência
    - Sem retransmissão — se um pacote se perde, está perdido
    - A aplicação precisa cuidar da ordenação e da confiabilidade, se precisar delas

    **Use quando:** um pacote atrasado não vale nada ou a aplicação traz a sua própria confiabilidade — consultas DNS, chamadas de vídeo, jogos online, VoIP e o QUIC (o transporte por baixo do HTTP/3).

| | TCP | UDP |
|---|---|---|
| **Conexão** | Obrigatória (handshake de 3 vias) | Nenhuma |
| **Garantia de entrega** | Sim — retransmite pacotes perdidos | Não |
| **Ordenação** | Sim — os bytes chegam em sequência | Não |
| **Latência** | Maior: uma ida e volta para conectar, e espera pelos dados perdidos | Menor |
| **Casos de uso** | HTTP/1.1, HTTP/2, SSH, bancos de dados | DNS, vídeo, VoIP, jogos, QUIC / HTTP/3 |

---

## O three-way handshake { #handshake }

Antes de qualquer dado trafegar, cliente e servidor TCP combinam os números de sequência iniciais — os contadores que cada lado usa para numerar os seus bytes, para que o outro possa confirmá-los e perceber o que falta:

``` diagram-sim
sequenceDiagram
    participant C as Cliente<br/>porta efêmera 52413
    participant S as Servidor<br/>porta 443
    C->>S: SYN (seq = x)
    S-->>C: SYN-ACK (seq = y, ack = x+1)
    C->>S: ACK (ack = y+1) + primeiros dados (requisição)
    Note over C,S: conexão estabelecida após uma ida e volta
    S-->>C: dados (resposta), ack = bytes recebidos até agora
    C->>S: ACK
```

O handshake custa **uma ida e volta** antes que o primeiro byte da requisição saia do cliente. O HTTPS acrescenta um handshake TLS por cima — mais uma ida e volta com TLS 1.3[^5]. Num caminho São Paulo – Virgínia de 77 ms, são uns 150 ms antes mesmo de a requisição ser enviada, e é por isso que clientes e serviços reaproveitam conexões (HTTP keep-alive, pools de conexão) em vez de abrir uma nova a cada requisição.

Uma porta em que ninguém escuta responde ao SYN com um reset (RST): é o erro "connection refused". Um SYN que não recebe resposta nenhuma (um firewall o descartou, o host está fora do ar) é repetido até o cliente desistir: um "timeout".

---

## Quanto custa a confiabilidade { #reliability-cost }

A garantia do TCP tem um preço, e ele é pago em tempo. O emissor guarda cada segmento até o receptor confirmá-lo. Se nenhuma confirmação chega antes de o **timer de retransmissão** (RTO) acabar, ele envia o segmento de novo e dobra o timer para a próxima tentativa[^6]. Enquanto isso, o receptor talvez já tenha os segmentos que vieram depois do perdido — mas o TCP promete bytes *em ordem*, então não pode entregá-los à aplicação ainda. Um segmento perdido segura tudo o que vem atrás dele: o **bloqueio de cabeça de fila** (head-of-line blocking).

O UDP não paga nada disso: o que chega é entregue na hora, e o que se perde continua perdido. Compare os dois no mesmo enlace, com as mesmas perdas:

<div class="csim" data-sim="tcp" data-loss="10" data-seed="4"></div>

!!! tip "Experimente"
    A execução começa com 10% de perda, e os segmentos 4 e 7 se perdem. Aperte play. O UDP termina em 230 ms com 18/20 segmentos — duas lacunas que nunca são preenchidas. O TCP entrega os 20, em ordem, em 380 ms: 2 retransmissões, e 15 segmentos que já tinham chegado esperaram no buffer atrás do segmento 4. Ponha a perda em 0%: o UDP termina em 230 ms e o TCP em 310 ms — a diferença de 80 ms é a ida e volta do handshake. Com 20%, uma retransmissão também se perde e o timer dobra: 3 retransmissões, fim em 780 ms. Com 30%, o UDP fica com só 16/20, enquanto o TCP precisa de 7 retransmissões e 1.540 ms.

O simulador mantém só o timer. O TCP real também retransmite mais cedo quando confirmações duplicadas revelam uma lacuna (*fast retransmit*), e reduz a taxa de envio quando percebe perdas (*controle de congestionamento*) — então, numa rede com perdas, a vazão cai, não só a latência. O bloqueio de cabeça de fila também é o motivo de o HTTP/3 ter migrado para o **QUIC**, que roda sobre UDP e retransmite por stream: um pacote perdido de uma resposta não trava mais as outras que compartilham a conexão[^7].

---

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - Uma porta escolhe o processo num host; `IP:porta` é um endereço de socket, e uma conexão é identificada pelos endereços e portas das duas pontas.
    - Servidores escutam em portas fixas; clientes recebem uma porta efêmera do sistema operacional (32768–60999 no Linux).
    - O TCP abre uma conexão com um three-way handshake (uma ida e volta) e depois entrega cada byte, uma vez, em ordem.
    - Confiabilidade custa tempo: um segmento perdido espera o timer de retransmissão, e os segmentos atrás dele esperam junto (bloqueio de cabeça de fila).
    - O UDP entrega o que chega, sem preparação e sem espera; DNS, mídia em tempo real e o QUIC (HTTP/3) se apoiam nele.

---

[^1]: [IANA Service Name and Transport Protocol Port Number Registry](https://www.iana.org/assignments/service-names-port-numbers/service-names-port-numbers.xhtml){target="_blank"}; [RFC 6335](https://datatracker.ietf.org/doc/html/rfc6335){target="_blank"}
[^2]: [IP sysctl, `ip_local_port_range` — documentação do kernel Linux](https://docs.kernel.org/networking/ip-sysctl.html){target="_blank"}
[^3]: [RFC 9293 — Transmission Control Protocol (TCP)](https://datatracker.ietf.org/doc/html/rfc9293){target="_blank"}
[^4]: [RFC 768 — User Datagram Protocol](https://datatracker.ietf.org/doc/html/rfc768){target="_blank"}
[^5]: [RFC 8446 — TLS 1.3](https://datatracker.ietf.org/doc/html/rfc8446){target="_blank"}
[^6]: [RFC 6298 — Computing TCP's Retransmission Timer](https://datatracker.ietf.org/doc/html/rfc6298){target="_blank"}
[^7]: [RFC 9000 — QUIC](https://datatracker.ietf.org/doc/html/rfc9000){target="_blank"}; [RFC 9114 — HTTP/3](https://datatracker.ietf.org/doc/html/rfc9114){target="_blank"}
