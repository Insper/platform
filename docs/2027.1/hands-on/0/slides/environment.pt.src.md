---
marp: true
lang: pt-BR
title: Lab 0 — Ambiente
description: Arquitetura de Sistemas · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Arquitetura de Sistemas · Insper · Lab 0</div>

# Lab 0 — Ambiente

**Um conjunto de ferramentas, um repositório, um conjunto de nomes — e uma primeira medição**

<!--
Roteiro: (1) o que o BoxOffice vira em 12 labs; (2) as ferramentas; (3) a tabela de serviços/portas;
(4) o repositório; (5) a medição de referência com k6; (6) primeiro contato com o playground.
-->

---

## BoxOffice, um lab de cada vez

<div class="q">

Um show em estádio abre a venda às 10:00: **2 M de fãs, 60 mil lugares**. O que precisa existir para essa manhã não ser um desastre?

</div>

- Lab 1: um serviço (`catalog`) + PostgreSQL.
- Lab 2: **meça** — descubra onde ele quebra.
- Labs 3–6: borda, gateway, cache, dados em escala.
- Labs 7–9: assíncrono, observabilidade, resiliência.
- Labs 10–12: Kubernetes, entrega, assistente de IA.

<!--
Cada lab acrescenta um componente da paleta e termina com uma medição. A venda relâmpago é o fio
que liga todos eles.
-->

---

## As ferramentas

| Ferramenta | Para |
|---|---|
| **Docker + Compose v2** | todo serviço e banco roda em um container |
| **JDK 21 + Maven** | serviços Spring Boot |
| **uv + Python 3.12** | scripts de resultados, assistente de IA (sem pip) |
| **k6** | testes de carga, escritos em JavaScript |
| **kubectl + kind/minikube** | Kubernetes local (lab 10) |
| **Git, jq, curl** | entrega e chamadas às APIs |

<div class="ok">

`bash scripts/check-env.sh` deve terminar com **All set.**

</div>

---

## Windows? Use WSL 2

- `wsl --install -d Ubuntu-24.04`
- Docker Desktop com **WSL integration** ligada.
- Siga as instruções de **Linux** dentro do Ubuntu.
- Mantenha o repositório em `~/boxoffice`, **não** em `/mnt/c/...`.

<div class="warn">

Os recursos padrão do Docker Desktop são pequenos: dê **≥ 4 CPUs e 8 GB**, ou toda medição posterior fica distorcida.

</div>

---

## Nomes são um contrato

| Serviço | Porta | Prefixo |
|---|---|---|
| `edge` (Nginx) | 80 | entrada pública |
| `gateway` | 8080 | todas as rotas |
| `auth` | 8081 | `/auth/**` |
| `catalog` | 8082 | `/catalog/**` |
| `inventory` | 8083 | `/inventory/**` |
| `order` · `payment` · `notification` | 8084 · 8085 · 8086 | `/orders` · `/payments` · `/notifications` |
| `db` · `redis` | 5432 · 6379 | — |

<p class="small">Mesma porta dentro do container e na sua máquina: <code>http://catalog:8082</code> a partir de um container, <code>http://localhost:8082</code> a partir do terminal.</p>

---

## Convenções compartilhadas

- Pacotes `boxoffice.<serviço>`, Java 21, Spring Boot 4.1, sem Lombok.
- Cada serviço atende **só sob o seu prefixo** → roteamento sem reescrita.
- Um PostgreSQL, **um schema por serviço**, de propriedade das suas migrations Flyway.
- Os mesmos nomes de variáveis em todo lugar: `DB_HOST`, `DB_USER`, `REDIS_HOST`, `BASE_URL`…
- Erros como `problem+json` (RFC 9457); saúde em `/actuator/health`.

<div class="q">

Por que "um schema por serviço, sem joins entre schemas" é isolamento suficiente por enquanto?

</div>

---

## Um repositório para o semestre

```text
boxoffice/
  docker-compose.yaml     grows every lab
  services/               catalog, auth, gateway, inventory, ...
  infra/                  nginx, postgres, pgbouncer
  load/                   k6 scripts
  results/                lab0.md, lab1.md, ...  ← your measurements
  scripts/check-env.sh
```

- Faça commit e **tag** de cada lab: `git tag lab0`.
- `.env` e segredos **nunca** vão para o Git.

---

## Meça: o teto da sua máquina

```bash
docker run -d --rm --name hello -p 8888:80 nginx:1.30-alpine
k6 run -e VUS=1  load/hello.js
k6 run -e VUS=10 load/hello.js
k6 run -e VUS=50 load/hello.js
```

- O alvo quase não faz nada → o **melhor caso** do seu notebook.
- Todo número do BoxOffice depois será menor; a diferença é o custo de código, banco e saltos.

---

## Lendo um resumo do k6

| Linha | Significado |
|---|---|
| `http_reqs … /s` | **vazão** (RPS) |
| `http_req_duration med` | latência mediana (p50) |
| `p(95)`, `p(99)` | cauda: 1 em 20 / 1 em 100 é mais lenta |
| `http_req_failed` | taxa de erros |
| `vus` | **concorrência** (modelo fechado) |

<div class="ok">

Lei de Little: **VUs ≈ vazão × latência**. Confira nos seus próprios números.

</div>

---

## O que esperar de 1 → 10 → 50 VUs

<div class="cols">
<div>

- 1 VU: latência = tempo de serviço; RPS = 1 / latência.
- Mais VUs: o RPS cresce **enquanto há núcleos ociosos**.
- Depois da saturação: RPS **estável**, latência **cresce** com os VUs.

</div>
<div>

<div class="warn">

O k6 roda nos mesmos núcleos: a dezenas de milhares de RPS você também está medindo o k6.

</div>

</div>
</div>

---

## Primeiro contato com o playground

- O **System Design Playground** simula os mesmos componentes sob carga.
- Abra o cenário `monolith`: cliente → app → SQL.
- Aumente a carga até o p99 saltar. **Qual componente satura primeiro?**
- Anote a hipótese — o lab 2 a confronta com o seu `catalog` real.

---

## Entrega

- `check-env.sh` → **All set.**
- Repositório `boxoffice` no GitHub, com a tag `lab0`.
- `results/lab0.md`: tabela de referência (1, 10, 50 VUs) + verificação da Lei de Little.
- Hipótese do playground anotada.
- Quiz.

---

## Pontos-chave

1. Um ambiente quebrado custa horas depois: rode o `check-env.sh` **agora**.
2. Nomes, portas e variáveis de ambiente são um **contrato** de todos os labs.
3. Um schema por serviço, um prefixo por serviço: **independência** desde o primeiro dia.
4. Todo lab termina com uma **medição**, registrada em `results/`.
5. Vazão, percentis, concorrência: a **Lei de Little** liga tudo.
