Quinze minutos para mostrar um semestre de trabalho. A apresentação final não é um passeio por todas as aulas que vocês usaram — é uma **revisão de design**: este é o problema, esta é a arquitetura e o porquê, aqui está ela rodando sob carga, aqui está a evidência de que cumpre os SLOs, isto foi o que quebrou no game day, isto é quanto custa, e isto é o que faríamos a seguir. Depois os revisores fazem perguntas — para **cada** membro.

!!! abstract "Metas"

    Com este marco o seu time vai:

    - **Contar** a história do sistema numa fala estruturada e com tempo limitado, voltada para engenheiros.
    - **Demonstrar** o caminho principal ao vivo, sob carga, com dashboards — e ter um plano B.
    - **Defender** decisões e números: ADRs, resultados dos testes de carga, descobertas do game day, custo.
    - **Mostrar** domínio individual nas perguntas: todo membro explica e altera qualquer parte do sistema.
    - **Publicar** a documentação final e um vídeo de 3 minutos.

As apresentações acontecem nas **semanas 19–20** (agenda publicada pelo professor); peso de **10%** do projeto. A [qualidade da documentação](../index.md#documentation-quality-rubric) do site inteiro é avaliada no mesmo momento.

## O que entregar { #what-to-deliver }

- **Slides** (PDF ou um link na documentação), seguindo o [roteiro](#templates).
- Uma **demo ao vivo** durante a apresentação, mais uma **gravação reserva** da mesma demo.
- Um **vídeo de 3 minutos** do projeto (link na documentação).
- A **documentação final** no GitHub Pages e a tag final `final`.

## Critérios de aceitação { #acceptance-criteria }

- [ ] **(obrigatório)** **Todos os membros apresentam** uma parte da fala e respondem perguntas individuais.
- [ ] **(obrigatório)** Fala dentro de **15 minutos** (corte rígido), seguida de **10 minutos** de perguntas.
- [ ] O diagrama de arquitetura usa **ids da paleta** e corresponde ao sistema implantado (o design doc final).
- [ ] Uma **demo ao vivo** do caminho principal **sob carga** com os dashboards visíveis (ou a gravação reserva, se a demo ao vivo falhar — digam isso).
- [ ] Resultados dos testes de carga **contra os SLOs-alvo** (M6), descobertas do game day (M7) e custo por unidade de negócio (M8) apresentados com números.
- [ ] Pelo menos **duas ADRs** apresentadas como decisões com alternativas e consequências.
- [ ] **Vídeo de 3 minutos** publicado e linkado; ele se sustenta sozinho para quem não assistiu.
- [ ] Checklist da documentação final completo e tag `final` enviada antes do dia da apresentação.
- [ ] Seção *Uso de IA* na documentação final (veja a [política](../../index.md#use-of-ai-tools)).

## Passo a passo { #step-by-step }

### 1. Estruture os 15 minutos { #1-structure-the-15-minutes }

| Min | Seção | O que o público precisa levar |
|:-:|-|-|
| 0–1 | Problema e requisitos | A opção de sistema, os usuários, as metas de design e de teste, os SLOs |
| 1–4 | Arquitetura | Um diagrama com ids da paleta; o caminho da requisição do caso de uso principal; dono de cada dado |
| 4–6 | Decisões-chave | Duas ou três ADRs: a decisão, as alternativas, o trade-off |
| 6–10 | Demo ao vivo sob carga | O caminho principal funcionando enquanto o k6 roda; dashboard RED; um trace |
| 10–12 | Evidências | Campanha de testes de carga vs SLOs (joelho, gargalo, iterações); descobertas do game day |
| 12–14 | Custo | Custo mensal na meta de design, custo por unidade, a maior alavanca |
| 14–15 | Lições e próximos passos | O que vocês mudariam, do que o sistema precisaria com 10× |

Divida as seções para que **cada membro** apresente algo substancial (não só o slide de título). Ensaiem com cronômetro; o corte em 15:00 é real.

### 2. Prepare a demo — e o seu plano B { #2-prepare-the-demo-and-its-fallback }

Demos ao vivo falham por motivos banais: Wi-Fi, um cluster que não subiu, um token expirado. Prepare-se como um operador:

- [ ] Ambiente iniciado **30 minutos antes**, dados carregados, caches aquecidos, dashboards abertos em uma aba do navegador, fonte do terminal aumentada.
- [ ] Um **roteiro de demo**: os comandos e cliques exatos, em ordem, com o que o público deve notar em cada passo.
- [ ] Um gerador de carga a uma **taxa conhecida** (por exemplo, 50–70% da meta de teste) iniciado no começo da demo.
- [ ] Uma **gravação reserva** da mesma demo (captura de tela com narração), pronta para tocar se algo quebrar.
- [ ] Uma pessoa opera, outra narra.

```bash title="demo/start.sh"
#!/usr/bin/env bash
# Prepare the live demo: seed, warm up, start the background load.
set -euo pipefail
./load/seed.sh
k6 run -e TEST_TYPE=smoke -e BASE_URL="${BASE_URL:-http://localhost:8080}" load/boxoffice.js > /dev/null
nohup k6 run -e TEST_TYPE=load -e BASE_URL="${BASE_URL:-http://localhost:8080}" \
  -e BROWSE_RATE="${BROWSE_RATE:-600}" -e HOLD_RATE="${HOLD_RATE:-60}" \
  load/boxoffice.js > demo/k6-live.log 2>&1 &
echo "background load started (pid $!) — open the RED dashboard now"
```

### 3. Grave o vídeo de 3 minutos { #3-record-the-3-minute-video }

O vídeo é para quem nunca viu o curso: um recrutador, um futuro colega de time. Corte sugerido: problema e SLOs (20 s), arquitetura (40 s), o sistema sob carga com dashboards (60 s), um resultado da campanha e um do game day (40 s), custo e lições (20 s). Mantenha abaixo de **3 minutos**; legendas ou áudio claro; mostre o time.

### 4. Prepare-se para as perguntas { #4-prepare-for-the-qa }

As perguntas vão para **indivíduos**, e qualquer membro pode ser questionado sobre qualquer parte do sistema. Espere perguntas como:

- "Mostre o que acontece, componente a componente, quando um fã reserva um assento. Onde isso pode falhar?"
- "O seu p99 na meta foi 180 ms. O que domina esse valor? Como vocês sabem?"
- "Se o tráfego crescer 10×, o que quebra primeiro? O que vocês mudariam, e quanto custaria?"
- "Por que Kafka e não uma fila simples aqui? O que faria vocês mudarem de ideia?"
- "Mostre o alerta que disparou no game day. Qual é a janela de burn rate, e por quê?"
- "Esta parte foi escrita com ajuda de IA. Explique-a e mude este parâmetro: o que acontece?"

### 5. Finalize a documentação { #5-finish-the-documentation }

- [ ] Página inicial: time, tabela de responsabilidades, opção de sistema, resumo de um parágrafo, diagrama de arquitetura, links para todos os marcos.
- [ ] Design doc final e ADRs (com o registro de mudanças desde o M1).
- [ ] Relatório da campanha de testes de carga, relatório do game day, relatório de custos.
- [ ] Como executar: Compose e Kubernetes, carga de dados, rodar um teste de carga — testado a partir de um clone limpo.
- [ ] Links: repositório, execuções do CI, slides, vídeo, gravação da demo.
- [ ] Uso de IA por entregável.
- [ ] Tag `final` enviada; o site gerado a partir dela.

## Templates

=== "English"

    ~~~markdown
    # <System name> — final presentation (15 min)

    1. Title — team members, system option (who presents what)
    2. Problem — users, core use cases, design target vs test target
    3. SLOs — table: SLI, target, measured (M6)
    4. Architecture — diagram with palette ids; core request path
    5. Data — who owns what; consistency of the critical write
    6. Decision 1 (ADR) — context, options, decision, consequences
    7. Decision 2 (ADR) — ...
    8. Live demo — what to watch: <dashboard panels>, <trace>
    9. Load-test campaign — knee chart, bottleneck, 2 iterations (before/after)
    10. Game day — experiments, confirmed/refuted, surprise fault TTD/TTM
    11. Cost — monthly cost at the design target, cost per <unit>, top lever
    12. Lessons — what we would change; what 10× would need
    13. Thank you — links: docs, repository, video
    ~~~

=== "Português"

    ~~~markdown
    # <Nome do sistema> — apresentação final (15 min)

    1. Título — membros do time, opção de sistema (quem apresenta o quê)
    2. Problema — usuários, casos de uso principais, meta de design vs meta de teste
    3. SLOs — tabela: SLI, meta, medido (M6)
    4. Arquitetura — diagrama com ids da paleta; caminho da requisição principal
    5. Dados — quem é dono do quê; consistência da escrita crítica
    6. Decisão 1 (ADR) — contexto, opções, decisão, consequências
    7. Decisão 2 (ADR) — ...
    8. Demo ao vivo — o que observar: <painéis do dashboard>, <trace>
    9. Campanha de testes de carga — gráfico do joelho, gargalo, 2 iterações (antes/depois)
    10. Game day — experimentos, confirmados/refutados, falha surpresa TTD/TTM
    11. Custo — custo mensal na meta de design, custo por <unidade>, principal alavanca
    12. Lições — o que mudaríamos; o que 10× exigiria
    13. Obrigado — links: documentação, repositório, vídeo
    ~~~

## Rubrica { #rubric }

Níveis conforme definidos em [Como os exercícios são avaliados](../../index.md#how-the-exercises-are-graded). As perguntas individuais podem ajustar a nota de um membro (veja as [regras do time](../index.md#team-rules)).

| Critério | I | D | C | B | A |
|-|-|-|-|-|-|
| Participação e tempo **(obrigatório)** | Um membro ausente sem justificativa | Um membro não apresenta, ou > 17 min | Todos apresentam; dentro de 15 min | Partes equilibradas; transições suaves | Fala adaptada às perguntas na hora |
| História e arquitetura | — | Lista de tecnologias | Problema → SLOs → arquitetura → decisões | Diagrama com ids da paleta corresponde ao sistema implantado; trade-offs explícitos | Um revisor conseguiria redesenhar o sistema depois da fala |
| Demo ao vivo | Nada mostrado | Só a gravação reserva, sem explicação | Caminho principal funciona sob carga com dashboards | Demo ligada aos SLIs ("observem o p99 aqui") | Falha mostrada ao vivo e o sistema se recuperando |
| Evidências | — | Afirmações sem números | Números do M6, M7 e M8 apresentados | Números interpretados (joelho, gargalo, custo por unidade) | "O que faríamos com 10×" claro, com custo |
| Perguntas (individual) | Não consegue explicar o próprio trabalho | Respostas vagas | Respostas corretas na própria área | Respostas corretas em qualquer área | Raciocina sobre mudanças na hora, com números |
| Vídeo e documentação final | Ausentes | Vídeo > 3 min ou documentação incompleta | Vídeo ≤ 3 min; checklist da documentação completo | O vídeo se sustenta sozinho; documentação reprodutível a partir de um clone limpo | Qualidade de portfólio |

## FAQ

??? question "Podemos apresentar só uma gravação em vez de uma demo ao vivo?"

    Espera-se a demo ao vivo; a gravação é o **plano B**. Se a demo ao vivo falhar, troquem para a gravação sem perder tempo e digam o que falhou — lidar com isso com calma já é um bom sinal.

??? question "Precisamos de slides para todos os marcos?"

    Não. A fala é uma história, não um relatório: escolham as decisões, números e descobertas que melhor mostram como o sistema cumpre (ou não) os seus SLOs. Os detalhes ficam na documentação.

??? question "Quem responde às perguntas?"

    A pessoa perguntada. Os outros podem complementar depois da resposta. As perguntas são distribuídas entre todos os membros e podem tratar de qualquer parte do sistema.

??? question "O vídeo é o mesmo que a gravação da demo?"

    Não. A gravação da demo é a reserva da demo ao vivo; o vídeo é uma visão geral de 3 minutos do projeto inteiro para quem não assistiu.

??? question "A IA pode fazer os nossos slides?"

    Pode ajudar com layout e redação — declarem o uso. O conteúdo, os números e as respostas nas perguntas precisam ser de vocês.
