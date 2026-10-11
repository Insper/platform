Dois novos serviços — `prometheus` e `grafana` — devem ser adicionados ao `compose.yaml`. Ambos compartilham a mesma rede Docker privada dos microsserviços, de modo que o Prometheus consegue alcançá-los pelo hostname.

``` { .yaml .copy .select title="compose.yaml" linenums="1" }
  prometheus:
    image: prom/prometheus:latest
    hostname: prometheus
    ports:
      - 9090:9090
    volumes:
      - $SETUP/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana-enterprise
    hostname: grafana
    ports:
      - 3000:3000
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - $SETUP/grafana:/var/lib/grafana
      - $SETUP/grafana/provisioning/datasources:/etc/grafana/provisioning/datasources
```

A variável `$SETUP` aponta para o diretório que contém todos os arquivos de configuração externos. Defina-a no arquivo `.env` na raiz do projeto:

``` { .bash .copy .select }
SETUP=./setup
```

A estrutura do projeto resultante fica assim:

``` { .tree }
api/
    setup/
        prometheus/
            prometheus.yml
        grafana/
            provisioning/
                datasources/
                    datasources.yml
    account-service/
    auth-service/
    gateway-service/
    compose.yaml
    .env
```
