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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">Arquitetura de Sistemas · Insper · Lab 0</div>

# Lab 0 — Ambiente

**Um conjunto de ferramentas, um repositório, um conjunto de nomes — e uma primeira medição**

<!--
Roteiro: (1) o que o BoxOffice vira em 13 labs; (2) as ferramentas; (3) a tabela de serviços/portas;
(4) o repositório; (5) a medição de referência com k6; (6) primeiro contato com o playground.
-->

---

## BoxOffice, um lab de cada vez

<div class="q">

Um show em estádio abre a venda às 10:00: **2 M de fãs, 60 mil lugares**. O que precisa existir para essa manhã não ser um desastre?

</div>

<div class="flow">
<div class="box muted">fã / k6</div><div class="arrow">→</div>
<div class="box accent">edge<small>Nginx · lab 3</small></div><div class="arrow">→</div>
<div class="box orange">gateway + auth<small>lab 4</small></div><div class="arrow">→</div>
<div class="box">catalog ×3<small>lab 1 · cache lab 5</small></div>
<div class="box">inventory<small>lab 6 · réplica, PgBouncer</small></div>
<div class="box">order → payment<small>labs 7, 9</small></div>
</div>
<div class="flow">
<div class="box green">PostgreSQL<small>um schema por serviço</small></div>
<div class="box green">Redis · Kafka<small>labs 5, 7</small></div>
<div class="box">observabilidade<small>lab 8</small></div>
<div class="box accent">Kubernetes · entrega<small>labs 10, 11</small></div>
<div class="box red">inteligência artificial (IA)<small>assistente lab 12 · revisão lab 13</small></div>
</div>

<p class="small">O lab 2 <b>mede</b> onde um <code>catalog</code> quebra. Cada lab acrescenta uma caixa — e termina com uma medição.</p>

<!--
Cada lab acrescenta um componente da paleta e termina com uma medição. A venda relâmpago é o fio
que liga todos eles.
-->

---

## As ferramentas

| Ferramenta | Para |
|---|---|
| **Docker + Compose v2** | todo serviço e banco roda em um container |
| **kit de desenvolvimento Java (JDK, *Java Development Kit*) 21 + Maven** | serviços Spring Boot |
| **uv + Python 3.12** | scripts de resultados, assistente de IA (sem pip) |
| **k6** | testes de carga, escritos em JavaScript |
| **kubectl + kind/minikube** | Kubernetes local (lab 10) |
| **Git, jq, curl** | entrega e chamadas às APIs |

<div class="ok">

`bash scripts/check-env.sh` deve terminar com **All set.**

</div>

---

## Dê espaço ao Docker

- macOS e Windows: Docker Desktop → *Settings → Resources*.
- Linux: o Docker Engine usa a máquina inteira, sem máquina virtual (VM, *virtual machine*) no meio.

<div class="warn">

Os recursos padrão do Docker Desktop são pequenos: dê **≥ 4 unidades centrais de processamento (CPUs, *central processing units*) e 8 GB**, ou toda medição posterior fica distorcida.

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
- Erros como `problem+json` (RFC 9457, *Request for Comments*); saúde em `/actuator/health`.

<div class="q">

Por que "um schema por serviço, sem joins entre schemas" é isolamento suficiente por enquanto?

</div>

---

## Um repositório para o semestre

```text
boxoffice/
  compose.yaml            grows every lab
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
| `http_reqs … /s` | **vazão** (requisições por segundo, RPS, *requests per second*) |
| `http_req_duration med` | latência mediana (p50) |
| `p(95)`, `p(99)` | cauda, os percentis 95 e 99 (p95, p99): 1 em 20 / 1 em 100 é mais lenta |
| `http_req_failed` | taxa de erros |
| `vus` | **concorrência**: usuários virtuais (VUs, *virtual users*), um modelo fechado |

---

## Um modelo fechado: cada VU espera a resposta

<div class="flow">
<div class="box accent">o VU manda <code>GET /</code></div><div class="arrow">→</div>
<div class="box">o Nginx responde<small>depois de W, a latência</small></div><div class="arrow">→</div>
<div class="box accent">o VU manda de novo<small>na hora, sem tempo de pensar</small></div><div class="arrow">→</div>
<div class="box muted">…<small>1 / W requisições por segundo por VU</small></div>
</div>

- 10 VUs → vazão λ = 10 / W → **L = λ × W = 10** requisições dentro, seja qual for o servidor.
- O gerador de carga fixa L; a latência do servidor fixa a vazão.
- Quando o servidor fica lento, um modelo fechado manda **menos** — o lab 2 mostra por que isso esconde a sobrecarga.

<div class="ok">

Lei de Little: **VUs ≈ vazão × latência**. Confira nos seus próprios números.

</div>

---

## O que esperar de 1 → 10 → 50 VUs

<div class="cols">
<div>

<div class="flow">
<div class="box green">1 VU<small>latência = tempo de serviço · RPS = 1 / latência</small></div><div class="arrow">→</div>
<div class="box accent">10 VUs<small>o RPS cresce <b>enquanto há núcleos ociosos</b></small></div><div class="arrow">→</div>
<div class="box red">50 VUs<small>depois da saturação: RPS <b>estável</b>, latência <b>cresce</b> com os VUs</small></div>
</div>

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
- Abra o cenário `monolith`: cliente → app → banco SQL (*Structured Query Language*).
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
