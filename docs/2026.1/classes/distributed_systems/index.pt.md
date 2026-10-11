
Sistemas distribuídos representam um paradigma computacional em que vários computadores independentes colaboram para atingir um objetivo comum, apresentando-se ao usuário final como um único sistema coerente. Diferentemente dos sistemas centralizados, em que todo o processamento ocorre em uma única máquina, os sistemas distribuídos se estendem por redes e aproveitam nós interconectados para lidar com armazenamento de dados, computação e comunicação.

Essa arquitetura sustenta as plataformas de nuvem modernas (AWS, Google Cloud, Azure), as aplicações de grande escala (redes sociais, e-commerce) e as simulações científicas. O desafio fundamental é que os nós operam de forma independente, comunicam-se apenas por troca de mensagens e não têm um relógio compartilhado — o que torna a coordenação um problema de engenharia nada trivial.

---

## Classificação

Os sistemas distribuídos podem ser classificados segundo vários eixos:

| Dimensão | Opção A | Opção B |
|---|---|---|
| **Uniformidade de hardware/software** | Homogêneo — todos os nós executam a mesma pilha | Heterogêneo — hardware e sistemas operacionais diversos |
| **Acoplamento** | Fortemente acoplado — alta interdependência, memória compartilhada | Fracamente acoplado — comunicação por mensagens, ciclo de vida independente |
| **Topologia** | Cliente-servidor — hierárquica, os servidores detêm os recursos | Peer-to-peer — igualitária, todos os nós compartilham recursos |

Aplicações web seguem o modelo cliente-servidor (navegadores fazem requisições a servidores). Sistemas de compartilhamento de arquivos como o BitTorrent seguem o modelo peer-to-peer. A maioria das arquiteturas de microsserviços ocupa o meio-termo fracamente acoplado.

---

## Vantagens

| Benefício | Como |
|---|---|
| **Escalabilidade horizontal** | Adicionam-se nós em vez de fazer upgrade de uma única máquina. O Cassandra escala para petabytes adicionando nós de forma transparente. |
| **Tolerância a falhas** | A replicação entre nós mantém o sistema funcionando apesar de falhas individuais. O Google Spanner usa replicação síncrona entre datacenters. |
| **Compartilhamento de recursos** | A capacidade ociosa de muitas máquinas é agregada. O Folding@home reúne ciclos de CPU para workloads científicos. |
| **Paralelismo** | As tarefas são divididas e processadas concorrentemente. O MapReduce (Hadoop) exemplifica isso em análises de big data. |
| **Redução de latência** | Nós posicionados perto dos usuários reduzem o tempo de ida e volta. CDNs como a Akamai servem conteúdo a partir do ponto de borda mais próximo. |

---

## Desvantagens

| Desafio | Causa raiz |
|---|---|
| **Complexidade** | Coordenação, sincronização e estado distribuído são difíceis de entender e de implementar corretamente. |
| **Sobrecarga de rede** | Mensagens podem ser atrasadas, perdidas ou duplicadas. Cada modo de falha precisa ser tratado explicitamente. |
| **Consistência vs disponibilidade** | Manter os dados consistentes entre os nós e, ao mesmo tempo, permanecer disponível sob falhas é comprovadamente impossível — veja o Teorema CAP. |
| **Superfície de ataque ampliada** | Mais nós significam mais pontos de entrada. Falhas bizantinas (nós maliciosos) exigem protocolos dedicados. |
| **Custo operacional** | Depurar, monitorar e fazer o deploy de sistemas distribuídos exige ferramentas especializadas (Prometheus, Kubernetes, rastreamento distribuído). |

### As 8 falácias da computação distribuída

Peter Deutsch[^2] identificou oito suposições que os desenvolvedores costumam fazer ao construir sistemas distribuídos — todas erradas:

| Falácia | Realidade |
|---|---|
| A rede é confiável | Pacotes são descartados, links falham, cabos são cortados |
| A latência é zero | Idas e voltas pela rede somam milissegundos; entre regiões, centenas |
| A largura de banda é infinita | Transferir payloads grandes satura os links |
| A rede é segura | O tráfego precisa ser criptografado e autenticado em cada salto |
| A topologia não muda | Nós sobem e caem; IPs mudam; serviços são reagendados |
| Existe um único administrador | Vários times, várias contas de nuvem, várias políticas |
| O custo de transporte é zero | Serialização, compressão e taxas de egress são reais |
| A rede é homogênea | Sistemas diferentes falam protocolos e codificações diferentes |

!!! warning "Projete para a falha, não contra ela"
    Essas falácias têm uma raiz comum: tratar a rede como uma chamada de função local confiável. A postura correta é assumir que a falha vai acontecer e projetar cada interação para se degradar de forma controlada.

---

## Tópicos abordados

<div class="grid cards" markdown>

-   :material-scale-balance:{ .lg .middle } **Teorema CAP**

    ---

    O trade-off central dos armazenamentos de dados distribuídos: Consistência, Disponibilidade e Tolerância a Partições não podem ser garantidas simultaneamente. Entenda as classes de sistemas CP, AP e CA — e a extensão PACELC.

    [:octicons-arrow-right-24: Teorema CAP](cap/index.md)

-   :material-handshake:{ .lg .middle } **Consenso e algoritmos**

    ---

    Como nós distribuídos chegam a um acordo apesar das falhas. Aborda Paxos, Raft, sistemas de quórum, modelos de falha (crash-stop, bizantino), o resultado de impossibilidade FLP e a consistência eventual.

    [:octicons-arrow-right-24: Consenso e algoritmos](consensus/index.md)

</div>

---

[^1]: LAMPORT, L. [Time, Clocks, and the Ordering of Events in a Distributed System](https://lamport.azurewebsites.net/pubs/time-clocks.pdf){target="_blank"}. CACM, 1978.
[^2]: DEUTSCH, P. [Fallacies of Distributed Computing](https://en.wikipedia.org/wiki/Fallacies_of_distributed_computing){target="_blank"}, 1994.
