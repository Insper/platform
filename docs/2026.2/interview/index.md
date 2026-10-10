---
hide:
  - toc
---

<div class="iv">

  <!-- HEADER -->
  <header class="site-header">
    <div class="header-meta">
      <span class="badge badge-green">Coding Interview Prep</span>
      <span class="badge badge-blue">System Design</span>
      <span class="badge badge-gray">2026.2</span>
    </div>
    <h1>System Design &amp; Scalability</h1>
    <p>Material de apoio para entrevistas técnicas — como pensar, comunicar e projetar sistemas escaláveis. Baseado em <em>Cracking the Coding Interview</em> (G. McDowell) e referências de engenharia de software de alto nível, conectado aos tópicos e hands-ons da disciplina.</p>
  </header>

  <!-- TABLE OF CONTENTS -->
  <nav class="toc" aria-label="Sumário">
    <h2>Sumário</h2>
    <div class="toc-grid">
      <a href="#sec-intro">Algorithms vs. System Design</a>
      <a href="#sec-abordagem">Handling the Questions (8 princípios)</a>
      <a href="#sec-design">Design Step-By-Step (5 passos)</a>
      <a href="#sec-algo">Algorithms that Scale (4 passos)</a>
      <a href="#sec-numbers">Back-of-the-Envelope</a>
      <a href="#sec-concepts">Key Concepts</a>
      <a href="#sec-example">Exemplo Guiado: URL Shortener</a>
      <a href="#sec-practice">Problemas para Praticar</a>
      <a href="#sec-course">Conexão com a Disciplina</a>
      <a href="#sec-quiz">Quiz</a>
      <a href="#sec-checklist">Checklist de Entrevista</a>
      <a href="#sec-refs">Referências</a>
    </div>
  </nav>

  <!-- ═══════════════════════════════════════════════
       SECTION 1 — INTRO
  ════════════════════════════════════════════════ -->
  <section class="section" id="sec-intro">
    <div class="section-header">
      <h2>Algorithms vs. System Design</h2>
      <p>Dois tipos de problema, duas habilidades distintas — mas a mesma lógica de raciocínio estruturado.</p>
    </div>

    <div class="card-grid">
      <div class="card border-green">
        <div class="card-label green">Algorithm Questions</div>
        <h3>Problema fechado</h3>
        <p>Geralmente têm solução determinística. O foco está na correção do algoritmo, na complexidade O(n) e na implementação limpa. Exemplos: "encontre o caminho mais curto", "verifique se uma árvore é BST".</p>
      </div>
      <div class="card border-blue">
        <div class="card-label blue">System Design Questions</div>
        <h3>Problema aberto</h3>
        <p>Não existe resposta única. O foco está nos tradeoffs, na escalabilidade, na comunicação e no raciocínio de engenharia. Exemplos: "projete o Twitter", "projete um sistema de encurtamento de URLs para 100M de usuários".</p>
      </div>
    </div>

    <div class="callout">
      <p><strong>"Tackle the problem by doing it just like you would at work."</strong><br>
      Faça perguntas. Engaje o entrevistador. Discuta os tradeoffs. Não existe resposta perfeita — existe raciocínio bem articulado e soluções justificadas.</p>
    </div>

    <div class="itip">
      <div class="itip-label">Mindset essencial</div>
      <p>Em system design, o entrevistador quer ver <strong>como você pensa</strong>, não apenas o que você memorizou. Um candidato que faz boas perguntas, explicita suas assunções e admite incertezas com raciocínio sólido frequentemente supera um candidato que tenta recitar uma arquitetura pronta.</p>
    </div>

    <h3 class="sub-h">O que o entrevistador avalia</h3>
    <div class="tag-strip">
      <span class="badge badge-green">Comunicação clara</span>
      <span class="badge badge-blue">Raciocínio estruturado</span>
      <span class="badge badge-amber">Conhecimento técnico</span>
      <span class="badge badge-purple">Gestão de tradeoffs</span>
      <span class="badge badge-coral">Estimativas realistas</span>
      <span class="badge badge-gray">Identificar gargalos</span>
    </div>

    <div class="table-wrap" style="margin-top:16px;"><table class="cmp-table">
      <thead>
        <tr>
          <th>Aspecto</th>
          <th>Algorithm Interview</th>
          <th>System Design Interview</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>Resposta correta</td><td>Determinística, geralmente única</td><td>Múltiplas soluções válidas</td></tr>
        <tr><td>Foco</td><td>Correção e complexidade</td><td>Tradeoffs e escalabilidade</td></tr>
        <tr><td>Duração típica</td><td>20–45 min</td><td>45–60 min</td></tr>
        <tr><td>Comunicação</td><td>Importante</td><td>Crítica — é a principal avaliação</td></tr>
        <tr><td>Lousa/diagrama</td><td>Útil</td><td>Obrigatório</td></tr>
      </tbody>
    </table></div>
  </section>

  <hr class="section-divider">

  <!-- ═══════════════════════════════════════════════
       SECTION 2 — HANDLING THE QUESTIONS
  ════════════════════════════════════════════════ -->
  <section class="section" id="sec-abordagem">
    <div class="section-header">
      <h2>Handling the Questions</h2>
      <p>8 princípios para conduzir a entrevista de system design com confiança e clareza.</p>
    </div>

    <div class="step-list">
      <div class="step-item">
        <div class="step-num green">1</div>
        <div class="step-body">
          <strong>Communicate</strong>
          <span>Pense em voz alta. O entrevistador quer acompanhar seu raciocínio, não apenas ver a solução final. Silêncio prolongado é o maior inimigo numa entrevista de system design — mesmo que você ainda não saiba a resposta, verbalize o que está pensando: "estou considerando usar um cache aqui porque..."</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num green">2</div>
        <div class="step-body">
          <strong>Go broad first</strong>
          <span>Antes de mergulhar em detalhes, esboce o sistema inteiro em alto nível. Estabeleça os componentes principais antes de aprofundar em qualquer um deles. Detalhar prematuramente um componente que depois precisa ser redesenhado é um erro comum.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num green">3</div>
        <div class="step-body">
          <strong>Use the whiteboard</strong>
          <span>Desenhe! Diagramas ajudam tanto o entrevistador quanto você a manter o raciocínio organizado. Um diagrama de blocos claro comunica mais do que minutos de explicação verbal. Comece simples e refine.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num green">4</div>
        <div class="step-body">
          <strong>Acknowledge interviewer concerns</strong>
          <span>Se o entrevistador fizer uma objeção ou apontar um problema, não ignore nem defenda a posição a todo custo. Diga: "boa observação, deixa eu reconsiderar essa parte". Isso demonstra maturidade técnica e abertura para feedback.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num green">5</div>
        <div class="step-body">
          <strong>Be careful about assumptions</strong>
          <span>Assunções implícitas são armadilhas. Se você assumir que o sistema tem 1.000 usuários quando na verdade são 1 bilhão, toda a sua solução pode estar errada. Pergunte antes de assumir.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num green">6</div>
        <div class="step-body">
          <strong>State your assumptions explicitly</strong>
          <span>Quando precisar assumir algo (o que é inevitável), diga em voz alta: "vou assumir que o sistema precisa suportar 10M de usuários ativos por dia, com pico de 100k req/s". O entrevistador pode corrigir, confirmar ou dar mais contexto.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num green">7</div>
        <div class="step-body">
          <strong>Estimate when necessary</strong>
          <span>Back-of-envelope calculations são esperadas e valorizadas. Saiba fazer estimativas rápidas de throughput, storage e bandwidth. Ex.: "1M de usuários × 100KB/usuário = ~100GB de storage". Não precisa ser exato — a ordem de grandeza é o que importa.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num green">8</div>
        <div class="step-body">
          <strong>Drive</strong>
          <span>Você lidera a sessão. Não espere o entrevistador dizer o que fazer a seguir. Proponha o próximo passo: "vou focar agora no database layer, tudo bem?" ou "identifico dois gargalos principais — deixa eu abordar o mais crítico primeiro". Mostre protagonismo.</span>
        </div>
      </div>
    </div>

    <div class="callout callout-amber">
      <p><strong>Dica prática:</strong> Use transições explícitas entre etapas. Ao passar de "componentes principais" para "identificar gargalos", diga: <em>"Agora que temos os componentes principais, vou identificar onde estão os pontos críticos desse sistema."</em> Isso mantém o entrevistador orientado na sua estrutura.</p>
    </div>
  </section>

  <hr class="section-divider">

  <!-- ═══════════════════════════════════════════════
       SECTION 3 — DESIGN STEP BY STEP
  ════════════════════════════════════════════════ -->
  <section class="section" id="sec-design">
    <div class="section-header">
      <h2>Design: Step-By-Step</h2>
      <p>Estrutura em 5 passos para projetar sistemas complexos de forma organizada durante a entrevista.</p>
    </div>

    <div class="step-list">
      <div class="step-item">
        <div class="step-num amber">1</div>
        <div class="step-body">
          <strong>Scope the Problem</strong>
          <span>Faça perguntas para delimitar o problema. Quantos usuários? Quais features são essenciais vs. nice-to-have? O sistema é leitura-intensiva ou escrita-intensiva? É necessária consistência forte ou eventual é suficiente? Defina o escopo antes de qualquer arquitetura. Perguntas típicas: "Quais são as principais features que devo projetar?", "Qual a escala esperada em 1 ano?", "Há restrições de latência?"</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num amber">2</div>
        <div class="step-body">
          <strong>Make Reasonable Assumptions</strong>
          <span>Com o escopo definido, declare assunções explícitas: "vou assumir 10M DAU, pico de 100k req/s, disponibilidade de 99.9% (downtime máximo de ~8.7h/ano), e que o sistema é muito mais read-heavy do que write-heavy (100:1)". Isso ancora toda a conversa seguinte e demonstra que você pensa em métricas concretas.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num amber">3</div>
        <div class="step-body">
          <strong>Draw the Major Components</strong>
          <span>Esboce os blocos principais: clients → load balancers → web/app servers → caches → databases → message queues → CDN. Não entre em detalhes ainda — visão macro primeiro. Cada bloco deve ter um propósito claro. Rotule as setas com o tipo de dado que flui entre os componentes.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num amber">4</div>
        <div class="step-body">
          <strong>Identify the Key Issues</strong>
          <span>Onde estão os gargalos? Quais são os single points of failure? Quais componentes vão "quebrar" primeiro com o crescimento? O banco de dados é o gargalo de leitura? O servidor de aplicação tem estado que impede escalar horizontalmente? Identifique os pontos críticos antes de propor soluções.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num amber">5</div>
        <div class="step-body">
          <strong>Redesign for the Key Issues</strong>
          <span>Agora você aprofunda: adiciona sharding no banco, caching em hot paths, escala horizontal nos app servers, CDN para assets estáticos, filas para processamento assíncrono. Redesenhe iterativamente com foco nos problemas identificados. Justifique cada decisão com os tradeoffs envolvidos.</span>
        </div>
      </div>
    </div>

    <!-- DIAGRAMA SVG -->
    <div class="diagram-wrap">
      <div class="diagram-label">exemplo — arquitetura de URL shortener escalável</div>
      <svg viewBox="0 0 800 260" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="a" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0,8 3,0 6" fill="#9a9a94"/>
          </marker>
        </defs>
        <rect width="800" height="260" fill="none"/>

        <!-- CDN -->
        <rect x="8" y="108" width="70" height="36" rx="6" fill="#EAF3DE" stroke="#639922" stroke-width="1"/>
        <text x="43" y="122" text-anchor="middle" font-size="10" fill="#27500A" font-family="JetBrains Mono,monospace" font-weight="500">CDN</text>
        <text x="43" y="135" text-anchor="middle" font-size="9" fill="#3B6D11" font-family="JetBrains Mono,monospace">static</text>

        <!-- Client -->
        <rect x="88" y="108" width="72" height="36" rx="6" fill="#E1F5EE" stroke="#1D9E75" stroke-width="1"/>
        <text x="124" y="122" text-anchor="middle" font-size="10" fill="#085041" font-family="JetBrains Mono,monospace" font-weight="500">Client</text>
        <text x="124" y="135" text-anchor="middle" font-size="9" fill="#0F6E56" font-family="JetBrains Mono,monospace">browser/app</text>

        <!-- arrows client <-> CDN -->
        <line x1="78" y1="120" x2="88" y2="120" stroke="#9a9a94" stroke-width=".8" marker-end="url(#a)"/>
        <line x1="88" y1="130" x2="78" y2="130" stroke="#9a9a94" stroke-width=".8" marker-end="url(#a)"/>

        <!-- arrow client -> LB -->
        <line x1="160" y1="126" x2="188" y2="126" stroke="#9a9a94" stroke-width=".8" marker-end="url(#a)"/>

        <!-- Load Balancer -->
        <rect x="188" y="108" width="82" height="36" rx="6" fill="#FAEEDA" stroke="#EF9F27" stroke-width="1"/>
        <text x="229" y="122" text-anchor="middle" font-size="10" fill="#633806" font-family="JetBrains Mono,monospace" font-weight="500">Load</text>
        <text x="229" y="135" text-anchor="middle" font-size="10" fill="#633806" font-family="JetBrains Mono,monospace">Balancer</text>

        <!-- arrows LB -> app servers -->
        <line x1="270" y1="116" x2="300" y2="96" stroke="#9a9a94" stroke-width=".8" marker-end="url(#a)"/>
        <line x1="270" y1="126" x2="300" y2="126" stroke="#9a9a94" stroke-width=".8" marker-end="url(#a)"/>
        <line x1="270" y1="136" x2="300" y2="156" stroke="#9a9a94" stroke-width=".8" marker-end="url(#a)"/>

        <!-- App servers -->
        <rect x="300" y="78" width="80" height="32" rx="6" fill="#E6F1FB" stroke="#378ADD" stroke-width="1"/>
        <text x="340" y="92" text-anchor="middle" font-size="10" fill="#0C447C" font-family="JetBrains Mono,monospace" font-weight="500">App</text>
        <text x="340" y="104" text-anchor="middle" font-size="9" fill="#185FA5" font-family="JetBrains Mono,monospace">Server 1</text>

        <rect x="300" y="110" width="80" height="32" rx="6" fill="#E6F1FB" stroke="#378ADD" stroke-width="1"/>
        <text x="340" y="124" text-anchor="middle" font-size="10" fill="#0C447C" font-family="JetBrains Mono,monospace" font-weight="500">App</text>
        <text x="340" y="136" text-anchor="middle" font-size="9" fill="#185FA5" font-family="JetBrains Mono,monospace">Server 2</text>

        <rect x="300" y="142" width="80" height="32" rx="6" fill="#E6F1FB" stroke="#378ADD" stroke-width="1"/>
        <text x="340" y="156" text-anchor="middle" font-size="10" fill="#0C447C" font-family="JetBrains Mono,monospace" font-weight="500">App</text>
        <text x="340" y="168" text-anchor="middle" font-size="9" fill="#185FA5" font-family="JetBrains Mono,monospace">Server 3</text>

        <!-- arrows app -> cache -->
        <line x1="380" y1="94" x2="416" y2="110" stroke="#9a9a94" stroke-width=".8" marker-end="url(#a)"/>
        <line x1="380" y1="126" x2="416" y2="126" stroke="#9a9a94" stroke-width=".8" marker-end="url(#a)"/>
        <line x1="380" y1="158" x2="416" y2="142" stroke="#9a9a94" stroke-width=".8" marker-end="url(#a)"/>

        <!-- Cache -->
        <rect x="416" y="108" width="76" height="36" rx="6" fill="#EEEDFE" stroke="#534AB7" stroke-width="1"/>
        <text x="454" y="122" text-anchor="middle" font-size="10" fill="#3C3489" font-family="JetBrains Mono,monospace" font-weight="500">Cache</text>
        <text x="454" y="135" text-anchor="middle" font-size="9" fill="#534AB7" font-family="JetBrains Mono,monospace">Redis</text>

        <!-- cache miss -> db -->
        <line x1="492" y1="120" x2="520" y2="100" stroke="#9a9a94" stroke-width=".8" stroke-dasharray="4,3" marker-end="url(#a)"/>
        <text x="503" y="108" font-size="8" fill="#9a9a94" font-family="JetBrains Mono,monospace">miss</text>

        <!-- arrow cache -> queue -->
        <line x1="492" y1="132" x2="520" y2="150" stroke="#9a9a94" stroke-width=".8" marker-end="url(#a)"/>

        <!-- DB Cluster -->
        <rect x="520" y="78" width="80" height="34" rx="6" fill="#FAECE7" stroke="#D85A30" stroke-width="1"/>
        <text x="560" y="92" text-anchor="middle" font-size="10" fill="#4A1B0C" font-family="JetBrains Mono,monospace" font-weight="500">DB Primary</text>
        <text x="560" y="105" text-anchor="middle" font-size="9" fill="#993C1D" font-family="JetBrains Mono,monospace">MySQL / PG</text>

        <rect x="520" y="28" width="80" height="34" rx="6" fill="#F1EFE8" stroke="#888780" stroke-width="1"/>
        <text x="560" y="42" text-anchor="middle" font-size="10" fill="#2C2C2A" font-family="JetBrains Mono,monospace" font-weight="500">DB Replica</text>
        <text x="560" y="55" text-anchor="middle" font-size="9" fill="#5F5E5A" font-family="JetBrains Mono,monospace">read-only</text>

        <!-- primary -> replica -->
        <line x1="560" y1="78" x2="560" y2="62" stroke="#9a9a94" stroke-width=".8" stroke-dasharray="3,2" marker-end="url(#a)"/>
        <text x="564" y="73" font-size="8" fill="#9a9a94" font-family="JetBrains Mono,monospace">repl.</text>

        <!-- Queue -->
        <rect x="520" y="140" width="80" height="36" rx="6" fill="#EAF3DE" stroke="#639922" stroke-width="1"/>
        <text x="560" y="155" text-anchor="middle" font-size="10" fill="#27500A" font-family="JetBrains Mono,monospace" font-weight="500">Queue</text>
        <text x="560" y="168" text-anchor="middle" font-size="9" fill="#3B6D11" font-family="JetBrains Mono,monospace">Kafka/SQS</text>

        <!-- arrow queue -> worker -->
        <line x1="600" y1="158" x2="628" y2="158" stroke="#9a9a94" stroke-width=".8" marker-end="url(#a)"/>

        <!-- Worker -->
        <rect x="628" y="140" width="78" height="36" rx="6" fill="#F1EFE8" stroke="#888780" stroke-width="1"/>
        <text x="667" y="155" text-anchor="middle" font-size="10" fill="#2C2C2A" font-family="JetBrains Mono,monospace" font-weight="500">Analytics</text>
        <text x="667" y="168" text-anchor="middle" font-size="9" fill="#5F5E5A" font-family="JetBrains Mono,monospace">workers</text>

        <!-- worker -> analytics db -->
        <line x1="706" y1="158" x2="720" y2="158" stroke="#9a9a94" stroke-width=".8" marker-end="url(#a)"/>
        <rect x="720" y="140" width="72" height="36" rx="6" fill="#FAEEDA" stroke="#EF9F27" stroke-width="1"/>
        <text x="756" y="155" text-anchor="middle" font-size="10" fill="#633806" font-family="JetBrains Mono,monospace" font-weight="500">Analytics</text>
        <text x="756" y="168" text-anchor="middle" font-size="9" fill="#854F0B" font-family="JetBrains Mono,monospace">DB</text>

        <!-- labels -->
        <text x="43"  y="200" text-anchor="middle" font-size="9" fill="#9a9a94" font-family="JetBrains Mono,monospace">step 1</text>
        <text x="43"  y="212" text-anchor="middle" font-size="9" fill="#9a9a94" font-family="JetBrains Mono,monospace">escopo</text>
        <text x="229" y="200" text-anchor="middle" font-size="9" fill="#9a9a94" font-family="JetBrains Mono,monospace">steps 2–3</text>
        <text x="229" y="212" text-anchor="middle" font-size="9" fill="#9a9a94" font-family="JetBrains Mono,monospace">componentes</text>
        <text x="454" y="200" text-anchor="middle" font-size="9" fill="#9a9a94" font-family="JetBrains Mono,monospace">step 4–5</text>
        <text x="454" y="212" text-anchor="middle" font-size="9" fill="#9a9a94" font-family="JetBrains Mono,monospace">gargalos / redesign</text>
        <text x="667" y="200" text-anchor="middle" font-size="9" fill="#9a9a94" font-family="JetBrains Mono,monospace">async processing</text>
        <text x="667" y="212" text-anchor="middle" font-size="9" fill="#9a9a94" font-family="JetBrains Mono,monospace">desacoplamento</text>
      </svg>
    </div>

    <div class="itip">
      <div class="itip-label">Pergunta-chave de escopo</div>
      <p>Sempre pergunte: <strong>"Este sistema é read-heavy ou write-heavy?"</strong> — isso muda tudo. <br>
      Read-heavy (ex: URL shortener, Twitter timeline) → caching agressivo, DB replicas para leitura.<br>
      Write-heavy (ex: log ingestion, chat em tempo real) → filas + processamento assíncrono, eventual consistency.</p>
    </div>
  </section>

  <hr class="section-divider">

  <!-- ═══════════════════════════════════════════════
       SECTION 4 — ALGORITHMS THAT SCALE
  ════════════════════════════════════════════════ -->
  <section class="section" id="sec-algo">
    <div class="section-header">
      <h2>Algorithms that Scale: Step-By-Step</h2>
      <p>Quando o problema é algorítmico mas precisa operar em escala massiva — dados que não cabem em uma máquina.</p>
    </div>

    <div class="callout callout-blue">
      <p>Diferente do system design puro, aqui você começa com um algoritmo correto e vai iterando para que ele funcione com bilhões de registros. A chave é reconhecer onde a solução "quebra" ao escalar e abordar especificamente esses pontos.</p>
    </div>

    <div class="step-list">
      <div class="step-item">
        <div class="step-num amber">1</div>
        <div class="step-body">
          <strong>Ask Questions</strong>
          <span>Quantos dados? Qual a distribuição? Quais as constraints de tempo e memória? O dado cabe em RAM? Há duplicatas? Está ordenado? Pode haver aproximações (approximate algorithms) ou é necessária precisão exata? As perguntas certas revelam o verdadeiro problema e as técnicas aplicáveis.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num amber">2</div>
        <div class="step-body">
          <strong>Make Believe</strong>
          <span>Assuma que o dado cabe em uma única máquina e resolva o problema lá. Encontre o algoritmo correto ignorando escala por enquanto. Isso dá a solução base que você vai adaptar. Ex.: para top-K palavras em 1TB de logs, começaria com um HashMap + MinHeap de tamanho K.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num amber">3</div>
        <div class="step-body">
          <strong>Get Real</strong>
          <span>Agora enfrente a realidade: o dado não cabe em RAM, ou não cabe em disco de uma máquina, ou o processamento em série seria lento demais. Como você divide o problema? Particionamento por hash? Sampling? Streaming? Quais partes são paralelizáveis?</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num amber">4</div>
        <div class="step-body">
          <strong>Solve Problems</strong>
          <span>Identifique quais partes da solução do passo 2 quebram em escala e corrija especificamente esses pontos. Sharding, MapReduce, approximate counting (HyperLogLog para distinct counts, Count-Min Sketch para frequências), reservoir sampling para dados em stream.</span>
        </div>
      </div>
    </div>

    <div class="card-grid">
      <div class="card border-amber">
        <div class="card-label amber">Exemplo completo</div>
        <h3>Top-K palavras em 1TB de logs</h3>
        <p><strong>Make believe:</strong> HashMap&lt;String, Integer&gt; para contar + MinHeap de tamanho K para os top-K. O(N log K).<br><br>
        <strong>Get real:</strong> 1TB não cabe em RAM (assume ~10GB de heap).<br><br>
        <strong>Solve:</strong> Particione o arquivo em N chunks. Cada worker processa um chunk → emite (palavra, count). Redutor central agrega contagens por palavra e mantém MinHeap global de tamanho K.<br><br>
        Alternativa: MapReduce — Map emite (palavra, 1), Reduce soma e cada reducer mantém top-K local, merge final.</p>
      </div>
      <div class="card border-purple">
        <div class="card-label purple">Técnicas de escala</div>
        <h3>Quando usar cada abordagem</h3>
        <p><strong>MapReduce:</strong> dados em batch, paralelizáveis, fits word count, PageRank, join de tabelas grandes.<br><br>
        <strong>HyperLogLog:</strong> contagem de elementos distintos com ~1% de erro usando O(log log N) memória. Ideal para "quantos usuários únicos visitaram?"<br><br>
        <strong>Count-Min Sketch:</strong> frequência aproximada de elementos. Ideal para top-K com alta cardinalidade.<br><br>
        <strong>Bloom Filter:</strong> verificação probabilística de pertencimento. "Este URL já foi visitado?" com zero falsos negativos.</p>
      </div>
    </div>
  </section>

  <hr class="section-divider">


  <!-- ═══════════════════════════════════════════════
       SECTION — BACK-OF-THE-ENVELOPE
  ════════════════════════════════════════════════ -->
  <section class="section" id="sec-numbers">
    <div class="section-header">
      <h2>Back-of-the-Envelope</h2>
      <p>Números de referência para estimativas rápidas — a ordem de grandeza é o que importa, não a precisão.</p>
    </div>

    <div class="metric-grid">
      <div class="metric-card">
        <div class="metric-label">1 dia</div>
        <div class="metric-val" style="color:var(--blue);">~10⁵ s</div>
        <div class="metric-desc">86.400 s. Arredonde para 100k e faça as contas de cabeça.</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">1M req/dia</div>
        <div class="metric-val" style="color:var(--accent);">~12/s</div>
        <div class="metric-desc">Isso é a média. Pico típico: 2–5× a média — dimensione para o pico.</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Read : Write</div>
        <div class="metric-val" style="color:var(--coral);">100:1</div>
        <div class="metric-desc">Proporção típica de sistemas read-heavy (feeds, URL shortener, catálogos).</div>
      </div>
    </div>

    <h3 class="sub-h">Latências que todo engenheiro deveria conhecer</h3>
    <div class="table-wrap">
      <table class="cmp-table">
        <thead><tr><th>Operação</th><th>Latência aprox.</th><th>Implicação</th></tr></thead>
        <tbody>
          <tr><td>Referência ao cache L1</td><td>~1 ns</td><td>CPU é praticamente "grátis" frente a I/O</td></tr>
          <tr><td>Acesso à memória principal (RAM)</td><td>~100 ns</td><td>Por isso caches em memória (Redis) respondem em sub-ms</td></tr>
          <tr><td>Ler 1 MB sequencial da RAM</td><td>~5–10 μs</td><td>Varrer dados em memória é barato</td></tr>
          <tr><td>Leitura aleatória em SSD (4 KB)</td><td>~20–100 μs</td><td>~1.000× mais lenta que RAM</td></tr>
          <tr><td>Round trip no mesmo datacenter</td><td>~0,5 ms</td><td>Cada chamada entre microservices custa isso no mínimo</td></tr>
          <tr><td>Ler 1 MB sequencial do SSD</td><td>~0,2–1 ms</td><td>Leitura sequencial é muito mais barata que aleatória</td></tr>
          <tr><td>Seek em disco rotacional (HDD)</td><td>~5–10 ms</td><td>Evite acesso aleatório em HDD no caminho crítico</td></tr>
          <tr><td>Round trip São Paulo ↔ Virgínia (us-east-1)</td><td>~110–130 ms</td><td>Evite chamadas síncronas entre regiões; use CDN/edge</td></tr>
        </tbody>
      </table>
    </div>

    <h3 class="sub-h">Disponibilidade — os "noves"</h3>
    <div class="table-wrap">
      <table class="cmp-table">
        <thead><tr><th>SLO</th><th>Downtime / ano</th><th>Downtime / mês</th></tr></thead>
        <tbody>
          <tr><td>99%</td><td>~3,65 dias</td><td>~7,3 h</td></tr>
          <tr><td>99,9%</td><td>~8,77 h</td><td>~43,8 min</td></tr>
          <tr><td>99,95%</td><td>~4,38 h</td><td>~21,9 min</td></tr>
          <tr><td>99,99%</td><td>~52,6 min</td><td>~4,38 min</td></tr>
          <tr><td>99,999%</td><td>~5,26 min</td><td>~26,3 s</td></tr>
        </tbody>
      </table>
    </div>

    <div class="card-grid">
      <div class="card border-blue">
        <div class="card-label blue">Potências de 2</div>
        <h3>Unidades de armazenamento</h3>
        <p><strong>2¹⁰</strong> ≈ 10³ → KB (mil)<br>
        <strong>2²⁰</strong> ≈ 10⁶ → MB (milhão)<br>
        <strong>2³⁰</strong> ≈ 10⁹ → GB (bilhão)<br>
        <strong>2⁴⁰</strong> ≈ 10¹² → TB (trilhão)<br>
        <strong>2⁵⁰</strong> ≈ 10¹⁵ → PB</p>
      </div>
      <div class="card border-green">
        <div class="card-label green">Tamanhos típicos</div>
        <h3>Para estimar storage</h3>
        <p><strong>ID numérico / timestamp:</strong> 8 B<br>
        <strong>UUID:</strong> 16 B (36 B como texto)<br>
        <strong>Registro "pequeno" (URL, post curto):</strong> ~0,5–1 KB<br>
        <strong>Foto comprimida:</strong> ~200 KB – 2 MB<br>
        <strong>1 min de vídeo HD:</strong> ~50–100 MB</p>
      </div>
    </div>

    <div class="itip">
      <div class="itip-label">Como apresentar uma estimativa</div>
      <p>Arredonde agressivamente, faça a conta <strong>em voz alta</strong> e, principalmente, diga o que o número muda na arquitetura. "São ~3 TB em 5 anos — cabe em um banco com réplicas, então sharding é uma otimização futura, não um requisito do dia 1." Estimativa que não leva a uma decisão é só aritmética.</p>
    </div>
  </section>

  <hr class="section-divider">

  <!-- ═══════════════════════════════════════════════
       SECTION 5 — KEY CONCEPTS
  ════════════════════════════════════════════════ -->
  <section class="section" id="sec-concepts">
    <div class="section-header">
      <h2>Key Concepts</h2>
      <p>Os conceitos que aparecem em toda entrevista de system design — clique em cada item para expandir a explicação.</p>
    </div>

    <div class="acc" id="acc-concepts">

      <!-- 1. Horizontal vs Vertical -->
      <div class="acc-item" id="acc-scaling">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Horizontal vs. Vertical Scaling</span>
            <span class="badge badge-green">fundamento</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p><strong>Vertical scaling (scale up):</strong> adiciona mais CPU, RAM ou disco na mesma máquina. É simples — não requer mudança de código. Mas tem limite físico e hardware (não existe uma máquina com RAM infinita), cria single point of failure e o custo cresce exponencialmente com a capacidade.</p>
          <p><strong>Horizontal scaling (scale out):</strong> adiciona mais máquinas. Teoricamente ilimitado e mais econômico em escala. Exige design stateless nos servidores de aplicação, load balancing, e coordenação entre nós. A maioria dos sistemas web de grande escala usa horizontal.</p>
          <p><strong>Estratégia prática:</strong> comece com vertical (mais simples, zero refactoring), mas projete para horizontal desde o início. Quando vertical atingir custo ou limite físico, migre para horizontal. O erro é não planejar isso desde o início.</p>
          <div class="table-wrap" style="margin-top:12px;"><table class="cmp-table">
            <thead><tr><th>Aspecto</th><th>Vertical</th><th>Horizontal</th></tr></thead>
            <tbody>
              <tr><td>Implementação</td><td>Simples</td><td>Complexa</td></tr>
              <tr><td>Limite</td><td>Hardware máximo</td><td>Praticamente ilimitado</td></tr>
              <tr><td>Custo</td><td>Cresce exponencialmente</td><td>Cresce linearmente</td></tr>
              <tr><td>Single point of failure</td><td>Sim</td><td>Não (com redundância)</td></tr>
              <tr><td>Downtime na expansão</td><td>Geralmente sim</td><td>Não</td></tr>
            </tbody>
          </table></div>
        </div>
      </div>

      <!-- 2. Load Balancer -->
      <div class="acc-item" id="acc-lb">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Load Balancer</span>
            <span class="badge badge-blue">infraestrutura</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p>Distribui requisições entre múltiplos servidores backend, impedindo que qualquer servidor fique sobrecarregado enquanto outros ficam ociosos. Também executa health checks e remove automaticamente servidores com falha do pool.</p>
          <p><strong>Algoritmos de distribuição:</strong></p>
          <ul>
            <li><code>Round-robin:</code> cada servidor recebe requisições em rotação. Simples, mas ignora carga atual.</li>
            <li><code>Weighted round-robin:</code> servidores mais potentes recebem proporção maior de requisições.</li>
            <li><code>Least connections:</code> encaminha para o servidor com menos conexões ativas. Melhor para requests de duração variável.</li>
            <li><code>IP hash:</code> <code>shard = hash(client_IP) % N</code>. Garante sticky sessions (mesmo cliente → mesmo servidor). Útil quando há estado no servidor.</li>
          </ul>
          <p><strong>Tipos de implementação:</strong> Hardware (F5, Cisco), software (Nginx, HAProxy, Envoy), cloud-managed (AWS ALB/NLB, GCP Cloud Load Balancing).</p>
          <p><strong>Cuidado:</strong> o load balancer em si pode se tornar single point of failure. Solução: pares ativo/passivo (primary + standby com failover automático) ou DNS-based load balancing (múltiplos IPs no DNS com TTL curto).</p>
        </div>
      </div>

      <!-- 3. DB Denormalization & NoSQL -->
      <div class="acc-item" id="acc-nosql">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Database Denormalization &amp; NoSQL</span>
            <span class="badge badge-amber">dados</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p><strong>Denormalization:</strong> desnormalizar um banco relacional significa duplicar dados estrategicamente para evitar JOINs caros. Você troca consistência (updates precisam ser feitos em múltiplos lugares) por performance de leitura. Funciona bem quando leituras superam escritas em grande proporção e JOINs são um gargalo comprovado.</p>
          <p><strong>NoSQL — quando e qual usar:</strong></p>
          <ul>
            <li><strong>Key-Value</strong> (Redis, DynamoDB): acesso O(1) por chave. Ideal para sessions, caching, leaderboards, rate limiting.</li>
            <li><strong>Document</strong> (MongoDB, Couchbase): dados semi-estruturados, schema flexível. Ideal para catálogos de produtos, perfis de usuário.</li>
            <li><strong>Column-family</strong> (Cassandra, HBase): escrita massiva distribuída, queries por partition key. Ideal para séries temporais, IoT, logs.</li>
            <li><strong>Graph</strong> (Neo4j, Amazon Neptune): relacionamentos complexos entre entidades. Ideal para social graphs, sistemas de recomendação, detecção de fraude.</li>
          </ul>
          <p><strong>CAP Theorem:</strong> em um sistema distribuído, você pode garantir no máximo 2 das 3 propriedades: <code>Consistency</code> (todos os nós veem os mesmos dados), <code>Availability</code> (toda request recebe resposta), <code>Partition tolerance</code> (o sistema funciona mesmo com falhas de rede). Na prática, P é inevitável — você escolhe entre CP (consistência) ou AP (disponibilidade).</p>
        </div>
      </div>

      <!-- 4. Sharding -->
      <div class="acc-item" id="acc-sharding">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Database Partitioning (Sharding)</span>
            <span class="badge badge-amber">dados</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p>Divide o banco de dados em múltiplos nós (shards), onde cada nó armazena um subconjunto dos dados. Permite escalar horizontalmente o armazenamento e a throughput de queries além dos limites de uma única máquina.</p>
          <p><strong>Estratégias de sharding:</strong></p>
          <ul>
            <li><strong>Vertical partitioning:</strong> diferentes tabelas em diferentes servidores. Simples, mas limita o crescimento de tabelas individuais.</li>
            <li><strong>Horizontal (range-based):</strong> usuários com id 1–1M no shard A, 1M–2M no B. Bom para range queries, mas pode criar hot spots se a distribuição for desigual.</li>
            <li><strong>Hash-based:</strong> <code>shard = hash(user_id) % N</code>. Distribuição uniforme, evita hot spots. Dificulta range queries. <strong>Consistent hashing</strong> minimiza o remapeamento de dados ao adicionar ou remover nós.</li>
            <li><strong>Directory-based:</strong> uma lookup table mapeia chave → shard. Flexível (permite mover dados sem rehashing), mas a tabela vira um gargalo e um ponto único de falha.</li>
          </ul>
          <p><strong>Problema clássico:</strong> queries que cruzam shards (cross-shard joins) são extremamente caras. Projete o sharding key levando em conta os access patterns mais frequentes. Se 90% das queries são por <code>user_id</code>, use <code>user_id</code> como sharding key.</p>
        </div>
      </div>

      <!-- 5. Caching -->
      <div class="acc-item" id="acc-cache">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Caching</span>
            <span class="badge badge-purple">performance</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p>Armazena resultados computados ou dados frequentemente acessados em memória (muito mais rápida que disco) para evitar recomputation ou I/O ao banco. É uma das otimizações de maior impacto em sistemas read-heavy.</p>
          <p><strong>Políticas de eviction (quando a memória está cheia):</strong></p>
          <ul>
            <li><code>LRU (Least Recently Used):</code> remove o item acessado há mais tempo. É o padrão — funciona bem na maioria dos workloads.</li>
            <li><code>LFU (Least Frequently Used):</code> remove o item acessado com menos frequência. Melhor quando a popularidade dos dados é estável ao longo do tempo.</li>
            <li><code>TTL (Time-To-Live):</code> cada item tem um prazo de expiração. Essencial para dados com validade temporal (ex: preços, sessões).</li>
          </ul>
          <p><strong>Write strategies:</strong></p>
          <ul>
            <li><code>Write-through:</code> escreve no cache e no banco simultaneamente. Consistência garantida, mas latência de escrita maior.</li>
            <li><code>Write-back (write-behind):</code> escreve no cache imediatamente, propaga ao banco de forma assíncrona. Maior throughput, mas risco de perda de dados se o cache falhar.</li>
            <li><code>Write-around:</code> escreve direto no banco, bypassa o cache. O cache só é populado na leitura seguinte. Útil quando os dados escritos raramente são lidos logo após.</li>
          </ul>
          <p><strong>Problemas clássicos:</strong> <em>Cache stampede</em> (expiração simultânea de muitas chaves causa flood de queries ao banco — use probabilistic expiration ou mutex lock), <em>cold start</em> (cache vazio após deploy — use warm-up scripts), <em>cache poisoning</em> (dados inválidos no cache).</p>
        </div>
      </div>

      <!-- 6. Async Queues -->
      <div class="acc-item" id="acc-queues">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Asynchronous Processing &amp; Queues</span>
            <span class="badge badge-green">arquitetura</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p>Em vez de processar tudo de forma síncrona dentro da request do usuário, você enfileira o trabalho pesado para execução assíncrona. O usuário recebe uma resposta rápida (confirmação de recebimento), e workers processam em background.</p>
          <p><strong>Casos de uso clássicos:</strong></p>
          <ul>
            <li>Envio de email/SMS após cadastro</li>
            <li>Geração de thumbnail de imagem após upload</li>
            <li>Processamento de pagamento com retry automático</li>
            <li>Indexação de conteúdo para mecanismo de busca</li>
            <li>Notificações push para dispositivos móveis</li>
          </ul>
          <p><strong>Ferramentas e tradeoffs:</strong></p>
          <ul>
            <li><code>RabbitMQ:</code> AMQP, garantia de entrega (at-least-once), roteamento complexo por exchange/binding. Ideal para workloads que precisam de garantias de entrega.</li>
            <li><code>Apache Kafka:</code> log distribuído, retenção persistente de mensagens, possibilidade de replay, throughput muito alto (milhões de msg/s). Ideal para event streaming, auditoria, múltiplos consumidores independentes.</li>
            <li><code>Amazon SQS:</code> managed, zero ops, SQS Standard (at-least-once, sem ordem) ou FIFO (exactly-once, ordenado). Ideal para quem quer simplicidade na nuvem AWS.</li>
          </ul>
          <p>O padrão produtor-consumidor desacopla serviços, absorve picos de tráfego (o produtor pode ser muito mais rápido que o consumidor por curtos períodos) e permite retry automático em caso de falha do worker.</p>
        </div>
      </div>

      <!-- 7. Networking Metrics -->
      <div class="acc-item" id="acc-networking">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Networking Metrics</span>
            <span class="badge badge-blue">métricas</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p>Três métricas fundamentais para entender e dimensionar a capacidade de rede de um sistema distribuído:</p>
          <div class="metric-grid" style="margin-top:12px;">
            <div class="metric-card">
              <div class="metric-label">Bandwidth</div>
              <div class="metric-val" style="color:var(--blue);">cap.</div>
              <div class="metric-desc">Capacidade máxima teórica do canal em bits/segundo. É o teto — quanto o link pode transportar no máximo.</div>
            </div>
            <div class="metric-card">
              <div class="metric-val" style="color:var(--accent);">real</div>
              <div class="metric-label">Throughput</div>
              <div class="metric-desc">Taxa real de transferência bem-sucedida. Sempre ≤ bandwidth. Reduzida por congestionamento, retransmissões e overhead.</div>
            </div>
            <div class="metric-card">
              <div class="metric-val" style="color:var(--coral);">RTT</div>
              <div class="metric-label">Latency</div>
              <div class="metric-desc">Tempo para um pacote ir de A a B (one-way) ou A→B→A (Round-Trip Time). Composta por propagation + transmission + processing + queuing delay.</div>
            </div>
          </div>
          <p><strong>Componentes da latência:</strong></p>
          <ul>
            <li><code>Propagation delay:</code> velocidade da luz × distância. São Paulo → Nova York ≈ 100ms mínimo.</li>
            <li><code>Transmission delay:</code> tamanho do pacote ÷ bandwidth. Um arquivo de 1GB em link de 100Mbps leva ~80 segundos.</li>
            <li><code>Processing delay:</code> tempo que roteadores levam para processar o header e decidir o próximo salto.</li>
            <li><code>Queuing delay:</code> tempo esperando em buffers de roteadores congestionados. Variável e imprevisível.</li>
          </ul>
          <p><strong>Regra prática:</strong> otimizar throughput (batching, compressão) pode aumentar latência. Otimizar latência (requests menores, conexões persistentes) pode reduzir throughput. Entenda qual é mais crítico para o seu sistema antes de otimizar.</p>
        </div>
      </div>

      <!-- 8. MapReduce -->
      <div class="acc-item" id="acc-mapreduce">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">MapReduce</span>
            <span class="badge badge-coral">big data</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p>Paradigma de programação para processar grandes datasets em paralelo num cluster. O programador define apenas as funções Map e Reduce; o framework cuida de distribuição, paralelismo, fault tolerance e shuffle.</p>
          <p><strong>Fluxo das duas fases:</strong></p>
          <ul>
            <li><strong>Map:</strong> cada worker lê um chunk dos dados de entrada e emite pares <code>(key, value)</code>. Ex.: para word count, cada linha → emite <code>(palavra, 1)</code> para cada palavra encontrada.</li>
            <li><strong>Shuffle &amp; Sort:</strong> o framework agrupa automaticamente todos os valores emitidos pela mesma key e os envia para o mesmo reducer.</li>
            <li><strong>Reduce:</strong> o reducer recebe <code>(key, [v1, v2, v3, ...])</code> e produz o resultado final. Ex.: <code>(palavra, [1,1,1]) → (palavra, 3)</code>.</li>
          </ul>
          <p><strong>O framework cuida de:</strong> distribuição de dados entre workers, execução paralela, re-execução automática de tasks que falharam (fault tolerance), shuffle/sort entre Map e Reduce, e monitoramento.</p>
          <p><strong>Implementações:</strong> Hadoop MapReduce (batch, I/O em disco — robusto mas lento), Apache Spark (in-memory — 10-100x mais rápido para iterative algorithms como ML, streaming via Spark Streaming).</p>
          <p><strong>Quando NÃO usar:</strong> queries em tempo real com requisito de baixa latência, transações ACID que precisam de consistência forte, sistemas de cache ou lookup simples. MapReduce é para processamento batch de grandes volumes.</p>
          <pre># Pseudocódigo — Word Count em MapReduce
def map(document_id, text):
    for word in text.split():
        emit(word, 1)           # emite (key, value)

def reduce(word, counts):       # recebe (key, [v1, v2, ...])
    emit(word, sum(counts))     # agrega e emite resultado final</pre>
        </div>
      </div>

      <!-- 9. Consistent Hashing -->
      <div class="acc-item" id="acc-consistent">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Consistent Hashing</span>
            <span class="badge badge-amber">dados</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p><strong>O problema:</strong> com <code>shard = hash(key) % N</code>, mudar N (adicionar um nó ou perder um) remapeia quase todas as chaves. Num cache distribuído isso equivale a esvaziar o cache inteiro de uma vez — e todo o tráfego cai no banco.</p>
          <p><strong>A solução:</strong> nós e chaves são posicionados num anel de hash (ex.: 0 … 2³²−1). Cada chave pertence ao primeiro nó encontrado no sentido horário. Ao adicionar ou remover um nó, só as chaves do intervalo vizinho mudam de dono — em média <code>K/N</code> chaves.</p>
          <ul>
            <li><strong>Virtual nodes:</strong> cada nó físico ocupa várias posições no anel, o que uniformiza a distribuição e permite dar mais peso a máquinas maiores.</li>
            <li><strong>Replicação:</strong> a chave também é guardada nos próximos R−1 nós do anel (modelo do Dynamo e do Cassandra).</li>
            <li><strong>Onde aparece:</strong> Cassandra, DynamoDB, Riak, clientes de Memcached (ketama), Nginx (<code>hash $request_uri consistent;</code>).</li>
          </ul>
        </div>
      </div>

      <!-- 10. Replication & Consistency -->
      <div class="acc-item" id="acc-replication">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Replication &amp; Consistency Models</span>
            <span class="badge badge-amber">dados</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p>Replicar dados aumenta disponibilidade e capacidade de leitura, mas obriga você a escolher <strong>o que o cliente pode ver</strong> enquanto as réplicas convergem.</p>
          <p><strong>Topologias:</strong></p>
          <ul>
            <li><strong>Leader-follower (primary-replica):</strong> escritas no líder, leituras escaladas nas réplicas. Com replicação assíncrona existe <em>replication lag</em> — uma leitura na réplica pode retornar dado antigo.</li>
            <li><strong>Multi-leader:</strong> escritas aceitas em várias regiões. Exige resolução de conflitos (last-write-wins, CRDTs, merge na aplicação).</li>
            <li><strong>Leaderless (quorum):</strong> N réplicas; a escrita é confirmada por W e a leitura consulta R. Se <code>R + W &gt; N</code>, toda leitura encontra ao menos uma réplica com a última escrita confirmada. Ex.: N=3, W=2, R=2.</li>
          </ul>
          <p><strong>Modelos de consistência (do mais forte ao mais fraco):</strong> linearizability (strong) → read-your-writes → monotonic reads → eventual consistency.</p>
          <p><strong>Truque prático:</strong> para garantir read-your-writes sem consistência forte global, leia do líder por alguns segundos depois que o próprio usuário escreveu (ex.: após editar o perfil).</p>
          <p class="acc-link">Na disciplina: <a href="../classes/distributed_systems/cap/">CAP Theorem</a> · <a href="../classes/distributed_systems/consensus/">Consensus &amp; Algorithms</a></p>
        </div>
      </div>

      <!-- 11. CDN -->
      <div class="acc-item" id="acc-cdn">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">CDN &amp; Edge</span>
            <span class="badge badge-blue">infraestrutura</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p>Uma CDN (Content Delivery Network) é uma rede de servidores de borda que guardam cópias do conteúdo perto do usuário. Reduz a latência (o RTT até a borda é muito menor que até a origem) e tira carga da origem.</p>
          <ul>
            <li><strong>Pull CDN:</strong> a borda busca na origem no primeiro acesso (cache miss) e guarda conforme <code>Cache-Control</code>/TTL. Simples, padrão na maioria dos casos.</li>
            <li><strong>Push CDN:</strong> você publica o conteúdo na CDN explicitamente. Útil para arquivos grandes e pouco alterados.</li>
            <li><strong>Invalidação:</strong> prefira versionar o nome do arquivo (<code>app.3f9a1c.js</code>) a invalidar cache — invalidação é lenta e cara.</li>
            <li><strong>Além de estáticos:</strong> TLS termination, proteção DDoS/WAF, edge compute e cache de respostas dinâmicas com TTL curto.</li>
          </ul>
          <p><strong>Exemplos:</strong> Amazon CloudFront, Cloudflare, Akamai, Fastly.</p>
        </div>
      </div>

      <!-- 12. Rate Limiting -->
      <div class="acc-item" id="acc-ratelimit">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Rate Limiting</span>
            <span class="badge badge-coral">resiliência</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p>Limita quantas requisições um cliente (usuário, API key, IP) pode fazer numa janela de tempo. Protege contra abuso e picos acidentais, garante fair use e controla custo. A resposta padrão é <code>HTTP 429 Too Many Requests</code> com header <code>Retry-After</code>.</p>
          <p><strong>Algoritmos:</strong></p>
          <ul>
            <li><code>Token bucket:</code> tokens são repostos a uma taxa fixa; cada request consome um. Permite bursts até o tamanho do balde. O mais usado em APIs.</li>
            <li><code>Leaky bucket:</code> requests entram numa fila que é drenada a taxa constante. Suaviza o tráfego (é o modelo do <code>limit_req</code> do Nginx).</li>
            <li><code>Fixed window counter:</code> contador por janela (ex.: por minuto). Simples, mas permite até 2× o limite na virada da janela.</li>
            <li><code>Sliding window (log ou counter):</code> mais preciso que a janela fixa, com custo maior de memória/cálculo.</li>
          </ul>
          <p><strong>Distribuído:</strong> com várias réplicas do gateway, o contador precisa ser compartilhado — tipicamente Redis (<code>INCR</code> + <code>EXPIRE</code>, ou um script Lua para atomicidade). Decida também o comportamento se o Redis cair: <em>fail-open</em> (deixa passar) ou <em>fail-closed</em> (bloqueia).</p>
          <p class="acc-link">Na disciplina: <a href="../hands-on/2/">Hands-on 2 — Gateway</a> · <a href="../hands-on/8/">Hands-on 8 — In-Memory Cache</a></p>
        </div>
      </div>

      <!-- 13. API Gateway & Microservices -->
      <div class="acc-item" id="acc-gateway">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">API Gateway &amp; Microservices</span>
            <span class="badge badge-green">arquitetura</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p><strong>API Gateway:</strong> ponto único de entrada do sistema. Concentra preocupações transversais — roteamento, autenticação (validação de JWT), rate limiting, TLS, CORS, agregação de respostas — para que os serviços internos não precisem repeti-las.</p>
          <ul>
            <li><strong>Comunicação:</strong> síncrona (REST/gRPC) quando o cliente precisa da resposta agora; assíncrona (eventos em fila) quando o trabalho pode acontecer depois.</li>
            <li><strong>Database per service:</strong> cada serviço é dono dos seus dados. Consistência entre serviços via <em>Saga</em> (orquestrada ou coreografada) e <em>Outbox pattern</em> para publicar eventos de forma confiável.</li>
            <li><strong>Service discovery:</strong> DNS do orquestrador (Kubernetes Services) ou registry (Eureka, Consul).</li>
          </ul>
          <p><strong>Tradeoff que impressiona em entrevista:</strong> saber quando <em>não</em> usar microservices. Time pequeno e domínio ainda instável → comece com um monolito modular e extraia serviços quando houver motivo concreto (escala independente, deploy independente, times distintos).</p>
          <p class="acc-link">Na disciplina: <a href="../classes/microservices/architecture/">Microservices — Architecture &amp; Components</a> · <a href="../hands-on/2/">Hands-on 2 — Gateway</a> · <a href="../hands-on/3/">Hands-on 3 — Security</a></p>
        </div>
      </div>

      <!-- 14. Resilience Patterns -->
      <div class="acc-item" id="acc-resilience">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Resilience Patterns</span>
            <span class="badge badge-coral">resiliência</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p>Em sistemas distribuídos, falhas parciais são a regra. Estes padrões evitam que a falha de uma dependência derrube o sistema inteiro (falha em cascata).</p>
          <ul>
            <li><code>Timeout:</code> toda chamada remota precisa de um. Sem timeout, uma dependência lenta esgota as threads de quem a chama.</li>
            <li><code>Retry com exponential backoff + jitter:</code> apenas para erros transitórios e operações idempotentes. O jitter evita que todos os clientes tentem de novo ao mesmo tempo (thundering herd).</li>
            <li><code>Circuit breaker:</code> closed → open (falha rápido, sem chamar a dependência) → half-open (testa se ela voltou).</li>
            <li><code>Bulkhead:</code> pools de recursos isolados por dependência, para que uma não consuma todas as conexões.</li>
            <li><code>Idempotency key:</code> o cliente envia um identificador único; o servidor deduplica repetições da mesma operação.</li>
            <li><code>Fallback / graceful degradation:</code> resposta degradada (cache, valor padrão) em vez de erro.</li>
            <li><code>Load shedding:</code> rejeitar parte do tráfego cedo quando saturado, em vez de degradar todas as requisições.</li>
          </ul>
          <p class="acc-link">Na disciplina: <a href="../classes/reliability/patterns/">Resilience Patterns</a> · <a href="../classes/reliability/chaos/">Chaos Engineering</a></p>
        </div>
      </div>

      <!-- 15. Observability & SLOs -->
      <div class="acc-item" id="acc-observability">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Observability &amp; SLOs</span>
            <span class="badge badge-blue">métricas</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p>Projetar o sistema não basta: você precisa saber <strong>quando</strong> e <strong>onde</strong> ele está falhando. Mencionar observabilidade no fim da entrevista mostra maturidade de produção.</p>
          <ul>
            <li><strong>Logs:</strong> o que aconteceu, evento a evento. Estruturados (JSON) e com trace id.</li>
            <li><strong>Métricas:</strong> quanto e com que frequência. Método <em>RED</em> para serviços (Rate, Errors, Duration) e <em>USE</em> para recursos (Utilization, Saturation, Errors).</li>
            <li><strong>Traces:</strong> onde o tempo foi gasto numa requisição que atravessa vários serviços.</li>
          </ul>
          <p><strong>SLI / SLO / SLA:</strong> SLI é a medida (ex.: % de requests com latência &lt; 300 ms); SLO é a meta interna (ex.: 99,9% em 28 dias); SLA é o contrato com o cliente, com penalidade. O <em>error budget</em> (1 − SLO) define quanto risco você pode gastar com deploys e experimentos.</p>
          <p><strong>Use percentis, não médias:</strong> p50, p95 e p99. A média esconde a cauda — e é na cauda que estão os usuários insatisfeitos.</p>
          <p class="acc-link">Na disciplina: <a href="../classes/observability/">Observability</a> · <a href="../classes/reliability/sli-slo-sla/">SLI / SLO / SLA</a> · <a href="../hands-on/6/">Hands-on 6</a> · <a href="../hands-on/10/">Hands-on 10</a></p>
        </div>
      </div>

    </div><!-- end acc -->

  </section>

  <hr class="section-divider">

  <!-- ═══════════════════════════════════════════════
       SECTION — WORKED EXAMPLE
  ════════════════════════════════════════════════ -->
  <section class="section" id="sec-example">
    <div class="section-header">
      <h2>Exemplo Guiado: URL Shortener</h2>
      <p>Os 5 passos aplicados ao sistema do diagrama acima — o roteiro de uma resposta de ~45 minutos.</p>
    </div>

    <div class="step-list">
      <div class="step-item">
        <div class="step-num amber">1</div>
        <div class="step-body">
          <strong>Scope the Problem</strong>
          <span>Funcionais: encurtar uma URL longa, redirecionar o código curto para a URL original, alias customizado e expiração (opcionais), contagem de cliques. Fora do escopo: contas de usuário e edição de links. Não-funcionais: redirect com baixa latência (p99 &lt; 100 ms), alta disponibilidade e códigos não triviais de adivinhar.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num amber">2</div>
        <div class="step-body">
          <strong>Make Reasonable Assumptions</strong>
          <span>100M novas URLs/mês → ~40 escritas/s. Read:write de 100:1 → ~4.000 redirects/s em média (pico ~10k/s). Storage em 5 anos: 6B registros × ~500 B ≈ 3 TB. Cache: ~350M redirects/dia; guardar os 20% mais acessados ≈ 35 GB em RAM — cabe em um pequeno cluster Redis.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num amber">3</div>
        <div class="step-body">
          <strong>Draw the Major Components</strong>
          <span>API: <code>POST /api/v1/urls {longUrl, alias?, expiresAt?}</code> → <code>201 {shortUrl}</code> e <code>GET /{code}</code> → <code>301/302 Location: longUrl</code>. Modelo: <code>urls(code PK, long_url, created_at, expires_at)</code>. Componentes: load balancer → app servers stateless → banco.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num amber">4</div>
        <div class="step-body">
          <strong>Identify the Key Issues</strong>
          <span>(a) Gerar códigos únicos sem colisão e sem coordenação cara entre servidores. (b) O banco recebe todo o tráfego de leitura. (c) Contar cliques de forma síncrona deixaria o redirect mais lento.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num amber">5</div>
        <div class="step-body">
          <strong>Redesign for the Key Issues</strong>
          <span>Cache-aside em Redis para os códigos quentes; réplicas de leitura no banco; sharding por hash do <code>code</code> só se o volume exigir. Cada clique vira um evento numa fila (Kafka/SQS) consumido por workers que gravam no banco de analytics — o redirect não espera por isso.</span>
        </div>
      </div>
    </div>

    <h3 class="sub-h">Como gerar o código curto?</h3>
    <div class="card-grid-3">
      <div class="card border-green">
        <div class="card-label green">Opção A</div>
        <h3>Hash + truncar</h3>
        <p>Hash (MD5/SHA-256) da URL, primeiros 7 caracteres em base62. Determinístico: a mesma URL gera o mesmo código. <strong>Contra:</strong> colisões precisam ser detectadas e resolvidas (re-hash com salt).</p>
      </div>
      <div class="card border-blue">
        <div class="card-label blue">Opção B</div>
        <h3>Contador + base62</h3>
        <p>ID único (sequence, Snowflake ou faixas pré-alocadas por servidor) convertido para base62. Sem colisões. <strong>Contra:</strong> códigos sequenciais são previsíveis e permitem enumerar links.</p>
      </div>
      <div class="card border-purple">
        <div class="card-label purple">Opção C</div>
        <h3>Key Generation Service</h3>
        <p>Um serviço pré-gera chaves aleatórias e as entrega em lotes aos app servers. Sem colisão no caminho da requisição e imprevisível. <strong>Contra:</strong> mais um componente para operar e replicar.</p>
      </div>
    </div>

    <pre># base62: 62^7 ≈ 3,5 trilhões de códigos — sobra para 6B URLs
ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

def base62(n: int) -> str:
    s = ""
    while n > 0:
        n, r = divmod(n, 62)
        s = ALPHABET[r] + s
    return s or "0"</pre>

    <div class="itip">
      <div class="itip-label">Tradeoff clássico: 301 ou 302?</div>
      <p><strong>301 (Moved Permanently)</strong> é cacheado pelo navegador: menos carga no servidor, mas os cliques seguintes não passam por você — a contagem fica incompleta.<br>
      <strong>302 (Found)</strong> passa sempre pelo servidor: analytics preciso, mas mais tráfego. Não existe resposta certa — escolha e justifique com os requisitos do passo 1.</p>
    </div>
  </section>

  <hr class="section-divider">

  <!-- ═══════════════════════════════════════════════
       SECTION — PRACTICE PROBLEMS
  ════════════════════════════════════════════════ -->
  <section class="section" id="sec-practice">
    <div class="section-header">
      <h2>Problemas para Praticar</h2>
      <p>Perguntas clássicas de entrevista. Tente resolver com os 5 passos antes de abrir os pontos-chave.</p>
    </div>

    <div class="acc">

      <div class="acc-item">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Rate Limiter distribuído</span>
            <span class="badge badge-green">médio</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <ul>
            <li>Escolha do algoritmo (token bucket vs. sliding window) e justificativa.</li>
            <li>Estado compartilhado entre réplicas do gateway (Redis) e atomicidade (script Lua).</li>
            <li>Regras por cliente/endpoint, resposta <code>429</code> com <code>Retry-After</code>.</li>
            <li>Fail-open vs. fail-closed se o armazenamento de contadores cair.</li>
          </ul>
        </div>
      </div>

      <div class="acc-item">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">News Feed (Twitter / Instagram)</span>
            <span class="badge badge-amber">difícil</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <ul>
            <li><strong>Fan-out on write</strong> (push para timelines pré-computadas) vs. <strong>fan-out on read</strong> (monta a timeline na leitura).</li>
            <li>Modelo híbrido: push para usuários comuns, pull para celebridades com milhões de seguidores.</li>
            <li>Timeline em cache (lista de IDs no Redis), mídia em object storage + CDN.</li>
            <li>Paginação por cursor, não por offset.</li>
          </ul>
        </div>
      </div>

      <div class="acc-item">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Chat (WhatsApp / Slack)</span>
            <span class="badge badge-amber">difícil</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <ul>
            <li>Conexões persistentes (WebSocket) e um serviço que sabe em qual servidor cada usuário está conectado.</li>
            <li>Ordenação por conversa (sequence number por <code>conversation_id</code>) — ordem global não é necessária.</li>
            <li>Entrega para usuários offline (store-and-forward) e confirmações de entrega/leitura.</li>
            <li>Particionamento do armazenamento de mensagens por conversa (ex.: Cassandra).</li>
          </ul>
        </div>
      </div>

      <div class="acc-item">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Notification System</span>
            <span class="badge badge-green">médio</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <ul>
            <li>Múltiplos canais (push, e-mail, SMS) com filas e workers separados por canal.</li>
            <li>Retries com backoff e idempotência para não notificar duas vezes.</li>
            <li>Preferências e opt-out do usuário, rate limit por usuário, templates.</li>
            <li>Integração com provedores externos (APNs, FCM, SES, Twilio) e o que fazer quando eles falham.</li>
          </ul>
        </div>
      </div>

      <div class="acc-item">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Web Crawler</span>
            <span class="badge badge-green">médio</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <ul>
            <li>URL frontier: fila com prioridade e particionada por domínio.</li>
            <li>Politeness: respeitar <code>robots.txt</code> e limitar requisições por domínio.</li>
            <li>Deduplicação: Bloom filter para URLs já vistas, hash de conteúdo para páginas duplicadas.</li>
            <li>Cache de DNS, armazenamento distribuído das páginas, detecção de spider traps.</li>
          </ul>
        </div>
      </div>

      <div class="acc-item">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Ride Sharing (Uber / 99)</span>
            <span class="badge badge-amber">difícil</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <ul>
            <li>Atualizações frequentes de localização (a cada poucos segundos) — sistema write-heavy.</li>
            <li>Índice geoespacial: geohash, quadtree ou H3 para "motoristas próximos".</li>
            <li>Matching com garantia de que um motorista não seja atribuído a duas corridas (lock/consistência forte nesse ponto).</li>
            <li>Preço dinâmico, ETA e particionamento por região/cidade.</li>
          </ul>
        </div>
      </div>

      <div class="acc-item">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Key-Value Store distribuído</span>
            <span class="badge badge-coral">avançado</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <ul>
            <li>Particionamento com consistent hashing e virtual nodes.</li>
            <li>Replicação com quorum configurável (N, R, W) e o tradeoff consistência × latência.</li>
            <li>Detecção de falhas (gossip), hinted handoff e anti-entropy (Merkle trees).</li>
            <li>Resolução de conflitos: vector clocks ou last-write-wins.</li>
          </ul>
        </div>
      </div>

    </div>
  </section>

  <hr class="section-divider">

  <!-- ═══════════════════════════════════════════════
       SECTION — COURSE CONNECTION
  ════════════════════════════════════════════════ -->
  <section class="section" id="sec-course">
    <div class="section-header">
      <h2>Conexão com a Disciplina</h2>
      <p>Onde cada conceito de entrevista aparece nas aulas e nos hands-ons de 2026.2.</p>
    </div>

    <div class="callout">
      <p>Os hands-ons constroem, peça por peça, a mesma arquitetura do diagrama: <strong>gateway → load balancer → serviços stateless → cache → banco → fila → observabilidade</strong>. Use o seu projeto como exemplo concreto na entrevista: <em>"no meu projeto, coloquei Redis compartilhado atrás do gateway porque cada réplica tinha um cache local inconsistente..."</em></p>
    </div>

    <div class="card-grid-3">
      <a class="card border-amber" href="../classes/distributed_systems/">
        <div class="card-label amber">Aula 1</div>
        <h3>Distributed Systems</h3>
        <p>CAP theorem, consistência e algoritmos de consenso.</p>
      </a>
      <a class="card border-green" href="../hands-on/2/">
        <div class="card-label green">Hands-on 2</div>
        <h3>Gateway</h3>
        <p>Ponto único de entrada, roteamento e o lugar natural do rate limiting.</p>
      </a>
      <a class="card border-blue" href="../hands-on/7/">
        <div class="card-label blue">Hands-on 7</div>
        <h3>Load Balancer</h3>
        <p>Nginx distribuindo tráfego entre réplicas — escala horizontal na prática.</p>
      </a>
      <a class="card border-purple" href="../hands-on/8/">
        <div class="card-label purple">Hands-on 8</div>
        <h3>In-Memory Cache</h3>
        <p>Redis compartilhado entre réplicas, cache-aside e TTL.</p>
      </a>
      <a class="card border-green" href="../hands-on/9/">
        <div class="card-label green">Hands-on 9</div>
        <h3>Kafka Messaging</h3>
        <p>Processamento assíncrono orientado a eventos e desacoplamento entre serviços.</p>
      </a>
      <a class="card border-coral" href="../classes/reliability/">
        <div class="card-label coral">Aula 8</div>
        <h3>Reliability</h3>
        <p>SLI/SLO/SLA, resilience patterns e chaos engineering.</p>
      </a>
      <a class="card border-blue" href="../hands-on/6/">
        <div class="card-label blue">Hands-on 6</div>
        <h3>Observability</h3>
        <p>Métricas com Prometheus e dashboards no Grafana.</p>
      </a>
      <a class="card border-blue" href="../hands-on/10/">
        <div class="card-label blue">Hands-on 10</div>
        <h3>Distributed Tracing</h3>
        <p>OpenTelemetry + Jaeger: onde o tempo de uma requisição foi gasto.</p>
      </a>
      <a class="card border-amber" href="../exercises/bottlenecks/">
        <div class="card-label amber">Exercício</div>
        <h3>Bottlenecks</h3>
        <p>Identificar e mitigar gargalos — o passo 4 do roteiro de design.</p>
      </a>
    </div>
  </section>

  <hr class="section-divider">

  <!-- ═══════════════════════════════════════════════
       SECTION — QUIZ
  ════════════════════════════════════════════════ -->
  <section class="section" id="sec-quiz">
    <div class="section-header">
      <h2>Quiz</h2>
      <p>Teste seus conhecimentos com questões no estilo de entrevista real.</p>
    </div>

    <div class="quiz-section">
      <div class="quiz-progress"><div class="quiz-progress-fill" id="iv-qpf" style="width:10%"></div></div>
      <div class="quiz-num" id="iv-qnum">Questão 1</div>
      <div class="quiz-q" id="iv-qtext"></div>
      <div class="quiz-opts" id="iv-qopts"></div>
      <div id="iv-qfb"></div>
      <div class="quiz-nav">
        <button type="button" data-iv-prev>← anterior</button>
        <span class="quiz-score" id="iv-qscore"></span>
        <button type="button" data-iv-next>próxima →</button>
      </div>
    </div>
    <button type="button" class="btn-ghost" data-iv-quiz-reset>↺ reiniciar quiz</button>
  </section>

  <hr class="section-divider">

  <!-- ═══════════════════════════════════════════════
       SECTION — CHECKLIST
  ════════════════════════════════════════════════ -->
  <section class="section" id="sec-checklist">
    <div class="section-header">
      <h2>Checklist de Entrevista</h2>
      <p>Use para avaliar sua preparação antes de entrar numa entrevista de System Design. Marque os itens conforme pratica — o progresso fica salvo neste navegador.</p>
    </div>

    <div class="check-progress" id="iv-check-progress"></div>
    <div class="checklist" id="iv-checklist"></div>
    <button type="button" class="btn-ghost" data-iv-check-reset>↺ resetar checklist</button>
  </section>

  <hr class="section-divider">

  <!-- ═══════════════════════════════════════════════
       SECTION — REFERÊNCIAS
  ════════════════════════════════════════════════ -->
  <section class="section" id="sec-refs">
    <div class="section-header">
      <h2>Referências</h2>
      <p>Recursos fundamentais para aprofundamento — organizados por tipo e relevância para entrevistas técnicas.</p>
    </div>

    <h3 class="sub-h">Livros</h3>
    <div class="refs-grid">
      <a class="ref-card" href="https://www.crackingthecodinginterview.com/" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--accent);">Livro — referência principal</div>
        <div class="ref-title">Cracking the Coding Interview (6ª ed.)</div>
        <div class="ref-desc">Gayle Laakmann McDowell. Capítulo 9 dedicado a System Design e Scalability. Fonte principal do conteúdo desta aula.</div>
        <div class="ref-url">crackingthecodinginterview.com</div>
      </a>
      <a class="ref-card" href="https://www.oreilly.com/library/view/designing-data-intensive-applications/9781491903063/" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--blue);">Livro — referência avançada</div>
        <div class="ref-title">Designing Data-Intensive Applications</div>
        <div class="ref-desc">Martin Kleppmann (O'Reilly). O melhor livro sobre sistemas distribuídos: replicação, particionamento, transactions, stream processing. Leitura obrigatória.</div>
        <div class="ref-url">oreilly.com — ISBN 978-1491903063</div>
      </a>
      <a class="ref-card" href="https://www.amazon.com/System-Design-Interview-insiders-Second/dp/B08CMF2CQF" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--purple);">Livro — prep de entrevistas</div>
        <div class="ref-title">System Design Interview (Vol. 1 &amp; 2)</div>
        <div class="ref-desc">Alex Xu. Casos práticos de design de sistemas reais (URL shortener, Twitter, YouTube, Uber). Excelente para praticar o formato de entrevista.</div>
        <div class="ref-url">amazon.com — Alex Xu</div>
      </a>
      <a class="ref-card" href="https://www.amazon.com/Clean-Architecture-Craftsmans-Software-Structure/dp/0134494164" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--amber);">Livro — arquitetura de software</div>
        <div class="ref-title">Clean Architecture</div>
        <div class="ref-desc">Robert C. Martin (Uncle Bob). Princípios de design de software que se conectam diretamente às decisões arquiteturais em entrevistas de system design.</div>
        <div class="ref-url">amazon.com — Robert C. Martin</div>
      </a>
    </div>

    <h3 class="sub-h">Recursos Online Gratuitos</h3>
    <div class="refs-grid">
      <a class="ref-card" href="https://github.com/donnemartin/system-design-primer" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--accent);">GitHub — repositório essencial</div>
        <div class="ref-title">System Design Primer</div>
        <div class="ref-desc">Donnemartin. O repositório mais completo e gratuito sobre system design. Inclui flashcards, exemplos completos, diagramas e guia de estudo estruturado. Mais de 280k stars no GitHub.</div>
        <div class="ref-url">github.com/donnemartin/system-design-primer</div>
      </a>
      <a class="ref-card" href="https://highscalability.com/" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--blue);">Blog — casos reais</div>
        <div class="ref-title">High Scalability</div>
        <div class="ref-desc">Blog dedicado a como grandes sistemas (Twitter, Netflix, Amazon, Instagram) foram construídos e escalados. Cada post é um estudo de caso real de arquitetura.</div>
        <div class="ref-url">highscalability.com</div>
      </a>
      <a class="ref-card" href="https://www.youtube.com/@ByteByteGo" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--purple);">YouTube — vídeos</div>
        <div class="ref-title">ByteByteGo (Alex Xu)</div>
        <div class="ref-desc">Canal do YouTube com animações e explicações visuais de system design. Excelente para entender visualmente como os componentes se conectam. Complementa o livro System Design Interview.</div>
        <div class="ref-url">youtube.com/@ByteByteGo</div>
      </a>
      <a class="ref-card" href="https://www.educative.io/courses/grokking-modern-system-design-interview-for-engineers-managers" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--amber);">Curso interativo</div>
        <div class="ref-title">Grokking Modern System Design Interview</div>
        <div class="ref-desc">Educative.io. Curso estruturado com problemas práticos e soluções passo a passo. Cobre design de sistemas como TinyURL, Instagram, Netflix e Uber.</div>
        <div class="ref-url">educative.io</div>
      </a>
      <a class="ref-card" href="https://www.geeksforgeeks.org/system-design-tutorial/" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--coral);">Tutorial</div>
        <div class="ref-title">GeeksforGeeks — System Design Tutorial</div>
        <div class="ref-desc">Tutorial completo com artigos individuais para cada conceito: load balancing, caching, sharding, CAP theorem, consistent hashing, SQL vs NoSQL e mais.</div>
        <div class="ref-url">geeksforgeeks.org/system-design-tutorial</div>
      </a>
      <a class="ref-card" href="https://leetcode.com/discuss/interview-question/system-design" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--accent);">Prática</div>
        <div class="ref-title">LeetCode — System Design Discussions</div>
        <div class="ref-desc">Fórum do LeetCode com discussões de system design questions reais feitas em entrevistas nas principais empresas de tecnologia (FAANG, startups de alto crescimento).</div>
        <div class="ref-url">leetcode.com/discuss/system-design</div>
      </a>
      <a class="ref-card" href="https://sre.google/books/" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--blue);">Livro online — gratuito</div>
        <div class="ref-title">Site Reliability Engineering (Google)</div>
        <div class="ref-desc">Os livros de SRE do Google, disponíveis gratuitamente. Referência para SLOs, error budgets, monitoramento e resposta a incidentes — a parte "operar em produção" do system design.</div>
        <div class="ref-url">sre.google/books</div>
      </a>
    </div>

    <h3 class="sub-h">Artigos &amp; Papers Técnicos</h3>
    <div class="refs-grid">
      <a class="ref-card" href="https://static.googleusercontent.com/media/research.google.com/en//archive/mapreduce-osdi04.pdf" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--blue);">Paper — Google</div>
        <div class="ref-title">MapReduce: Simplified Data Processing on Large Clusters</div>
        <div class="ref-desc">Dean &amp; Ghemawat, OSDI 2004. O paper original do MapReduce. Leitura fundamental para entender o modelo de programação, casos de uso e implementação de referência.</div>
        <div class="ref-url">research.google.com — OSDI 2004</div>
      </a>
      <a class="ref-card" href="https://www.allthingsdistributed.com/2007/10/amazons_dynamo.html" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--amber);">Paper — Amazon</div>
        <div class="ref-title">Dynamo: Amazon's Highly Available Key-Value Store</div>
        <div class="ref-desc">DeCandia et al., SOSP 2007. Paper que introduziu consistent hashing, eventual consistency e o CAP theorem na prática. Fundação conceitual para Cassandra, DynamoDB e Riak.</div>
        <div class="ref-url">allthingsdistributed.com — SOSP 2007</div>
      </a>
      <a class="ref-card" href="https://engineering.fb.com/category/core-data/" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--purple);">Blog de engenharia</div>
        <div class="ref-title">Meta Engineering Blog</div>
        <div class="ref-desc">Artigos técnicos sobre como o Facebook/Meta escala sistemas: TAO (distributed data store), Cassandra, cache hierarchy, Haystack (object storage) e mais. Casos reais em escala de bilhões.</div>
        <div class="ref-url">engineering.fb.com</div>
      </a>
      <a class="ref-card" href="https://netflixtechblog.com/" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--coral);">Blog de engenharia</div>
        <div class="ref-title">Netflix Tech Blog</div>
        <div class="ref-desc">Como o Netflix resolve problemas de escala: microservices, chaos engineering (Chaos Monkey), global CDN, video encoding, recomendações com ML. Referência para sistemas de alta disponibilidade.</div>
        <div class="ref-url">netflixtechblog.com</div>
      </a>
      <a class="ref-card" href="https://gist.github.com/jboner/2841832" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--accent);">Referência rápida</div>
        <div class="ref-title">Latency Numbers Every Programmer Should Know</div>
        <div class="ref-desc">A tabela clássica de latências popularizada por Jeff Dean e Peter Norvig — a base para as estimativas back-of-the-envelope desta página.</div>
        <div class="ref-url">gist.github.com/jboner/2841832</div>
      </a>
    </div>

    <h3 class="sub-h">Ferramentas para Praticar</h3>
    <div class="refs-grid">
      <a class="ref-card" href="https://www.pramp.com/" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--accent);">Prática com peers</div>
        <div class="ref-title">Pramp</div>
        <div class="ref-desc">Plataforma gratuita para praticar entrevistas técnicas com outros candidatos. Inclui sessões de system design com feedback estruturado. Excelente para simular o ambiente real de entrevista.</div>
        <div class="ref-url">pramp.com</div>
      </a>
      <a class="ref-card" href="https://interviewing.io/" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--blue);">Mock interviews</div>
        <div class="ref-title">interviewing.io</div>
        <div class="ref-desc">Mock interviews com engenheiros de empresas como Google, Facebook, Amazon. Permite praticar system design e algoritmos com feedback de profissionais experientes em entrevistas.</div>
        <div class="ref-url">interviewing.io</div>
      </a>
    </div>
  </section>

  <hr class="section-divider">

  <footer class="site-footer">
    <span>Coding Interview Prep · System Design &amp; Scalability</span>
    <span>Material de apoio — uso educacional</span>
  </footer>

</div>
