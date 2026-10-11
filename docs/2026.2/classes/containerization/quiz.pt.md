
Clique em **"Resposta"** para ver a resposta correta e a explicação.

---

## Containers

**Q1.** Um container é "um processo isolado que compartilha o kernel do hospedeiro". Quais recursos do Linux fornecem, respectivamente, a sua **visão isolada** do sistema e os seus **limites de recursos**?

- A. Hypervisor e SO convidado
- B. Namespaces e cgroups
- C. OverlayFS e iptables
- D. chroot e swap

??? success "Resposta"
    **B — Namespaces e cgroups.**

    Os **namespaces** dão ao processo a própria visão de IDs de processo, interfaces de rede, pontos de montagem e hostname — é por isso que a sua aplicação é o PID 1 dentro do container e tem o próprio endereço IP. Os **cgroups** limitam e contabilizam CPU, memória e I/O (`docker run --memory 512m`). O OverlayFS fornece o sistema de arquivos em camadas, não o isolamento; hypervisor e SO convidado são o que uma **máquina virtual** usa — exatamente o que os containers evitam.

---

## Docker

**Q2.** Qual é a diferença principal entre uma **imagem** Docker e um **container**?

- A. Uma imagem roda em primeiro plano; um container roda em segundo plano
- B. Uma imagem é um snapshot imutável; um container é uma instância em execução dessa imagem
- C. Uma imagem inclui o kernel do SO hospedeiro; um container usa o próprio kernel
- D. Uma imagem fica armazenada no registry; um container fica armazenado no sistema de arquivos do host

??? success "Resposta"
    **B — Imagem = snapshot imutável; container = instância em execução.**

    Uma imagem é construída uma vez a partir de um Dockerfile e armazenada como um artefato somente leitura. Um container é um processo vivo criado a partir dessa imagem — ele tem a própria camada gravável por cima das camadas da imagem. Vários containers podem rodar a partir da mesma imagem ao mesmo tempo, sem interferir uns nos outros.

---

**Q3.** Qual é o principal benefício de um build com **Dockerfile multi-stage**?

- A. Ele executa todos os estágios de build em paralelo, reduzindo o tempo total de build
- B. Ele permite usar várias imagens base ao mesmo tempo em um único container
- C. A imagem final contém apenas os artefatos de execução, e não as ferramentas de build — gerando uma imagem menor e mais segura
- D. Ele permite que a mesma imagem rode em vários sistemas operacionais

??? success "Resposta"
    **C — Imagem final menor, sem as ferramentas de build.**

    Em um projeto Java, o estágio de build precisa do Maven e do JDK; a execução só precisa do JRE e do JAR compilado. Builds multi-stage descartam tudo o que estava nos estágios intermediários — Maven, código-fonte, dependências de teste —, deixando uma imagem várias vezes menor (um JRE sobre Alpine em vez de um JDK completo mais o Maven e o repositório dele) e com uma superfície de ataque reduzida.

---

**Q4.** Para aproveitar ao máximo o **cache de camadas** do Docker, onde o `COPY src ./src` deve aparecer em relação à instalação das dependências?

- A. Antes — para que o código-fonte esteja disponível ao baixar as dependências
- B. Depois — uma mudança no código reconstrói apenas a camada do `COPY src` e as seguintes, mantendo intacta a camada de dependências em cache
- C. Não faz diferença; o Docker faz cache de todas as camadas da mesma forma
- D. Logo no início, antes de qualquer outra instrução

??? success "Resposta"
    **B — Depois da instalação das dependências.**

    O Docker reconstrói todas as camadas a partir da primeira camada alterada. Se o `COPY src` vier antes do `RUN mvn dependency:go-offline`, toda mudança no código-fonte força um novo download das dependências. Colocar a cópia do código depois da instalação das dependências significa que a etapa lenta de dependências só roda de novo quando o `pom.xml` muda.

---

**Q5.** Qual é a diferença entre um **volume nomeado** e um **bind mount**?

- A. Um volume nomeado é mais rápido; um bind mount é mais durável
- B. Um volume nomeado é gerenciado pelo Docker e persiste após a remoção do container; um bind mount mapeia um caminho específico do host para dentro do container
- C. Um bind mount exige o daemon do Docker; um volume nomeado não
- D. São idênticos — os termos são intercambiáveis

??? success "Resposta"
    **B — Volume nomeado = gerenciado pelo Docker e persistente; bind mount = caminho específico do host.**

    Volumes nomeados são criados e gerenciados pelo Docker, sobrevivem ao `docker rm` e não dependem da estrutura de diretórios do host. Bind mounts expõem diretamente um diretório do host — úteis no desenvolvimento para hot-reload (mudanças no host aparecem imediatamente no container), mas presos à estrutura do sistema de arquivos do host.

---

**Q6.** Qual driver de rede do Docker permite que containers na mesma rede se encontrem pelo **nome do serviço**?

- A. `host` — os containers compartilham a pilha de rede do host
- B. `none` — os containers ficam totalmente isolados
- C. `overlay` — usado para redes multi-host no modo Swarm
- D. Uma rede `bridge` definida pelo usuário — os containers ligados a ela resolvem uns aos outros pelo nome

??? success "Resposta"
    **D — Uma rede `bridge` definida pelo usuário.**

    Em uma rede bridge definida pelo usuário (`docker network create …`), o servidor DNS embutido do Docker resolve os nomes dos containers para os seus endereços IP. A rede bridge *padrão* (usada quando você não passa `--network`) **não** oferece resolução de nomes — ali os containers só podem usar endereços IP. O Docker Compose cria uma rede definida pelo usuário para cada projeto, e é assim que os serviços se encontram pelo nome do serviço (`db`, `app`, `gateway`) sem nenhum endereço IP fixo no código.

---

**Q7.** Um Dockerfile contém `EXPOSE 8080`, e você inicia o container com `docker run -d store/account:1.0`. Por que `http://localhost:8080` no navegador não responde?

- A. `EXPOSE` só funciona com o Docker Compose
- B. `EXPOSE` é documentação; a porta precisa ser **publicada** com `-p 8080:8080` para ser acessível a partir do host
- C. A aplicação precisa escutar na porta 80 dentro de um container
- D. Containers nunca podem ser acessados pelo navegador do host

??? success "Resposta"
    **B — `EXPOSE` documenta, `-p` publica.**

    `EXPOSE` registra em qual porta a aplicação escuta, mas não abre nada no host. `docker run -p 8080:8080` (formato `host:container`) mapeia uma porta do host para a porta do container; no Compose, o mesmo é feito com `ports:`. Outros containers na mesma rede conseguem acessar a porta 8080 sem publicar nada.

---

## Docker Compose

**Q8.** O que o `depends_on` com `condition: service_healthy` faz que o `depends_on` simples não faz?

- A. Define um timeout depois do qual o serviço dependente inicia de qualquer forma
- B. Atrasa o serviço dependente até que a dependência passe no seu `healthcheck`, e não apenas até o processo do container iniciar
- C. Faz o Compose reiniciar a dependência se ela ficar unhealthy depois de iniciar
- D. Executa a dependência em uma rede isolada separada

??? success "Resposta"
    **B — Espera o healthcheck passar, e não só o container iniciar.**

    O `depends_on` simples só espera o container da dependência estar *em execução* (processo iniciado). O processo do banco de dados pode estar rodando, mas ainda não pronto para aceitar conexões. `condition: service_healthy` espera até que o comando de `healthcheck` dentro da dependência retorne o código de saída 0 — por exemplo, `pg_isready -U myapp`.

---

**Q9.** Por que credenciais **nunca** devem ficar fixas no `compose.yaml`?

- A. O Docker Compose não aceita valores em texto puro nos blocos de environment
- B. O Compose remove valores em texto puro durante a fase de build, por segurança
- C. Credenciais commitadas no controle de versão são um incidente de segurança; arquivos `.env` permitem segredos por ambiente, fora do repositório
- D. Valores fixos impedem que o serviço os leia em tempo de execução

??? success "Resposta"
    **C — Credenciais no controle de versão = incidente de segurança.**

    Depois que um segredo é commitado em um repositório — mesmo privado —, ele pode ser recuperado do histórico mesmo depois de apagado. Arquivos `.env` são adicionados ao `.gitignore` e nunca commitados, o que permite que cada ambiente (desenvolvimento, homologação, produção) tenha segredos diferentes sem que eles jamais apareçam no código.

---

**Q10.** O que `docker compose down -v` faz que `docker compose down` não faz?

- A. Para os containers de forma mais forçada, usando `SIGKILL` em vez de `SIGTERM`
- B. Reconstrói todas as imagens antes de parar
- C. Remove também os volumes nomeados, apagando permanentemente os dados persistidos
- D. Remove a rede do projeto, mas mantém os containers parados

??? success "Resposta"
    **C — Remove também os volumes nomeados.**

    `docker compose down` para e remove containers e redes, mas mantém intactos os volumes nomeados (os dados do banco sobrevivem). Acrescentar `-v` remove também os volumes nomeados — apagando permanentemente todos os dados persistidos. Isso é irreversível; use apenas quando você realmente quiser começar do zero.

---

**Q11.** Dentro de uma rede do Docker Compose, como os serviços se endereçam?

- A. Pelo nome completo da imagem do container, com a tag
- B. Pelo endereço IP da máquina host e pela porta mapeada
- C. Pelo nome do serviço definido no `compose.yaml` — o Compose oferece resolução DNS pelo nome do serviço
- D. Pelo ID do container atribuído em tempo de execução

??? success "Resposta"
    **C — Pelo nome do serviço.**

    O Compose cria automaticamente uma rede e configura o DNS para que cada serviço seja acessível pelo nome que tem no `compose.yaml`. Uma aplicação Spring Boot configurada com `SPRING_DATASOURCE_URL: jdbc:postgresql://db:5432/store` vai resolver `db` para o IP do container do PostgreSQL sem nenhuma configuração manual.

---

**Q12.** Quais dois mecanismos controlam a **ordem de inicialização** no Docker Compose? Escolha a resposta mais completa.

- A. `restart: always` tenta de novo até todas as dependências subirem; o campo `priority` define a ordem de inicialização com um inteiro
- B. `depends_on` para a ordenação básica; `healthcheck` com `condition: service_healthy` para uma ordenação condicionada à prontidão
- C. O campo `order:` no bloco `volumes:`; `links:` para declaração legada de dependências
- D. A ordem de injeção das variáveis de ambiente; a ordem dos mapeamentos no bloco `ports:`

??? success "Resposta"
    **B — `depends_on` + `healthcheck` com `condition: service_healthy`.**

    O `depends_on` garante que o container B inicie depois que o container A estiver *em execução*. Acrescentar `condition: service_healthy` garante que B espere até A passar no healthcheck e estar de fato *pronto*. A combinação é essencial para bancos de dados, que levam alguns segundos para inicializar depois que o processo começa.

---

**Q13.** O serviço de contas funciona quando iniciado pela IDE com `spring.datasource.url=jdbc:postgresql://localhost:5432/store`. Empacotado como container no mesmo `compose.yaml` do serviço `db`, ele falha com *Connection refused*. Qual é a correção?

- A. Publicar a porta 5432 do `db` com `ports: - 5432:5432`
- B. Usar `network_mode: host` em todos os serviços
- C. Apontar a URL para o nome do serviço: `jdbc:postgresql://db:5432/store`, passada como variável de ambiente
- D. Adicionar `depends_on: - db` ao serviço de contas

??? success "Resposta"
    **C — Usar o nome do serviço.**

    Dentro de um container, `localhost` é o próprio container — não há PostgreSQL ali. O DNS do Compose resolve o nome de serviço `db` para o container do banco de dados, que escuta na porta 5432 do container. Publicar a porta (A) só ajuda clientes no host; o `depends_on` (D) ordena a inicialização, mas não muda o endereço. Passar a URL por uma variável de ambiente (por exemplo, `SPRING_DATASOURCE_URL`) mantém a mesma imagem funcionando na IDE, no Compose e no Kubernetes.

---

**Q14.** Um projeto tem um arquivo `.env` com `DB_PASSWORD=devpass` ao lado do `compose.yaml`. Qual afirmação está correta?

- A. Toda variável do `.env` é injetada automaticamente em todos os containers
- B. O `.env` é usado para preencher os marcadores `${DB_PASSWORD}` no `compose.yaml`; para injetar um arquivo inteiro em um container, usa-se `env_file:`
- C. O `.env` é ignorado, a menos que você passe `--env-file .env` para o `docker compose up`
- D. Os valores do `.env` sempre sobrescrevem as variáveis exportadas no seu shell

??? success "Resposta"
    **B — O `.env` serve para interpolação; `env_file:` injeta em um container.**

    O Compose lê o `.env` do diretório do projeto automaticamente e o usa para substituir os `${...}` no `compose.yaml` — um container só recebe um valor se o arquivo o mapear, por exemplo `POSTGRES_PASSWORD: ${DB_PASSWORD}`. Para passar todos os `KEY=value` de um arquivo para um container, use `env_file:` no serviço. Variáveis já definidas no shell têm precedência sobre o `.env` (D é falsa).
