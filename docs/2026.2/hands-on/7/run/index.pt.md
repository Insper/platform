Reconstrua todas as imagens e suba a stack completa:

``` { .bash .copy .select }
docker compose up -d --build
```

Verifique se três réplicas do `gateway` e uma instância do `lb` (Nginx) estão rodando junto com os demais serviços:

``` { .bash .copy .select }
docker compose ps -a
```

Saída esperada:

```
NAME                STATUS     PORTS
store-lb-1          running    0.0.0.0:8080->80/tcp
store-gateway-1     running
store-gateway-2     running
store-gateway-3     running
store-auth-1        running
store-account-1     running
store-db-1          running
```

Observe que só o `lb` publica uma porta: os containers do gateway (e os demais serviços) só são acessíveis através do Nginx, na rede Docker interna.

## Verificar a distribuição de carga

Envie uma rajada de requisições pelo Nginx. O `/health-check` do gateway responde com o hostname do container que a atendeu; por isso, a saída alterna entre as três réplicas — e os logs do gateway mostram o mesmo:

``` { .bash .copy .select }
for i in {1..9}; do curl -s http://localhost:8080/health-check; echo; done
```

``` { .bash .copy .select }
docker compose logs gateway --tail 30
```

Cada um dos três containers deve mostrar entradas de requisição. Se todas as requisições caírem em uma única réplica, o Nginx pode ter subido antes de as réplicas do gateway estarem totalmente prontas. Reinicie o Nginx para que ele resolva novamente o registro DNS de `gateway`:

``` { .bash .copy .select }
docker compose restart lb
```

## Escalar em tempo de execução

Adicione réplicas sem reconstruir as imagens:

``` { .bash .copy .select }
docker compose up -d --scale gateway=5
```

Depois de escalar, recarregue o Nginx para que ele consulte novamente o DNS do Docker e encontre os IPs das novas réplicas:

``` { .bash .copy .select }
docker compose exec lb nginx -s reload
```

Confirme o novo número de réplicas:

``` { .bash .copy .select }
docker compose ps gateway
```

## Reduzir a escala

``` { .bash .copy .select }
docker compose up -d --scale gateway=1
```

Após o próximo reload, o Nginx deixa automaticamente de rotear para os containers que não estão mais rodando.

---

Pronto! O Nginx agora distribui todo o tráfego externo entre várias réplicas do gateway. Se uma réplica cair, o Docker a reinicia e o Nginx continua roteando as requisições para as instâncias saudáveis — a falha é transparente para os clientes.
