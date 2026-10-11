
Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Docker

**Q1.** Qual é a diferença essencial entre uma **imagem** Docker e um **container**?

- A. Uma imagem roda em primeiro plano; um container roda em segundo plano
- B. Uma imagem é um snapshot imutável; um container é uma instância em execução dessa imagem
- C. Uma imagem inclui o kernel do SO hospedeiro; um container usa seu próprio kernel
- D. Uma imagem fica armazenada no registry; um container fica armazenado no sistema de arquivos do host

??? success "Resposta"
    **B — Imagem = snapshot imutável; container = instância em execução.**

    Uma imagem é construída uma vez a partir de um Dockerfile e armazenada como um artefato somente leitura. Um container é um processo vivo criado a partir dessa imagem — ele tem sua própria camada gravável sobre as camadas da imagem. Vários containers podem rodar a partir da mesma imagem simultaneamente, sem interferir uns nos outros.

---

**Q2.** Qual é o principal benefício de um build com **Dockerfile multi-stage**?

- A. Ele executa todas as etapas de build em paralelo, reduzindo o tempo total de build
- B. Ele permite usar várias imagens base simultaneamente em um mesmo container
- C. A imagem final contém apenas os artefatos de execução, e não o ferramental de build — gerando uma imagem menor e mais segura
- D. Ele permite que a mesma imagem rode em vários sistemas operacionais

??? success "Resposta"
    **C — Imagem final menor, sem o ferramental de build.**

    Em um projeto Java, a etapa de build precisa do Maven e do JDK; a execução precisa apenas do JRE e do JAR compilado. Builds multi-stage descartam tudo das etapas intermediárias — Maven, código-fonte, dependências de teste —, deixando uma imagem que pode ser 10× menor e com superfície de ataque reduzida.

---

**Q3.** Para aproveitar ao máximo o **cache de camadas** do Docker, onde `COPY src ./src` deve aparecer em relação à instalação das dependências?

- A. Antes — para que o código-fonte esteja disponível ao baixar as dependências
- B. Depois — mudanças no código-fonte invalidam apenas as camadas a partir do `COPY`, mantendo intacta a camada de dependências em cache
- C. Não faz diferença; o Docker faz cache de todas as camadas igualmente
- D. Logo no início, antes de qualquer outra instrução

??? success "Resposta"
    **B — Depois da instalação das dependências.**

    O Docker reconstrói todas as camadas a partir da primeira camada alterada. Se `COPY src` vier antes de `RUN mvn dependency:go-offline`, toda mudança no código-fonte força um novo download das dependências. Colocar a cópia do código depois da instalação das dependências faz com que o passo lento das dependências só seja reexecutado quando o `pom.xml` mudar.

---

**Q4.** Qual é a diferença entre um **volume nomeado** e um **bind mount**?

- A. Um volume nomeado é mais rápido; um bind mount é mais durável
- B. Um volume nomeado é gerenciado pelo Docker e persiste após a remoção do container; um bind mount mapeia um caminho específico do host para dentro do container
- C. Um bind mount exige o daemon do Docker; um volume nomeado não
- D. São idênticos — os termos são intercambiáveis

??? success "Resposta"
    **B — Volume nomeado = gerenciado pelo Docker e persistente; bind mount = caminho específico do host.**

    Volumes nomeados são criados e gerenciados pelo Docker, sobrevivem ao `docker rm` e funcionam de forma portátil entre hosts. Bind mounts expõem diretamente um diretório do host — úteis no desenvolvimento para hot-reload (as mudanças no host aparecem imediatamente no container), mas presos à estrutura do sistema de arquivos do host.

---

**Q5.** Qual driver de rede do Docker permite que containers na mesma rede se alcancem pelo **nome do serviço**?

- A. `host` — os containers compartilham a pilha de rede do host
- B. `none` — os containers ficam totalmente isolados
- C. `overlay` — usado em redes multi-host no modo Swarm
- D. `bridge` (padrão) — containers na mesma rede bridge resolvem uns aos outros pelo nome do container

??? success "Resposta"
    **D — `bridge` (padrão).**

    A rede bridge padrão do Docker inclui um servidor DNS embutido que resolve nomes de containers para seus endereços IP. É assim que os serviços no Docker Compose se alcançam pelo nome do serviço (`db`, `app`, `gateway`) sem nenhum endereço IP fixo no código.

---

## Docker Compose

**Q6.** O que `depends_on` com `condition: service_healthy` faz que o `depends_on` simples não faz?

- A. Define um timeout depois do qual o serviço dependente inicia de qualquer forma
- B. Atrasa o serviço dependente até que a dependência passe no seu `healthcheck`, e não apenas até o processo do container iniciar
- C. Faz o Compose reiniciar a dependência se ela ficar não saudável depois da inicialização
- D. Executa a dependência em uma rede isolada separada

??? success "Resposta"
    **B — Espera o healthcheck passar, e não apenas o container iniciar.**

    O `depends_on` simples só espera que o container da dependência esteja *em execução* (processo iniciado). O processo do banco de dados pode estar rodando, mas ainda não pronto para aceitar conexões. `condition: service_healthy` espera até que o comando de `healthcheck` dentro da dependência retorne código de saída 0 — por exemplo, `pg_isready -U myapp`.

---

**Q7.** Por que credenciais **nunca** devem ficar fixas no `compose.yaml`?

- A. O Docker Compose não aceita valores em texto puro nos blocos de ambiente
- B. O Compose remove valores em texto puro durante a fase de build, por segurança
- C. Credenciais com commit no controle de versão são um incidente de segurança; arquivos `.env` permitem segredos por ambiente, fora do repositório
- D. Valores fixos impedem o serviço de lê-los em tempo de execução

??? success "Resposta"
    **C — Credenciais no controle de versão = incidente de segurança.**

    Uma vez que um segredo entra em um commit de um repositório — mesmo privado —, ele pode ser recuperado do histórico mesmo depois de apagado. Arquivos `.env` são adicionados ao `.gitignore` e nunca entram em commits, permitindo que cada ambiente (dev, homologação, produção) tenha segredos diferentes sem que eles jamais apareçam no código.

---

**Q8.** O que `docker compose down -v` faz que `docker compose down` não faz?

- A. Para os containers de forma mais forçada, usando `SIGKILL` em vez de `SIGTERM`
- B. Reconstrói todas as imagens antes de parar
- C. Remove também os volumes nomeados, apagando permanentemente todos os dados persistidos
- D. Remove a rede do projeto, mas mantém os containers parados

??? success "Resposta"
    **C — Remove também os volumes nomeados.**

    `docker compose down` para e remove containers e redes, mas mantém intactos os volumes nomeados (os dados do banco sobrevivem). Acrescentar `-v` remove também os volumes nomeados — apagando permanentemente todos os dados persistidos. Isso é irreversível, então use apenas quando realmente quiser começar do zero.

---

**Q9.** Dentro de uma rede do Docker Compose, como os serviços se endereçam?

- A. Pelo nome completo da imagem do container e sua tag
- B. Pelo endereço IP da máquina host e pela porta mapeada
- C. Pelo nome do serviço definido no `compose.yaml` — o Compose fornece resolução DNS por nome de serviço
- D. Pelo ID do container atribuído em tempo de execução

??? success "Resposta"
    **C — Pelo nome do serviço.**

    O Compose cria automaticamente uma rede e configura o DNS para que cada serviço seja alcançável pelo seu nome no `compose.yaml`. Uma aplicação Spring Boot configurada com `DATABASE_HOST: db` resolve `db` para o IP do container do PostgreSQL sem nenhuma configuração manual.

---

**Q10.** Quais dois mecanismos controlam a **ordem de inicialização** no Docker Compose? Escolha a resposta mais completa.

- A. `restart: always` tenta novamente até todas as dependências estarem no ar; o campo `priority` define uma ordem de inicialização numérica
- B. `depends_on` para a ordenação básica; `healthcheck` com `condition: service_healthy` para a ordenação condicionada à prontidão
- C. O campo `order:` no bloco `volumes:`; `links:` para a declaração legada de dependências
- D. A ordem de injeção das variáveis de ambiente; a ordem dos mapeamentos de porta no bloco `ports:`

??? success "Resposta"
    **B — `depends_on` + `healthcheck` com `condition: service_healthy`.**

    O `depends_on` garante que o container B inicie depois que o container A estiver *em execução*. Acrescentar `condition: service_healthy` garante que B espere até que A passe no seu healthcheck e esteja realmente *pronto*. A combinação é essencial para bancos de dados, que levam alguns segundos para inicializar depois que o processo começa.
