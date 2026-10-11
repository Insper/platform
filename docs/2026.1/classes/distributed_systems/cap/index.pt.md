
O **Teorema CAP**, proposto por Eric Brewer em 2000 e formalmente provado por Seth Gilbert e Nancy Lynch em 2002[^1], afirma que um sistema distribuído que replica dados entre nós **não consegue garantir simultaneamente as três** propriedades a seguir:

[![Diagrama de Euler do Teorema CAP](https://upload.wikimedia.org/wikipedia/commons/9/98/CAP_Theorem_Euler_Diagram.png){ width="55%" }](https://en.wikipedia.org/wiki/CAP_theorem){target="_blank"}

---

## As três propriedades

**Consistência (C)**
: Toda leitura retorna a escrita mais recente, ou um erro. Todos os nós veem os mesmos dados ao mesmo tempo — o equivalente à *linearizabilidade* em programação concorrente. Em um sistema consistente, é impossível ler dados desatualizados.

**Disponibilidade (A)**
: Toda requisição recebe uma resposta que não é de erro. O sistema permanece operacional enquanto pelo menos um nó estiver em execução, ainda que a resposta possa não conter a escrita mais recente.

**Tolerância a Partições (P)**
: O sistema continua operando apesar de partições arbitrárias da rede — mensagens perdidas ou atrasadas entre os nós. Partições são um fato inevitável em qualquer rede distribuída real; falhas de hardware, congestionamento e distâncias físicas podem causá-las.

!!! warning "Tolerância a partições não é opcional"
    Em qualquer sistema distribuído do mundo real, partições de rede *vão* acontecer. A escolha prática, portanto, é entre **C** e **A** durante uma partição — e não se **P** será incluída ou não.

---

## Classes de sistemas

### CP — Consistente e tolerante a partições

Durante uma partição, o sistema recusa requisições em vez de retornar dados possivelmente desatualizados. Quando a partição se resolve, a consistência é restaurada antes de voltar a atender.

**Exemplos:** PostgreSQL em modo distribuído, MongoDB (configuração padrão), Apache ZooKeeper, etcd.

**Use quando:** a correção é inegociável — transações financeiras, sistemas de estoque, repositórios de identidade.

```
Node A ──── [partition] ──── Node B
   │                            │
Client                       Returns error
writes here                  (unavailable)
```

### AP — Disponível e tolerante a partições

Durante uma partição, todos os nós continuam respondendo, mas podem divergir e retornar dados diferentes. Depois que a partição se resolve, o sistema converge para um estado consistente (*consistência eventual*).

**Exemplos:** Apache Cassandra, Amazon DynamoDB, CouchDB, DNS.

**Use quando:** a disponibilidade importa mais do que a precisão momentânea — carrinhos de compras, feeds de redes sociais, índices de busca.

```
Node A ──── [partition] ──── Node B
   │                            │
Client A sees              Client B sees
version 5                  version 4 (stale)
         ← converge after partition heals →
```

### CA — Consistente e disponível

Pressupõe que não há partições, o que só é realista para sistemas de uma única máquina ou LANs rigidamente controladas. Não é uma categoria prática para sistemas distribuídos.

---

## Tabela comparativa

| | CP | AP | CA |
|---|---|---|---|
| **Consistência** | ✅ Sempre | ❌ Eventualmente | ✅ Sempre |
| **Disponibilidade** | ❌ Durante a partição | ✅ Sempre | ✅ Sempre |
| **Tolerância a partições** | ✅ | ✅ | ❌ (irrealista) |
| **Trade-off** | Rejeita requisições durante a partição | Retorna dados possivelmente desatualizados | Só funciona em um único nó |
| **Exemplos** | ZooKeeper, etcd, PostgreSQL | Cassandra, DynamoDB, DNS | SGBD relacional de nó único |

---

## A extensão PACELC

O teorema CAP trata apenas do cenário de partição. O **PACELC** (Daniel Abadi, 2010)[^2] o estende perguntando: *mesmo quando não há partição, qual é o trade-off?*

```
If Partition:
  → choose between Availability and Consistency
Else (normal operation):
  → choose between Latency and Consistency
```

| Sistema | Comportamento na partição | Comportamento normal | Classificação |
|---|---|---|---|
| Cassandra | Favorece A | Favorece L (baixa latência) | PA/EL |
| DynamoDB | Favorece A | Favorece L | PA/EL |
| MongoDB | Favorece C | Favorece C | PC/EC |
| PostgreSQL | Favorece C | Favorece C | PC/EC |

O PACELC é mais útil do que o CAP para as escolhas de banco de dados do dia a dia, porque na maior parte do tempo não há partição — mas o trade-off entre latência e consistência está sempre presente.

---

## Implicações práticas para o projeto de sistemas

**Catálogo de produtos de e-commerce** → AP
: Mostrar um produto como disponível em estoque logo depois de ele ter esgotado é aceitável. Um breve período de dados desatualizados não compromete a correção.

**Carrinho de compras** → AP
: Adicionar um item a um carrinho que diverge temporariamente entre as réplicas não é problema; o carrinho pode ser reconciliado no checkout.

**Processamento de pagamentos** → CP
: Uma cobrança em dobro ou um débito perdido não pode ser reconciliado depois do fato. A consistência é obrigatória.

**Autenticação de usuários** → CP
: Um token revogado precisa ficar imediatamente inválido em todos os nós. Estado de autenticação desatualizado é uma vulnerabilidade de segurança.

!!! tip "A maioria dos sistemas combina os dois"
    Uma mesma aplicação pode usar um armazenamento AP (Cassandra) para logs de atividade de usuários e um armazenamento CP (PostgreSQL) para registros financeiros. Escolha por domínio de dados, não por aplicação.

---

[^1]: GILBERT, S.; LYNCH, N. [Brewer's Conjecture and the Feasibility of Consistent, Available, Partition-Tolerant Web Services](https://dl.acm.org/doi/10.1145/564585.564601){target="_blank"}. ACM SIGACT News, 2002.
[^2]: ABADI, D. [Consistency Tradeoffs in Modern Distributed Database System Design](https://cs.yale.edu/homes/abadi/papers/pacelc.pdf){target="_blank"}. IEEE Computer, 2012.
[^3]: [Teorema CAP — Wikipedia](https://en.wikipedia.org/wiki/CAP_theorem){target="_blank"}
[^4]: [Teorema PACELC](https://www.geeksforgeeks.org/operating-systems/pacelc-theorem/){target="_blank"}
