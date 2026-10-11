
O [Grafana](https://grafana.com){target="_blank"} se conecta ao Prometheus como fonte de dados (datasource) e oferece dashboards ricos e interativos para visualizar as métricas coletadas.

Crie o arquivo de provisionamento da fonte de dados em `setup/grafana/provisioning/datasources/datasources.yml`:

``` { .yaml .copy .select linenums="1" title="datasources.yml" }
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    uid: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
```

O Grafana carrega esse arquivo automaticamente na inicialização, conectando-se à instância do Prometheus na rede Docker interna — sem nenhuma configuração manual pela interface.

Com a stack em execução, abra o Grafana no navegador:

[http://localhost:3000/](http://localhost:3000/){target="_blank" .md-button}

Faça login com as credenciais padrão:

| Campo    | Valor   |
|----------|---------|
| Usuário  | `admin` |
| Senha    | `admin` |

!!! tip "Marketplace de dashboards"

    O Grafana oferece uma grande biblioteca de dashboards prontos para as stacks mais comuns. Para métricas do Spring Boot e do Micrometer, um bom ponto de partida é o dashboard **JVM (Micrometer)** (ID `4701`) ou o **SpringBoot APM Dashboard** (ID `12900`).

    Para importá-lo: vá em **Dashboards → Import**, informe o ID `4701` ou `12900` e selecione a fonte de dados do Prometheus.

    Navegue pela biblioteca completa em [grafana.com/grafana/dashboards](https://grafana.com/grafana/dashboards/){target="_blank"}.

    Para que esses dashboards funcionem corretamente, garanta que a fonte de dados do Prometheus provisionada esteja selecionada para a variável `DS_PROMETHEUS`. Para definir essa variável, vá em **Dashboard -> Edit -> Dashboard Options**:

    ![](./assets/grafana_dashboard_edit.png)

    Clique em **Settings** e vá até a aba **Variables**. Crie uma nova variável chamada `DS_PROMETHEUS`, defina o seu tipo como `Constant` e o seu valor como `prometheus` (o uid definido em `datasources.yml`):

    ![](./assets/grafana_dashboard_edit_variable.png)

    Salve o dashboard e você verá todas as métricas começarem a ser preenchidas imediatamente. Explore os diversos painéis para monitorar, em tempo real, as taxas de requisição, o uso de memória da JVM, as latências de resposta e as taxas de erro de toda a plataforma.
