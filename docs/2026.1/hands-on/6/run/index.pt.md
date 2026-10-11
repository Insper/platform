
Reconstrua e suba a stack completa:

``` { .bash .copy .select }
docker compose up -d --build
```

Verifique se todos os serviços — incluindo `prometheus` e `grafana` — estão em execução:

``` { .bash .copy .select }
docker compose ps -a
```

A saída esperada deve mostrar todos os containers com status `running`. Se o `prometheus` não subir, confira se o arquivo `setup/prometheus/prometheus.yml` existe e está formatado corretamente.

Para confirmar que as métricas estão sendo coletadas, abra a interface do Prometheus, navegue até **Status → Targets** e verifique se `gateway`, `auth` e `account` aparecem todos com estado `UP`.

---

Pronto! Os microsserviços agora são totalmente observáveis. Acesse o Grafana, importe um dashboard e comece a monitorar taxas de requisições, memória da JVM, latências de resposta e taxas de erro em toda a plataforma.
