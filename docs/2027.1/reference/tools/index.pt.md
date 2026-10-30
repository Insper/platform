# Ferramentas { #tools }

As ferramentas do ofício, agrupadas por função. Para cada uma: o que é em uma linha, quando recorrer a ela, o laboratório em que a usamos neste curso e o site oficial. A pilha do curso é pequena de propósito: **Docker Compose** para rodar tudo localmente, **k6** para testes de carga, **OpenTelemetry + `grafana/otel-lgtm`** para observar, **Toxiproxy** para injetar falhas, **kind ou minikube** para Kubernetes, **GitHub Actions** e **Argo CD** para entregar, e **LiteLLM + Ollama + pgvector** para o serviço de IA. As alternativas estão listadas para que você as reconheça em vagas de emprego e em blogs de engenharia.

!!! note "Sobre os links"
    Os links levam ao site oficial ou ao repositório oficial de cada projeto. As ferramentas mudam rápido: confira a documentação atual antes de copiar um comando de um post de blog, e fixe as versões no seu `docker-compose.yaml` e nos arquivos de CI.

## Qual ferramenta para qual trabalho { #which-tool-for-which-job }

| Trabalho | Neste curso | Alternativas comuns | Laboratório |
|---|---|---|---|
| Rodar o sistema inteiro localmente | Docker + Docker Compose | Podman, Tilt | [Hands-on 0](../../hands-on/0/index.md) |
| Teste de carga de uma API HTTP | k6 | Gatling, Locust, JMeter, wrk2, vegeta | [Hands-on 2](../../hands-on/2/index.md) |
| Injetar latência e falhas | Toxiproxy | Chaos Mesh, LitmusChaos, AWS FIS, Gremlin, Pumba | [Hands-on 9](../../hands-on/9/index.md) |
| Métricas, logs e traces | OpenTelemetry + `grafana/otel-lgtm` | Prometheus + Grafana + Loki + Tempo, Jaeger, APM comercial | [Hands-on 8](../../hands-on/8/index.md) |
| Descobrir para onde vai a CPU | async-profiler (Java) | Pyroscope, `perf` | [Aula 15](../../classes/performance/bottlenecks/index.md) |
| Explicar uma consulta lenta | `EXPLAIN (ANALYZE, BUFFERS)` + explain.dalibo.com | pgAdmin, pganalyze | [Hands-on 6](../../hands-on/6/index.md) |
| Kubernetes local | kind ou minikube | k3d, Kubernetes do Docker Desktop | [Hands-on 10](../../hands-on/10/index.md) |
| Pipeline de CI | GitHub Actions | GitLab CI, Jenkins | [Hands-on 11](../../hands-on/11/index.md) |
| GitOps e entrega progressiva | Argo CD (+ Argo Rollouts) | Flux, Flagger | [Hands-on 11](../../hands-on/11/index.md) |
| Infraestrutura como código | Terraform / OpenTofu | Pulumi, Crossplane, templates nativos das nuvens | [Aula 11](../../classes/cloud-native/index.md) |
| Varrer imagens e gerar um SBOM | Trivy + Syft | Grype, Docker Scout | [Hands-on 11](../../hands-on/11/index.md) |
| Desenhar uma arquitetura | Excalidraw, Mermaid | diagrams.net, PlantUML, Structurizr | todas as aulas |
| Chamar LLMs por um gateway único | LiteLLM (+ Ollama localmente) | Envoy AI Gateway, gateways das nuvens | [Hands-on 12](../../hands-on/12/index.md) |
| Testar prompts e guardrails | promptfoo | scripts de avaliação próprios | [Hands-on 12](../../hands-on/12/index.md) |

## Teste de carga { #load-testing }

| Ferramenta | O que é | Use quando | No curso | Site |
|---|---|---|---|---|
| **k6** | Ferramenta de teste de carga com scripts em JavaScript e thresholds que reprovam uma execução (ótima para CI) | Você quer scripts legíveis, perfis smoke/load/stress/spike/soak e critérios de aprovação | [Hands-on 2](../../hands-on/2/index.md), toda etapa "Meça", gate de CI no [Hands-on 11](../../hands-on/11/index.md) | [k6.io](https://k6.io) |
| **Gatling** | Teste de carga com cenários em Java, Kotlin ou Scala e relatórios HTML detalhados | O time vive na JVM e quer cenários escritos como código | Alternativa ao k6 | [gatling.io](https://gatling.io) |
| **Locust** | Teste de carga com o comportamento dos usuários escrito em Python | Você prefere Python, ou precisa de protocolos customizados | Alternativa ao k6 | [locust.io](https://locust.io) |
| **Apache JMeter** | Veterana ferramenta de teste de carga com interface gráfica, muitos protocolos | Você herda planos JMeter existentes ou precisa dos plugins de protocolo | Reconheça | [jmeter.apache.org](https://jmeter.apache.org) |
| **wrk2** | Pequena ferramenta de benchmark HTTP com taxa de requisições constante, corrigida para coordinated omission | Você precisa de uma distribuição de latência rápida e honesta a uma taxa fixa | [Aula 15](../../classes/performance/load-testing/index.md) (coordinated omission) | [github.com/giltene/wrk2](https://github.com/giltene/wrk2) |
| **vegeta** | Ferramenta de carga HTTP com taxa de ataque constante, usável como CLI ou biblioteca Go | Testes de modelo aberto (taxa fixa) pela linha de comando | Alternativa para testes rápidos | [github.com/tsenart/vegeta](https://github.com/tsenart/vegeta) |
| **oha** / **hey** | Geradores mínimos de carga HTTP pela linha de comando | Uma verificação de dez segundos, não uma campanha de testes | Verificações rápidas | [oha](https://github.com/hatoo/oha) · [hey](https://github.com/rakyll/hey) |

!!! tip "Carga aberta vs fechada"
    A maioria das ferramentas usa por padrão um modelo **fechado** (N usuários virtuais, cada um esperando sua resposta antes de enviar a próxima). O tráfego real da internet se parece mais com um modelo **aberto** (as requisições chegam a uma taxa, quer o servidor acompanhe, quer não). Os executores `constant-arrival-rate` e `ramping-arrival-rate` do k6, o wrk2 e o vegeta geram carga aberta; use-os quando quiser ver as filas se formarem. Veja a [Aula 15 · Testes de carga](../../classes/performance/load-testing/index.md).

## Caos e injeção de falhas { #chaos-and-fault-injection }

| Ferramenta | O que é | Use quando | No curso | Site |
|---|---|---|---|---|
| **Toxiproxy** | Proxy TCP que acrescenta latência, limites de banda, timeouts e quedas de conexão, controlado por uma API | Testar timeouts, retries e circuit breakers entre dois serviços, localmente ou no CI | [Hands-on 9](../../hands-on/9/index.md) | [github.com/Shopify/toxiproxy](https://github.com/Shopify/toxiproxy) |
| **Chaos Mesh** | Caos nativo do Kubernetes (matar pods, atraso de rede, estresse, desvio de relógio) definido como recursos customizados | Experimentos de caos dentro de um cluster Kubernetes | Opcional no [Hands-on 10](../../hands-on/10/index.md) | [chaos-mesh.org](https://chaos-mesh.org) |
| **LitmusChaos** | Plataforma de engenharia do caos para Kubernetes com um catálogo de experimentos prontos | Workflows de caos agendados e repetíveis no Kubernetes | Reconheça | [litmuschaos.io](https://litmuschaos.io) |
| **AWS Fault Injection Service (FIS)** | Injeção de falhas gerenciada para recursos da AWS (parar instâncias, estrangular APIs, perturbar AZs) | Game days em infraestrutura AWS | Reconheça | [aws.amazon.com/fis](https://aws.amazon.com/fis/) |
| **Gremlin** | Plataforma comercial de engenharia do caos | Organizações que querem uma prática de caos gerenciada e auditada | Reconheça | [gremlin.com](https://www.gremlin.com) |
| **Pumba** | Caos para contêineres Docker (matar, pausar, emulação de rede com `tc`) | Quebrar contêineres num ambiente Compose | Opcional no [game day](../../exercises/project/game-day/index.md) | [github.com/alexei-led/pumba](https://github.com/alexei-led/pumba) |

## Observabilidade { #observability }

| Ferramenta | O que é | Use quando | No curso | Site |
|---|---|---|---|---|
| **OpenTelemetry** | APIs, SDKs, agentes de autoinstrumentação e o Collector, neutros em relação a fornecedores, para métricas, logs e traces | Sempre: instrumente uma vez, envie para qualquer lugar | [Hands-on 8](../../hands-on/8/index.md) | [opentelemetry.io](https://opentelemetry.io) |
| **`grafana/otel-lgtm`** | Uma imagem Docker com OpenTelemetry Collector, Prometheus/Mimir, Loki, Tempo, Pyroscope e Grafana | Uma pilha de observabilidade local completa num contêiner | [Hands-on 8](../../hands-on/8/index.md) | [github.com/grafana/docker-otel-lgtm](https://github.com/grafana/docker-otel-lgtm) |
| **Prometheus** | Banco de métricas por pull, com PromQL e regras de alerta | Métricas e alertas, sobretudo no Kubernetes | [Hands-on 8](../../hands-on/8/index.md), [Hands-on 10](../../hands-on/10/index.md) | [prometheus.io](https://prometheus.io) |
| **Grafana** | Dashboards e alertas sobre muitas fontes de dados | Dashboards RED/USE, painéis de SLO | [Hands-on 8](../../hands-on/8/index.md) | [grafana.com](https://grafana.com) |
| **Grafana Loki** | Agregação de logs indexada por labels | Logs baratos e pesquisáveis ao lado das métricas | [Hands-on 8](../../hands-on/8/index.md) | [grafana.com/oss/loki](https://grafana.com/oss/loki/) |
| **Grafana Tempo** | Armazenamento de traces em object storage | Guardar traces a baixo custo, linkados a partir de métricas e logs | [Hands-on 8](../../hands-on/8/index.md) | [grafana.com/oss/tempo](https://grafana.com/oss/tempo/) |
| **Jaeger** | Backend e interface de tracing distribuído (CNCF) | Uma interface de tracing independente | Alternativa ao Tempo | [jaegertracing.io](https://www.jaegertracing.io) |
| **Grafana Pyroscope** | Profiling contínuo | Ver flame graphs ao longo do tempo em produção | Opcional | [grafana.com/oss/pyroscope](https://grafana.com/oss/pyroscope/) |
| **async-profiler** | Profiler por amostragem de baixo overhead para a JVM, que gera flame graphs | Descobrir onde um serviço Java gasta CPU ou aloca memória | [Aula 15](../../classes/performance/bottlenecks/index.md) | [github.com/async-profiler/async-profiler](https://github.com/async-profiler/async-profiler) |

## Infraestrutura como código e configuração { #infrastructure-as-code-and-configuration }

| Ferramenta | O que é | Use quando | No curso | Site |
|---|---|---|---|---|
| **Terraform** | Infraestrutura como código declarativa, com providers para todas as nuvens (linguagem HCL) | Criar recursos de nuvem de forma reproduzível, com planos e revisões | [Aula 11](../../classes/cloud-native/index.md) | [terraform.io](https://www.terraform.io) |
| **OpenTofu** | Fork de código aberto do Terraform (Linux Foundation), compatível com a sua linguagem | O mesmo que o Terraform, com licença de código aberto | [Aula 11](../../classes/cloud-native/index.md) | [opentofu.org](https://opentofu.org) |
| **Pulumi** | Infraestrutura como código em linguagens de uso geral (TypeScript, Python, Go, Java…) | O time prefere linguagens de programação de verdade a HCL | Reconheça | [pulumi.com](https://www.pulumi.com) |
| **Ansible** | Gestão de configuração sem agente, via SSH, com playbooks em YAML | Configurar máquinas virtuais e o software delas | Reconheça | [ansible.com](https://www.ansible.com) |
| **Helm** | Gerenciador de pacotes do Kubernetes (charts com templates e valores) | Instalar software de terceiros no Kubernetes, empacotar o seu | Opcional no [Hands-on 10](../../hands-on/10/index.md) | [helm.sh](https://helm.sh) |
| **Kustomize** | Customização de YAML do Kubernetes sem templates, com overlays (embutido no `kubectl`) | Um manifesto base, pequenas diferenças por ambiente | [Hands-on 10](../../hands-on/10/index.md), [Hands-on 11](../../hands-on/11/index.md) | [kustomize.io](https://kustomize.io) |
| **Crossplane** | Gerencia recursos de nuvem como recursos customizados do Kubernetes | Times de plataforma construindo APIs de autoatendimento sobre o Kubernetes | Reconheça | [crossplane.io](https://www.crossplane.io) |

## CI/CD e GitOps { #cicd-and-gitops }

| Ferramenta | O que é | Use quando | No curso | Site |
|---|---|---|---|---|
| **GitHub Actions** | Workflows de CI/CD definidos em YAML no próprio repositório | Compilar, testar, varrer, construir imagens e rodar gates com k6 a cada push | [Hands-on 11](../../hands-on/11/index.md) | [github.com/features/actions](https://github.com/features/actions) |
| **Argo CD** | Controlador GitOps: mantém um cluster Kubernetes sincronizado com os manifestos no Git | Deploys revisados como pull requests e que se corrigem sozinhos quando há desvio | [Hands-on 11](../../hands-on/11/index.md) | [argo-cd.readthedocs.io](https://argo-cd.readthedocs.io) |
| **Argo Rollouts** | Entrega progressiva para Kubernetes: canary e blue/green com análise automática | Releases canary que voltam atrás quando as métricas pioram | [Hands-on 11](../../hands-on/11/index.md) | [argoproj.github.io](https://argoproj.github.io) |
| **Flux** | Kit de ferramentas GitOps para Kubernetes (CNCF) | Alternativa ao Argo CD | Reconheça | [fluxcd.io](https://fluxcd.io) |

## Contêineres e clusters locais { #containers-and-local-clusters }

| Ferramenta | O que é | Use quando | No curso | Site |
|---|---|---|---|---|
| **Docker** | Constrói e executa imagens de contêiner OCI | Empacotar cada serviço | [Hands-on 0](../../hands-on/0/index.md), [Hands-on 1](../../hands-on/1/index.md) | [docker.com](https://www.docker.com) |
| **Docker Compose** | Executa aplicações de vários contêineres a partir de um arquivo YAML | A pilha inteira do BoxOffice num notebook | Todos os laboratórios | [docs.docker.com/compose](https://docs.docker.com/compose/) |
| **Podman** | Motor de contêineres sem daemon e sem root, compatível com a CLI do Docker | Ambientes em que o Docker Desktop não é uma opção | Alternativa | [podman.io](https://podman.io) |
| **kind** | Clusters Kubernetes rodando em contêineres Docker | Clusters rápidos e descartáveis, localmente e no CI | [Hands-on 10](../../hands-on/10/index.md) | [kind.sigs.k8s.io](https://kind.sigs.k8s.io) |
| **minikube** | Kubernetes local com um ou vários nós e add-ons (ingress, metrics-server) | Aprender Kubernetes com tudo incluído | [Hands-on 10](../../hands-on/10/index.md) | [minikube.sigs.k8s.io](https://minikube.sigs.k8s.io) |
| **k3d** | Executa a distribuição leve k3s dentro do Docker | Clusters locais muito leves | Alternativa | [k3d.io](https://k3d.io) |
| **kubectl** | O cliente de linha de comando do Kubernetes | Tudo num cluster | [Hands-on 10](../../hands-on/10/index.md) | [kubernetes.io/docs/reference/kubectl](https://kubernetes.io/docs/reference/kubectl/) |
| **k9s** | Interface de terminal para o Kubernetes | Acompanhar pods, logs e eventos enquanto um teste de carga roda | Opcional | [k9scli.io](https://k9scli.io) |

## Diagramas { #diagramming }

| Ferramenta | O que é | Use quando | No curso | Site |
|---|---|---|---|---|
| **Excalidraw** | Quadro branco com estilo de desenho à mão, no navegador, colaborativo | Entrevistas, entrevistas simuladas, esboços rápidos | [Entrevistas simuladas](../../support/interview/mock/index.md) | [excalidraw.com](https://excalidraw.com) |
| **Mermaid** | Diagramas como texto (fluxograma, sequência, estados) renderizados em Markdown | Diagramas que vivem no repositório ao lado do código — como os deste site | Todas as aulas | [mermaid.js.org](https://mermaid.js.org) |
| **diagrams.net (draw.io)** | Editor de diagramas gratuito com conjuntos de ícones das nuvens | Diagramas de arquitetura detalhados com os ícones oficiais das nuvens | Documento de design do projeto | [drawio.com](https://www.drawio.com) |
| **PlantUML** | Diagramas como texto, forte em UML e C4 | Times que já usam UML | Reconheça | [plantuml.com](https://plantuml.com) |
| **Structurizr** / **modelo C4** | O modelo C4 (contexto, contêineres, componentes, código) e uma ferramenta para manter diagramas como código | Documentos de design com vários níveis de zoom consistentes | [Documento de design](../../exercises/design-doc/index.md) | [c4model.com](https://c4model.com) · [structurizr.com](https://structurizr.com) |
| **System Design Playground** | O simulador do curso: projete com a paleta e rode sob carga | Testar se um design sobrevive, e não só desenhá-lo | [Playground](../../../playground/index.md) | — |

## Bancos de dados e cache { #databases-and-caching }

| Ferramenta | O que é | Use quando | No curso | Site |
|---|---|---|---|---|
| **psql** | O terminal interativo do PostgreSQL | Rodar consultas, `EXPLAIN`, inspecionar locks | [Hands-on 1](../../hands-on/1/index.md), [Hands-on 6](../../hands-on/6/index.md) | [postgresql.org](https://www.postgresql.org) |
| **pgbench** | Ferramenta de benchmark embutida no PostgreSQL | Medir o banco sozinho, sem a aplicação | [Hands-on 6](../../hands-on/6/index.md) | [postgresql.org/docs/current/pgbench.html](https://www.postgresql.org/docs/current/pgbench.html) |
| **explain.dalibo.com** | Visualizador de planos de execução do PostgreSQL | Ler uma saída longa de `EXPLAIN (ANALYZE)` | [Hands-on 6](../../hands-on/6/index.md) | [explain.dalibo.com](https://explain.dalibo.com) |
| **PgBouncer** | Pool de conexões leve para PostgreSQL | Muitas réplicas da aplicação, poucas conexões no banco | [Hands-on 6](../../hands-on/6/index.md) | [pgbouncer.org](https://www.pgbouncer.org) |
| **redis-cli** / **redis-benchmark** | Cliente de linha de comando e benchmark do Redis | Inspecionar chaves e TTLs, `MONITOR`, medir o Redis sozinho | [Hands-on 5](../../hands-on/5/index.md) | [redis.io](https://redis.io) |
| **kcat** | Produtor e consumidor Kafka de linha de comando (antigo kafkacat) | Espiar tópicos, produzir eventos de teste | [Hands-on 7](../../hands-on/7/index.md) | [github.com/edenhill/kcat](https://github.com/edenhill/kcat) |

## Segurança e cadeia de suprimentos { #security-and-supply-chain }

| Ferramenta | O que é | Use quando | No curso | Site |
|---|---|---|---|---|
| **Trivy** | Scanner de vulnerabilidades e configurações erradas em imagens, sistemas de arquivos e IaC | Reprovar o build do CI quando há CVEs críticas | [Hands-on 11](../../hands-on/11/index.md) | [github.com/aquasecurity/trivy](https://github.com/aquasecurity/trivy) |
| **Syft** | Gera uma lista de materiais de software (SBOM) a partir de imagens e diretórios | Saber exatamente o que vai em cada imagem | [Hands-on 11](../../hands-on/11/index.md) | [github.com/anchore/syft](https://github.com/anchore/syft) |
| **Grype** | Scanner de vulnerabilidades que trabalha sobre imagens e SBOMs | Varrer um SBOM gerado pelo Syft | Alternativa ao Trivy | [github.com/anchore/grype](https://github.com/anchore/grype) |
| **cosign** (Sigstore) | Assina e verifica imagens de contêiner e atestações | Provar que uma imagem saiu do seu pipeline | [Hands-on 11](../../hands-on/11/index.md) | [github.com/sigstore/cosign](https://github.com/sigstore/cosign) |
| **OWASP ZAP** | Scanner dinâmico de segurança de aplicações (proxy e varreduras automáticas) | Verificar vulnerabilidades comuns numa API em execução | Opcional no [Hands-on 4](../../hands-on/4/index.md) | [zaproxy.org](https://www.zaproxy.org) |
| **Keycloak** | Provedor de identidade de código aberto (OIDC, OAuth 2) | Um servidor de autorização de verdade para desenvolvimento local | [Hands-on 4](../../hands-on/4/index.md) | [keycloak.org](https://www.keycloak.org) |

## Ferramentas de API { #api-tools }

| Ferramenta | O que é | Use quando | No curso | Site |
|---|---|---|---|---|
| **curl** | O cliente HTTP de linha de comando universal | Qualquer requisição rápida, em scripts e documentação | Todos os laboratórios | [curl.se](https://curl.se) |
| **HTTPie** | Cliente HTTP de linha de comando mais amigável, com suporte a JSON | Explorar uma API à mão | Opcional | [httpie.io](https://httpie.io) |
| **Bruno** | Cliente de API de código aberto cujas coleções são arquivos simples no Git | Compartilhar requisições de API com o time pelo repositório | Opcional | [usebruno.com](https://www.usebruno.com) |
| **Postman** | Plataforma de API popular para requisições, coleções e testes | Times que já a usam | Reconheça | [postman.com](https://www.postman.com) |
| **grpcurl** | O curl dos servidores gRPC | Chamar serviços gRPC à mão | [Aula 5](../../classes/compute/api-styles/index.md) | [github.com/fullstorydev/grpcurl](https://github.com/fullstorydev/grpcurl) |

## Sistemas de IA { #ai-systems }

| Ferramenta | O que é | Use quando | No curso | Site |
|---|---|---|---|---|
| **LiteLLM** | Gateway/proxy de LLMs com API compatível com a da OpenAI, orçamentos, fallbacks e acompanhamento de custo | Uma porta de entrada única para modelos locais e hospedados | [Hands-on 12](../../hands-on/12/index.md) | [github.com/BerriAI/litellm](https://github.com/BerriAI/litellm) |
| **Ollama** | Executa modelos de pesos abertos localmente atrás de uma API HTTP | Desenvolver sem chaves de API nem custos | [Hands-on 12](../../hands-on/12/index.md) | [ollama.com](https://ollama.com) |
| **pgvector** | Tipo vetorial e índices de similaridade (HNSW, IVFFlat) para PostgreSQL | RAG sem acrescentar um banco novo | [Hands-on 12](../../hands-on/12/index.md) | [github.com/pgvector/pgvector](https://github.com/pgvector/pgvector) |
| **Model Context Protocol** + **MCP Inspector** | Protocolo aberto para expor ferramentas a modelos, e uma ferramenta para testar servidores MCP | Construir e depurar as ferramentas do assistente | [Hands-on 12](../../hands-on/12/index.md) | [modelcontextprotocol.io](https://modelcontextprotocol.io) · [inspector](https://github.com/modelcontextprotocol/inspector) |
| **promptfoo** | Testes e red teaming de prompts, RAG e guardrails, executáveis no CI | Pegar regressões nas respostas e nas defesas contra injeção | [Hands-on 12](../../hands-on/12/index.md) | [promptfoo.dev](https://www.promptfoo.dev) |

!!! tip "Aprenda o trabalho, não só a ferramenta"
    Entrevistadores raramente se importam se você usou k6 ou Gatling. Importa se você sabe **o que** medir (percentis a uma taxa-alvo, o joelho, o gargalo) e **por quê**. Aprenda bem uma ferramenta por trabalho e saiba dizer o que as alternativas fazem de diferente.
