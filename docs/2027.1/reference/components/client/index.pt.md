# Cliente { #client }

Todo projeto começa e termina em um **cliente**: o programa que envia a primeira requisição e espera o último byte da resposta. No playground, os nós de cliente são onde o tráfego nasce — o perfil de carga (smoke, load, stress, spike, soak, breakpoint, chaos) decide quantas requisições por segundo saem deles. No BoxOffice, os clientes são os navegadores dos fãs e o aplicativo móvel: em um dia normal eles navegam pelo catálogo; às 10:00 de um dia de venda relâmpago, 2 M deles apertam "Comprar" no mesmo minuto.

Pensar no cliente não é formalidade. Onde o cliente está (latência até a sua borda), o que ele consegue fazer (cache, retry, manter uma conexão aberta) e como ele se comporta diante de falhas (tenta de novo na hora? o usuário martela o F5?) molda todo o projeto que está atrás dele.

| Componente | Em uma frase | Id no playground |
|---|---|---|
| [Client](#client) | Um navegador ou qualquer programa chamando a sua API pela internet | `client` |
| [Mobile](#mobile) | Um app nativo no celular: rede instável, modo offline, notificações push, ciclo de release lento | `mobile` |

``` diagram
flowchart LR
    B[Client<br/>navegador / SDK] --> DNS
    M[Mobile<br/>iOS / Android] --> DNS
    DNS --> CDN
    CDN --> LB[Load Balancer]
    LB --> APP[App Server]
```

---

## Client { #client }

**O que é.** O cliente genérico: um navegador web, uma ferramenta de linha de comando, o backend de outra empresa ou uma ferramenta de teste de carga como o k6. Ele abre conexões (TCP + TLS, ou QUIC), envia requisições HTTP e espera as respostas. Está fora do seu controle — você não consegue corrigi-lo, não pode confiar nele e ele pode estar do outro lado do planeta.

**Quando usar.**

- Como ponto de entrada de todo projeto no playground: o nó de cliente *é* a carga de trabalho (requisições por segundo, mistura leitura/escrita, popularidade das chaves).
- Para raciocinar sobre a latência **percebida pelo usuário**: o número que importa é medido no cliente, incluindo DNS, handshakes TLS e as idas e voltas até a sua borda.
- Para decidir o que pode ser empurrado para o cliente: arquivos estáticos em cache no navegador (`Cache-Control`), renderização no cliente, chaves de idempotência geradas pelo cliente, backoff exponencial no SDK.

**Quando não usar (ou cuidado).**

- Nunca coloque no cliente regras de negócio ou segredos que precisem ser confiáveis: preço, disponibilidade de assentos e autorização devem ser validados no servidor.
- Não presuma que os clientes se comportam: um botão "Comprar" sem debounce, um laço de retry sem backoff ou um robô raspando o site podem multiplicar a sua carga.
- Não dimensione o sistema pelo cliente médio; dimensione pelo **pico** (venda relâmpago) e pela pior rede (3G móvel dentro de um estádio).

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Ida e volta São Paulo ↔ leste dos EUA | ≈ 110–130 ms | Velocidade da luz na fibra mais roteamento; um handshake TLS 1.3 custa uma ida e volta a mais |
| Ida e volta na mesma cidade / até um edge de CDN próximo | ≈ 5–20 ms | Por que CDNs e terminação na borda importam |
| Conexões paralelas do navegador por host (HTTP/1.1) | 6 | HTTP/2 e HTTP/3 multiplexam muitas requisições em uma conexão |
| Carregamento que o usuário percebe como "instantâneo" | ≈ 100 ms | Diretriz clássica de usabilidade (Nielsen); ≈ 1 s mantém o fluxo de pensamento |
| Pico da venda relâmpago (BoxOffice) | 2 M fãs em ≈ 1 min ≈ 33 mil sessões novas/s | ≈ suposição ilustrativa usada em todo o curso |

**Modos de falha.**

- **Tempestade de retries** — clientes (ou usuários apertando F5) tentam de novo imediatamente após erros e multiplicam a carga durante uma pane → backoff exponencial com jitter no SDK, cabeçalho `Retry-After`, sala de espera.
- **Manada no horário marcado** — todos os clientes acordam às 10:00:00 → início com atraso aleatório, admissão por fila (sala de espera), caches pré-aquecidos.
- **Envios duplicados** — clique duplo ou timeout + retry criam dois pedidos → chaves de idempotência geradas pelo cliente e deduplicadas no servidor.
- **Cache velho no cliente** — o navegador mantém um bundle JavaScript antigo → nomes de arquivo com hash do conteúdo, TTL curto no HTML.
- **Clientes maliciosos** — robôs, credential stuffing, cambistas → WAF, rate limiting, CAPTCHA/prova de trabalho, autenticação.

**No playground.** O nó `client` é uma **fonte** de tráfego, não um servidor: ele não tem capacidade. As chegadas a cada tick seguem um processo de Poisson cuja taxa λ(t) vem do perfil de carga e do **RPS alvo** da barra de ferramentas. Seus parâmetros principais são `readRatio` (fração de leituras; o padrão da barra de ferramentas é 0,9), `zipfS` (assimetria da popularidade das chaves, padrão 0,8, usada por caches e partições para criar chaves quentes), `botShare` (tráfego extra de robôs, padrão 0) e `timeoutMs` (a paciência do usuário, padrão 30 s). Os percentis de latência e a taxa de erro do painel de métricas são medidos do ponto de vista do cliente. Todo cenário começa aqui; bons primeiros cenários: [`monolith`](../../../../playground/scenarios/index.md#monolith), [`scale-out`](../../../../playground/scenarios/index.md#scale-out), [`flash-sale`](../../../../playground/scenarios/index.md#flash-sale).

**Produtos reais.**

=== "AWS"

    - **AWS SDKs** — bibliotecas cliente oficiais com retries, backoff exponencial e jitter embutidos.
    - **CloudWatch Synthetics** — clientes "canário" programados que testam seus endpoints a partir de regiões da AWS.

=== "GCP"

    - **Google Cloud client libraries** — SDKs oficiais com políticas configuráveis de retry e timeout.
    - **Cloud Monitoring uptime checks** — clientes sintéticos que testam endpoints HTTP de vários locais.

=== "Azure"

    - **Azure SDKs** — bibliotecas cliente oficiais com políticas de retry.
    - **Azure Load Testing** — serviço gerenciado que executa clientes JMeter/Locust em escala.

=== "Código aberto"

    - **k6** — cliente de teste de carga programável (JavaScript), usado nos labs do curso.
    - **curl / HTTPie** — clientes HTTP de linha de comando para testes manuais rápidos.
    - **Locust, Gatling, JMeter** — outros clientes geradores de carga.

!!! tip "Na entrevista"
    Comece todo projeto nomeando os clientes e onde eles estão: "clientes web e mobile no Brasil, pico de 33 mil sessões/s no momento da abertura das vendas". Depois diga o que o cliente faz para ajudar — cache de conteúdo estático, envio de chave de idempotência, backoff ao receber `429`/`503` — e o que você nunca confia a ele (preço, autorização).

**Saiba mais:** [Intro › Requisitos](../../../classes/intro/requirements/index.md) · [Estimativas › Números](../../../classes/estimation/numbers/index.md) · [Borda › Protocolos](../../../classes/edge/protocols/index.md) · [Performance › Testes de carga](../../../classes/performance/load-testing/index.md) · [Hands-on 2](../../../hands-on/2/index.md)

---

## Mobile { #mobile }

**O que é.** Um aplicativo nativo (iOS, Android) ou um app web móvel em um celular. É um cliente com restrições extras: a rede muda o tempo todo (Wi-Fi → 4G → sem sinal no túnel do estádio), a bateria é preciosa, a versão do app nas mãos dos usuários pode ter meses e o sistema operacional pode matá-lo a qualquer momento. Em troca, ele pode guardar dados localmente, funcionar offline e receber **notificações push**.

**Quando usar.**

- Quando o produto precisa de notificações push (BoxOffice: "seus ingressos estão prontos", "os portões abrem em 1 hora").
- Quando a experiência precisa sobreviver a redes ruins: ingressos guardados no aparelho e exibidos offline na catraca (QR code).
- Para modelar uma segunda fonte de tráfego com outra mistura: clientes móveis costumam fazer mais requisições, menores, e reconectar com frequência.

**Quando não usar (ou cuidado).**

- Versões antigas do app vivem por muito tempo: nunca quebre uma API usada por um app já publicado; versione a API e mantenha compatibilidade retroativa.
- Não converse demais com o backend: cada requisição em rede móvel custa latência e bateria → agrupe chamadas, use um BFF (Backend for Frontend) que devolve exatamente o que uma tela precisa.
- Não embarque segredos no binário do app (chaves de API podem ser extraídas); use OAuth 2.1 com PKCE (Proof Key for Code Exchange).

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Ida e volta em 4G | ≈ 30–100 ms | Varia muito com o sinal e a operadora |
| Ida e volta em 3G / célula congestionada | ≈ 100–500 ms | Um estádio cheio de celulares é uma célula congestionada |
| Ida e volta em 5G | ≈ 10–30 ms | Melhor caso; a cobertura é desigual |
| Entrega de notificação push (APNs/FCM) | normalmente segundos, melhor esforço | Sem garantia de entrega; não use push como único canal para informação crítica |
| Fatia de versões antigas do app em uso | pode passar de 10% por meses | ≈ ilustrativo; depende da política de atualização forçada |

**Modos de falha.**

- **Conexão cai no meio da requisição** — o app não sabe se a compra deu certo → chave de idempotência + um endpoint de status para consultar ("o pedido X foi concluído?").
- **Tempestade de reconexões** — depois de uma pane de rede ou do backend, milhões de apps reconectam ao mesmo tempo → atraso aleatório de reconexão com backoff exponencial e jitter.
- **Mudança incompatível na API** — uma versão antiga do app quebra → versionamento de API, testes de contrato, versão mínima suportada.
- **Relógio do aparelho errado** — o relógio do celular está errado e os tokens parecem expirados → valide o tempo no servidor, use timestamps do servidor.
- **Falha ou limitação do provedor de push** → trate push como melhor esforço e mantenha a informação disponível no app e por e-mail.

**No playground.** `mobile` é uma **fonte** de tráfego como `client`, com os mesmos parâmetros (`readRatio`, `zipfS`, `botShare`), mas um `timeoutMs` padrão menor (15 s em vez de 30 s), guiada pelo mesmo perfil de carga. Use-o ao lado de um nó `client` para modelar duas populações com misturas diferentes de leitura/escrita ou para encaminhá-las por caminhos diferentes (por exemplo, o mobile passando por um [API Gateway](../edge/index.md#apigw) que faz papel de BFF). Cenários: [`chat`](../../../../playground/scenarios/index.md#chat), [`ride-sharing`](../../../../playground/scenarios/index.md#ride-sharing), [`notification-system`](../../../../playground/scenarios/index.md#notification-system).

**Produtos reais.**

=== "AWS"

    - **AWS Amplify** — framework e hospedagem para front ends web e mobile com autenticação e APIs.
    - **Amazon SNS mobile push** — envia notificações push via APNs e FCM.
    - **AWS Device Farm** — testa apps em celulares reais.

=== "GCP"

    - **Firebase** — plataforma mobile (Google): Cloud Messaging (FCM) para push, Crashlytics, Remote Config, App Distribution.
    - **Firebase Test Lab** — executa testes do app em aparelhos reais e virtuais.

=== "Azure"

    - **Azure Notification Hubs** — notificações push para iOS, Android e Windows em escala.
    - **Azure App Service** — hospeda backends mobile.

=== "Código aberto"

    - **React Native, Flutter** — frameworks mobile multiplataforma.
    - **OkHttp (Android), URLSession (iOS)** — clientes HTTP com pool de conexões e HTTP/2.
    - **ntfy / Gotify** — servidores de notificação push auto-hospedados.

!!! tip "Na entrevista"
    "Clientes móveis estão em redes instáveis e rodam versões antigas, então mantenho a API retrocompatível, deixo toda escrita idempotente para que o app possa repetir com segurança e uso push só como um aviso de melhor esforço — a fonte da verdade é sempre o servidor."

**Saiba mais:** [Borda › Protocolos](../../../classes/edge/protocols/index.md) · [Computação › Estilos de API](../../../classes/compute/api-styles/index.md) · [Rede e segurança › Identidade](../../../classes/edge/identity/index.md) · [Estudo de caso: chat](../../../classes/case-studies/chat/index.md) · [Estudo de caso: sistema de notificações](../../../classes/case-studies/notification-system/index.md)
