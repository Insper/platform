
Reconstrua e suba a stack completa:

``` { .bash .copy .select }
docker compose up -d --build
```

Verifique se todos os serviços — incluindo `prometheus` e `grafana` — estão rodando:

``` { .bash .copy .select }
docker compose ps -a
```

A saída esperada deve mostrar todos os containers com status `running`. Se o `prometheus` não subir, confira se o arquivo `setup/prometheus/prometheus.yml` existe e está formatado corretamente.

Para confirmar que as métricas estão sendo coletadas, abra a interface do Prometheus, vá em **Status → Targets** e verifique se `gateway`, `auth` e `account` aparecem todos com o estado `UP`.

---

Pronto! Os microsserviços agora são totalmente observáveis. Abra o Grafana, importe um dashboard e comece a monitorar as taxas de requisição, a memória da JVM, as latências de resposta e as taxas de erro de toda a plataforma.
