Reconstrua todas as imagens e suba a stack completa:

``` { .bash .copy .select }
docker compose up -d --build
```

Verifique se três réplicas do `gateway` e uma instância do `nginx` estão em execução junto com os demais serviços:

``` { .bash .copy .select }
docker compose ps -a
```

Saída esperada:

```
NAME                STATUS     PORTS
store-nginx-1       running    0.0.0.0:80->80/tcp
store-gateway-1     running
store-gateway-2     running
store-gateway-3     running
store-auth-1        running
store-account-1     running
store-account-2     running
store-db-1          running    0.0.0.0:5432->5432/tcp
```

Observe que os containers do gateway não têm portas publicadas — eles só são acessíveis através do Nginx, na rede interna do Docker.

## Verificar a distribuição de carga

Envie uma rajada de requisições através do Nginx e acompanhe os logs dos containers do gateway para confirmar que o tráfego está distribuído entre as três réplicas:

``` { .bash .copy .select }
for i in {1..9}; do curl -s -o /dev/null http://localhost/gateway/actuator/health; done
```

``` { .bash .copy .select }
docker compose logs gateway --tail 30
```

Cada um dos três containers deve exibir entradas de requisições. Se todas as requisições caírem em uma única réplica, o Nginx pode ter iniciado antes de as réplicas do gateway estarem totalmente prontas. Reinicie o Nginx para resolver novamente o registro DNS de `gateway`:

``` { .bash .copy .select }
docker compose restart nginx
```

## Escalar em tempo de execução

Adicione réplicas sem reconstruir as imagens:

``` { .bash .copy .select }
docker compose up -d --scale gateway=5
```

Depois de escalar, recarregue o Nginx para que ele consulte novamente o DNS do Docker e reconheça os IPs das novas réplicas:

``` { .bash .copy .select }
docker compose exec nginx nginx -s reload
```

Confirme o novo número de réplicas:

``` { .bash .copy .select }
docker compose ps gateway
```

## Reduzir a escala

``` { .bash .copy .select }
docker compose up -d --scale gateway=1
```

Após o próximo reload, o Nginx deixa automaticamente de rotear para os containers que não estão mais em execução.

---

Pronto! O Nginx agora distribui todo o tráfego externo entre várias réplicas do gateway. Se uma réplica falhar, o Docker a reinicia e o Nginx continua roteando as requisições para as instâncias saudáveis — a falha é transparente para os clientes.
