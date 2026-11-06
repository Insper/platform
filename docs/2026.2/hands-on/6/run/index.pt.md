
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

## Problemas comuns { #troubleshooting }

| Sintoma | Causa | Correção |
|---|---|---|
| ❌ alvo **DOWN**, *server returned HTTP status 404* | `metrics_path` ≠ o `base-path` do serviço + `/prometheus` | faça os dois baterem exatamente ([Microsserviços](../microservices/index.md)) |
| ❌ alvo **DOWN**, *no such host* ou *connection refused* | o serviço não está rodando ou o alvo diz `localhost` | suba o serviço; dentro de um contêiner `localhost` é o próprio contêiner, então use os hostnames do Docker (`gateway:8080`…) |
| ❌ o `prometheus` não sobe | `setup/prometheus/prometheus.yml` ausente ou com YAML inválido | confira o arquivo e o caminho `$SETUP` no `.env` |
| ⚠️ painéis do dashboard vazios | a variável `DS_PROMETHEUS` não aponta para a fonte de dados | crie-a como constante com valor `prometheus`, o `uid` do `datasources.yml` ([Grafana](../grafana/index.md)) |
| ✅ só `/…/actuator/prometheus` responde | `exposure.include: ['prometheus']` | esperado: os outros endpoints do Actuator continuam fechados |

---

Pronto! Os microsserviços agora são totalmente observáveis. Abra o Grafana, importe um dashboard e comece a monitorar as taxas de requisição, a memória da JVM, as latências de resposta e as taxas de erro de toda a plataforma.
