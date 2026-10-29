Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

**Q1.** No BoxOffice, o `catalog` escuta na porta **8082** dentro do container *e* na sua máquina. A partir do container do `gateway`, qual URL chega até ele?

- A. `http://localhost:8082`
- B. `http://catalog:8082`
- C. `http://127.0.0.1:8082`
- D. `http://host.docker.internal:80`

??? success "Resposta"
    **B — `http://catalog:8082`.**

    Containers do mesmo projeto Compose compartilham uma rede em que cada **nome de serviço é um nome DNS**. Dentro do container do `gateway`, `localhost` é o próprio gateway, então A e C apontam para o processo errado. `host.docker.internal` chega à sua máquina, não a um container vizinho. Do seu *terminal* (fora do Docker), `http://localhost:8082` funciona porque a porta está publicada.

---

**Q2.** Por que cada serviço do BoxOffice atende os seus endpoints apenas sob o próprio prefixo (`/catalog/...`, `/auth/...`)?

- A. O Spring Boot exige um prefixo em todo controller
- B. Para que o edge e o gateway possam rotear pelo caminho sem reescrevê-lo, e dois serviços nunca disputem o mesmo caminho
- C. Para deixar as URLs mais longas e difíceis de adivinhar
- D. Porque o Nginx não consegue fazer proxy do caminho raiz `/`

??? success "Resposta"
    **B — Roteamento por caminho sem reescritas.**

    Com prefixos únicos, uma regra de roteamento é uma linha (`/catalog/** → catalog`) em todas as camadas — Nginx, gateway, um Ingress do Kubernetes. Sem eles, `catalog` e `inventory` poderiam querer `/events/...` e todo proxy precisaria de regras de reescrita, uma fonte clássica de bugs.

---

**Q3.** O BoxOffice usa **uma** instância PostgreSQL com **um schema por serviço**. Qual regra mantém os serviços independentes?

- A. Todo serviço pode ler todo schema, mas só o `catalog` escreve
- B. Cada schema é criado e alterado apenas pelas migrations do serviço dono dele, e os serviços nunca fazem join entre schemas
- C. Todos os serviços compartilham uma única tabela de histórico do Flyway
- D. Os schemas são criados à mão pelo professor antes de cada lab

??? success "Resposta"
    **B — Propriedade: um serviço, um schema, nada de joins entre schemas.**

    A instância única é um atalho amigável para o notebook; o que importa é a separação *lógica*. Se o `order` fizesse join com `catalog.events`, uma mudança na tabela do `catalog` quebraria o `order` — um acoplamento escondido. Manter cada schema privado permite, depois, mover um serviço para o seu próprio servidor de banco sem tocar nos outros.

---

**Q4.** Você rodou `k6 run -e VUS=10 load/hello.js` e obteve **20.000 req/s** com latência média de **0,5 ms**. O que a Lei de Little (`L = λ × W`) prevê para a concorrência?

- A. 1
- B. 10
- C. 40
- D. 20.000

??? success "Resposta"
    **B — 10.**

    `L = λ × W = 20.000 req/s × 0,0005 s = 10`. Em um modelo fechado sem tempo de pensar, o número de requisições no sistema é igual ao número de VUs. Quando o valor calculado difere muito dos VUs configurados, parte do tempo está sendo gasta fora da requisição medida (por exemplo, no próprio k6).

---

**Q5.** Com 1 VU, uma requisição leva 2 ms. Ignorando qualquer limite, qual é a vazão máxima que esse único VU consegue gerar?

- A. 2 req/s
- B. 50 req/s
- C. 500 req/s
- D. 2.000 req/s

??? success "Resposta"
    **C — 500 req/s.**

    Um VU de modelo fechado só envia a próxima requisição depois que a resposta anterior chega: `1 / 0,002 s = 500 req/s`. É por isso que "quantos VUs?" e "quantas requisições por segundo?" são perguntas diferentes — os mesmos VUs produzem menos vazão quando o servidor fica mais lento.

---

**Q6.** Entre 10 e 50 VUs a sua vazão fica em ~20.000 req/s, mas o p99 cresce de 1 ms para 5 ms. O que aconteceu?

- A. A placa de rede falhou
- B. O k6 tem um bug com mais de 10 VUs
- C. A CPU já estava saturada com 10 VUs: os VUs extras só esperam em filas, então a latência cresce enquanto a vazão fica estável
- D. O Nginx começou a fazer cache das respostas

??? success "Resposta"
    **C — Saturação: fila no lugar de trabalho.**

    Quando o recurso gargalo está totalmente ocupado, a vazão não cresce; a concorrência extra vira tempo de espera (Lei de Little de novo: 5× os VUs com o mesmo λ → 5× a latência). Reconhecer essa assinatura, "vazão estável, latência subindo", é a habilidade central do lab 2.

---

**Q7.** Por que o p99 é mais útil que a latência média para descrever a experiência do usuário?

- A. A média é mais difícil de calcular
- B. A média esconde a cauda lenta: 1% das requisições (e muito mais usuários, que fazem várias requisições por página) pode ser muito mais lento que a média
- C. O p99 é sempre menor que a média
- D. O k6 não reporta médias

??? success "Resposta"
    **B — A média esconde a cauda.**

    Uma página que dispara 20 requisições cai na cauda do p99 em cerca de `1 − 0,99²⁰ ≈ 18%` dos carregamentos. Médias misturam poucas requisições muito lentas com muitas rápidas e parecem boas enquanto os usuários sofrem. A aula 2 (percentis) explora isso a fundo.

---

**Q8.** O seu notebook tem 8 núcleos, mas o Docker Desktop está configurado com 2 CPUs. O que acontece com os resultados dos seus testes de carga?

- A. Nada, o Docker sempre usa todos os núcleos
- B. Todos os containers dividem essas 2 CPUs: serviços, bancos e (se estiver em container) o k6 competem, e a capacidade medida é menor do que a máquina poderia dar
- C. Só containers Java são afetados
- D. O k6 compensa o limite automaticamente

??? success "Resposta"
    **B — A VM do Docker é a sua máquina de verdade.**

    No macOS e no Windows, os containers rodam dentro de uma VM com os recursos definidos no Docker Desktop. Registre esses números em `results/lab0.md`: sem eles, ninguém (nem você, três semanas depois) consegue comparar medições.

---

**Q9.** Por que criar uma tag no repositório ao fim de cada lab (`git tag lab4`)?

- A. O GitHub exige tags em repositórios privados
- B. Tags deixam o build mais rápido
- C. Para ter um estado nomeado e reproduzível: `git diff lab4 lab5` mostra o que mudou quando um lab posterior quebra algo, e uma medição sempre pode ser ligada ao código que a produziu
- D. Tags são necessárias para rodar o Docker Compose

??? success "Resposta"
    **C — Reprodutibilidade e diffs.**

    Uma medição sem o código e a configuração exatos que a produziram é uma anedota. Tags são o jeito mais barato de ligar resultados a versões — a mesma ideia por trás de tags imutáveis de imagem e do GitOps no lab 11.

---

**Q10.** Qual arquivo **nunca** deve ir para o commit do seu repositório BoxOffice?

- A. `docker-compose.yaml`
- B. `load/hello.js`
- C. `.env` com senhas ou chaves de API reais
- D. `results/lab0.md`

??? success "Resposta"
    **C — Segredos ficam fora do Git.**

    Tudo que vai para o Git deve ser considerado público para sempre (o histórico guarda mesmo depois de apagar). Os padrões dos labs (`boxoffice`/`boxoffice`) são valores locais descartáveis; segredos reais vão para um gerenciador de segredos, tema da aula 12.
