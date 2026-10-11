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
    <p>Study material for technical interviews — how to think about, communicate and design scalable systems. Based on <em>Cracking the Coding Interview</em> (G. McDowell) and top-tier software engineering references, connected to the topics and hands-ons of the course.</p>
  </header>

  <!-- TABLE OF CONTENTS -->
  <nav class="toc" aria-label="Contents">
    <h2>Contents</h2>
    <div class="toc-grid">
      <a href="#sec-intro">Algorithms vs. System Design</a>
      <a href="#sec-abordagem">Handling the Questions (8 principles)</a>
      <a href="#sec-design">Design Step-By-Step (5 steps)</a>
      <a href="#sec-algo">Algorithms that Scale (4 steps)</a>
      <a href="#sec-numbers">Back-of-the-Envelope</a>
      <a href="#sec-concepts">Key Concepts</a>
      <a href="#sec-example">Worked Example: URL Shortener</a>
      <a href="#sec-practice">Practice Problems</a>
      <a href="#sec-course">Connection to the Course</a>
      <a href="#sec-quiz">Quiz</a>
      <a href="#sec-checklist">Interview Checklist</a>
      <a href="#sec-refs">References</a>
    </div>
  </nav>

  <!-- ═══════════════════════════════════════════════
       SECTION 1 — INTRO
  ════════════════════════════════════════════════ -->
  <section class="section" id="sec-intro">
    <div class="section-header">
      <h2>Algorithms vs. System Design</h2>
      <p>Two kinds of problem, two distinct skills — but the same structured way of reasoning.</p>
    </div>

    <div class="card-grid">
      <div class="card border-green">
        <div class="card-label green">Algorithm Questions</div>
        <h3>Closed problem</h3>
        <p>They usually have a deterministic solution. The focus is on the correctness of the algorithm, its O(n) complexity and a clean implementation. Examples: "find the shortest path", "check whether a tree is a BST".</p>
      </div>
      <div class="card border-blue">
        <div class="card-label blue">System Design Questions</div>
        <h3>Open problem</h3>
        <p>There is no single answer. The focus is on tradeoffs, scalability, communication and engineering reasoning. Examples: "design Twitter", "design a URL shortening system for 100M users".</p>
      </div>
    </div>

    <div class="callout">
      <p><strong>"Tackle the problem by doing it just like you would at work."</strong><br>
      Ask questions. Engage the interviewer. Discuss the tradeoffs. There is no perfect answer — there is well-articulated reasoning and justified solutions.</p>
    </div>

    <div class="itip">
      <div class="itip-label">Essential mindset</div>
      <p>In system design, the interviewer wants to see <strong>how you think</strong>, not just what you have memorized. A candidate who asks good questions, makes assumptions explicit and admits uncertainty with solid reasoning often outperforms a candidate who tries to recite a ready-made architecture.</p>
    </div>

    <h3 class="sub-h">What the interviewer evaluates</h3>
    <div class="tag-strip">
      <span class="badge badge-green">Clear communication</span>
      <span class="badge badge-blue">Structured reasoning</span>
      <span class="badge badge-amber">Technical knowledge</span>
      <span class="badge badge-purple">Managing tradeoffs</span>
      <span class="badge badge-coral">Realistic estimates</span>
      <span class="badge badge-gray">Spotting bottlenecks</span>
    </div>

    <div class="table-wrap" style="margin-top:16px;"><table class="cmp-table">
      <thead>
        <tr>
          <th>Aspect</th>
          <th>Algorithm Interview</th>
          <th>System Design Interview</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>Correct answer</td><td>Deterministic, usually unique</td><td>Multiple valid solutions</td></tr>
        <tr><td>Focus</td><td>Correctness and complexity</td><td>Tradeoffs and scalability</td></tr>
        <tr><td>Typical length</td><td>20–45 min</td><td>45–60 min</td></tr>
        <tr><td>Communication</td><td>Important</td><td>Critical — it is the main evaluation</td></tr>
        <tr><td>Whiteboard/diagram</td><td>Useful</td><td>Mandatory</td></tr>
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
      <p>8 principles to run a system design interview with confidence and clarity.</p>
    </div>

    <div class="step-list">
      <div class="step-item">
        <div class="step-num green">1</div>
        <div class="step-body">
          <strong>Communicate</strong>
          <span>Think out loud. The interviewer wants to follow your reasoning, not just see the final solution. Long silence is the biggest enemy in a system design interview — even if you don't know the answer yet, say what you are thinking: "I'm considering a cache here because..."</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num green">2</div>
        <div class="step-body">
          <strong>Go broad first</strong>
          <span>Before diving into details, sketch the whole system at a high level. Establish the main components before going deep into any of them. Detailing a component too early, only to redesign it later, is a common mistake.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num green">3</div>
        <div class="step-body">
          <strong>Use the whiteboard</strong>
          <span>Draw! Diagrams help both the interviewer and you keep the reasoning organized. A clear block diagram communicates more than minutes of verbal explanation. Start simple and refine.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num green">4</div>
        <div class="step-body">
          <strong>Acknowledge interviewer concerns</strong>
          <span>If the interviewer raises an objection or points out a problem, don't ignore it or defend your position at all costs. Say: "good point, let me reconsider that part". This shows technical maturity and openness to feedback.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num green">5</div>
        <div class="step-body">
          <strong>Be careful about assumptions</strong>
          <span>Implicit assumptions are traps. If you assume the system has 1,000 users when it actually has 1 billion, your whole solution may be wrong. Ask before you assume.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num green">6</div>
        <div class="step-body">
          <strong>State your assumptions explicitly</strong>
          <span>When you need to assume something (which is unavoidable), say it out loud: "I'll assume the system must support 10M daily active users, peaking at 100k req/s". The interviewer can correct it, confirm it or give more context.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num green">7</div>
        <div class="step-body">
          <strong>Estimate when necessary</strong>
          <span>Back-of-envelope calculations are expected and valued. Know how to make quick estimates of throughput, storage and bandwidth. E.g.: "1M users × 100KB/user = ~100GB of storage". It doesn't need to be exact — the order of magnitude is what matters.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num green">8</div>
        <div class="step-body">
          <strong>Drive</strong>
          <span>You lead the session. Don't wait for the interviewer to tell you what to do next. Propose the next step: "I'll focus on the database layer now, OK?" or "I see two main bottlenecks — let me tackle the most critical one first". Take ownership.</span>
        </div>
      </div>
    </div>

    <div class="callout callout-amber">
      <p><strong>Practical tip:</strong> Use explicit transitions between stages. When moving from "main components" to "identifying bottlenecks", say: <em>"Now that we have the main components, I'll identify the critical points of this system."</em> This keeps the interviewer oriented in your structure.</p>
    </div>
  </section>

  <hr class="section-divider">

  <!-- ═══════════════════════════════════════════════
       SECTION 3 — DESIGN STEP BY STEP
  ════════════════════════════════════════════════ -->
  <section class="section" id="sec-design">
    <div class="section-header">
      <h2>Design: Step-By-Step</h2>
      <p>A 5-step structure to design complex systems in an organized way during the interview.</p>
    </div>

    <div class="step-list">
      <div class="step-item">
        <div class="step-num amber">1</div>
        <div class="step-body">
          <strong>Scope the Problem</strong>
          <span>Ask questions to narrow down the problem. How many users? Which features are essential vs. nice-to-have? Is the system read-intensive or write-intensive? Is strong consistency required, or is eventual consistency enough? Define the scope before any architecture. Typical questions: "What are the main features I should design?", "What scale do we expect in 1 year?", "Are there latency constraints?"</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num amber">2</div>
        <div class="step-body">
          <strong>Make Reasonable Assumptions</strong>
          <span>With the scope defined, state explicit assumptions: "I'll assume 10M DAU, a peak of 100k req/s, 99.9% availability (at most ~8.7h of downtime per year), and that the system is far more read-heavy than write-heavy (100:1)". This anchors the rest of the conversation and shows that you think in concrete metrics.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num amber">3</div>
        <div class="step-body">
          <strong>Draw the Major Components</strong>
          <span>Sketch the main blocks: clients → load balancers → web/app servers → caches → databases → message queues → CDN. Don't go into details yet — big picture first. Each block must have a clear purpose. Label the arrows with the kind of data flowing between components.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num amber">4</div>
        <div class="step-body">
          <strong>Identify the Key Issues</strong>
          <span>Where are the bottlenecks? What are the single points of failure? Which components will "break" first as the system grows? Is the database the read bottleneck? Does the application server hold state that prevents horizontal scaling? Identify the critical points before proposing solutions.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num amber">5</div>
        <div class="step-body">
          <strong>Redesign for the Key Issues</strong>
          <span>Now you go deeper: add sharding to the database, caching on hot paths, horizontal scaling of the app servers, a CDN for static assets, queues for asynchronous processing. Redesign iteratively, focusing on the problems you identified. Justify each decision with the tradeoffs involved.</span>
        </div>
      </div>
    </div>

    <!-- DIAGRAMA SVG -->
    <div class="diagram-wrap">
      <div class="diagram-label">example — scalable URL shortener architecture</div>
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
        <text x="43"  y="212" text-anchor="middle" font-size="9" fill="#9a9a94" font-family="JetBrains Mono,monospace">scope</text>
        <text x="229" y="200" text-anchor="middle" font-size="9" fill="#9a9a94" font-family="JetBrains Mono,monospace">steps 2–3</text>
        <text x="229" y="212" text-anchor="middle" font-size="9" fill="#9a9a94" font-family="JetBrains Mono,monospace">components</text>
        <text x="454" y="200" text-anchor="middle" font-size="9" fill="#9a9a94" font-family="JetBrains Mono,monospace">step 4–5</text>
        <text x="454" y="212" text-anchor="middle" font-size="9" fill="#9a9a94" font-family="JetBrains Mono,monospace">bottlenecks / redesign</text>
        <text x="667" y="200" text-anchor="middle" font-size="9" fill="#9a9a94" font-family="JetBrains Mono,monospace">async processing</text>
        <text x="667" y="212" text-anchor="middle" font-size="9" fill="#9a9a94" font-family="JetBrains Mono,monospace">decoupling</text>
      </svg>
    </div>

    <div class="itip">
      <div class="itip-label">Key scoping question</div>
      <p>Always ask: <strong>"Is this system read-heavy or write-heavy?"</strong> — it changes everything. <br>
      Read-heavy (e.g. URL shortener, Twitter timeline) → aggressive caching, DB read replicas.<br>
      Write-heavy (e.g. log ingestion, real-time chat) → queues + asynchronous processing, eventual consistency.</p>
    </div>
  </section>

  <hr class="section-divider">

  <!-- ═══════════════════════════════════════════════
       SECTION 4 — ALGORITHMS THAT SCALE
  ════════════════════════════════════════════════ -->
  <section class="section" id="sec-algo">
    <div class="section-header">
      <h2>Algorithms that Scale: Step-By-Step</h2>
      <p>When the problem is algorithmic but must run at massive scale — data that does not fit in one machine.</p>
    </div>

    <div class="callout callout-blue">
      <p>Unlike pure system design, here you start from a correct algorithm and iterate until it works with billions of records. The key is to recognize where the solution "breaks" as it scales and to address exactly those points.</p>
    </div>

    <div class="step-list">
      <div class="step-item">
        <div class="step-num amber">1</div>
        <div class="step-body">
          <strong>Ask Questions</strong>
          <span>How much data? What is the distribution? What are the time and memory constraints? Does the data fit in RAM? Are there duplicates? Is it sorted? Are approximations (approximate algorithms) acceptable, or is exact precision required? The right questions reveal the real problem and the applicable techniques.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num amber">2</div>
        <div class="step-body">
          <strong>Make Believe</strong>
          <span>Assume the data fits in a single machine and solve the problem there. Find the correct algorithm, ignoring scale for now. This gives you the baseline solution you will adapt. E.g.: for the top-K words in 1TB of logs, you would start with a HashMap + a MinHeap of size K.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num amber">3</div>
        <div class="step-body">
          <strong>Get Real</strong>
          <span>Now face reality: the data doesn't fit in RAM, or doesn't fit on one machine's disk, or serial processing would be too slow. How do you split the problem? Hash partitioning? Sampling? Streaming? Which parts can be parallelized?</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num amber">4</div>
        <div class="step-body">
          <strong>Solve Problems</strong>
          <span>Identify which parts of the step 2 solution break at scale and fix exactly those points. Sharding, MapReduce, approximate counting (HyperLogLog for distinct counts, Count-Min Sketch for frequencies), reservoir sampling for streaming data.</span>
        </div>
      </div>
    </div>

    <div class="card-grid">
      <div class="card border-amber">
        <div class="card-label amber">Full example</div>
        <h3>Top-K words in 1TB of logs</h3>
        <p><strong>Make believe:</strong> HashMap&lt;String, Integer&gt; to count + a MinHeap of size K for the top-K. O(N log K).<br><br>
        <strong>Get real:</strong> 1TB doesn't fit in RAM (assume ~10GB of heap).<br><br>
        <strong>Solve:</strong> Split the file into N chunks. Each worker processes one chunk → emits (word, count). A central reducer aggregates counts per word and keeps a global MinHeap of size K.<br><br>
        Alternative: MapReduce — Map emits (word, 1), Reduce sums, each reducer keeps a local top-K, final merge.</p>
      </div>
      <div class="card border-purple">
        <div class="card-label purple">Scaling techniques</div>
        <h3>When to use each approach</h3>
        <p><strong>MapReduce:</strong> batch, parallelizable data; fits word count, PageRank, joins of large tables.<br><br>
        <strong>HyperLogLog:</strong> counts distinct elements with ~1% error using O(log log N) memory. Ideal for "how many unique users visited?"<br><br>
        <strong>Count-Min Sketch:</strong> approximate frequency of elements. Ideal for top-K with high cardinality.<br><br>
        <strong>Bloom Filter:</strong> probabilistic membership check. "Has this URL already been visited?" with zero false negatives.</p>
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
      <p>Reference numbers for quick estimates — the order of magnitude is what matters, not precision.</p>
    </div>

    <div class="metric-grid">
      <div class="metric-card">
        <div class="metric-label">1 day</div>
        <div class="metric-val" style="color:var(--blue);">~10⁵ s</div>
        <div class="metric-desc">86,400 s. Round it to 100k and do the math in your head.</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">1M req/day</div>
        <div class="metric-val" style="color:var(--accent);">~12/s</div>
        <div class="metric-desc">That is the average. Typical peak: 2–5× the average — size for the peak.</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Read : Write</div>
        <div class="metric-val" style="color:var(--coral);">100:1</div>
        <div class="metric-desc">Typical ratio of read-heavy systems (feeds, URL shortener, catalogs).</div>
      </div>
    </div>

    <h3 class="sub-h">Latencies every engineer should know</h3>
    <div class="table-wrap">
      <table class="cmp-table">
        <thead><tr><th>Operation</th><th>Approx. latency</th><th>Implication</th></tr></thead>
        <tbody>
          <tr><td>L1 cache reference</td><td>~1 ns</td><td>CPU is practically "free" compared to I/O</td></tr>
          <tr><td>Main memory (RAM) access</td><td>~100 ns</td><td>That's why in-memory caches (Redis) answer in sub-ms</td></tr>
          <tr><td>Read 1 MB sequentially from RAM</td><td>~5–10 μs</td><td>Scanning data in memory is cheap</td></tr>
          <tr><td>Random SSD read (4 KB)</td><td>~20–100 μs</td><td>~1,000× slower than RAM</td></tr>
          <tr><td>Round trip within the same datacenter</td><td>~0.5 ms</td><td>Every call between microservices costs at least this much</td></tr>
          <tr><td>Read 1 MB sequentially from SSD</td><td>~0.2–1 ms</td><td>Sequential reads are much cheaper than random ones</td></tr>
          <tr><td>Spinning disk (HDD) seek</td><td>~5–10 ms</td><td>Avoid random HDD access on the critical path</td></tr>
          <tr><td>Round trip São Paulo ↔ Virginia (us-east-1)</td><td>~110–130 ms</td><td>Avoid synchronous cross-region calls; use CDN/edge</td></tr>
        </tbody>
      </table>
    </div>

    <h3 class="sub-h">Availability — the "nines"</h3>
    <div class="table-wrap">
      <table class="cmp-table">
        <thead><tr><th>SLO</th><th>Downtime / year</th><th>Downtime / month</th></tr></thead>
        <tbody>
          <tr><td>99%</td><td>~3.65 days</td><td>~7.3 h</td></tr>
          <tr><td>99.9%</td><td>~8.77 h</td><td>~43.8 min</td></tr>
          <tr><td>99.95%</td><td>~4.38 h</td><td>~21.9 min</td></tr>
          <tr><td>99.99%</td><td>~52.6 min</td><td>~4.38 min</td></tr>
          <tr><td>99.999%</td><td>~5.26 min</td><td>~26.3 s</td></tr>
        </tbody>
      </table>
    </div>

    <div class="card-grid">
      <div class="card border-blue">
        <div class="card-label blue">Powers of 2</div>
        <h3>Storage units</h3>
        <p><strong>2¹⁰</strong> ≈ 10³ → KB (thousand)<br>
        <strong>2²⁰</strong> ≈ 10⁶ → MB (million)<br>
        <strong>2³⁰</strong> ≈ 10⁹ → GB (billion)<br>
        <strong>2⁴⁰</strong> ≈ 10¹² → TB (trillion)<br>
        <strong>2⁵⁰</strong> ≈ 10¹⁵ → PB</p>
      </div>
      <div class="card border-green">
        <div class="card-label green">Typical sizes</div>
        <h3>To estimate storage</h3>
        <p><strong>Numeric ID / timestamp:</strong> 8 B<br>
        <strong>UUID:</strong> 16 B (36 B as text)<br>
        <strong>"Small" record (URL, short post):</strong> ~0.5–1 KB<br>
        <strong>Compressed photo:</strong> ~200 KB – 2 MB<br>
        <strong>1 min of HD video:</strong> ~50–100 MB</p>
      </div>
    </div>

    <div class="itip">
      <div class="itip-label">How to present an estimate</div>
      <p>Round aggressively, do the math <strong>out loud</strong> and, above all, say what the number changes in the architecture. "That's ~3 TB in 5 years — it fits in one database with replicas, so sharding is a future optimization, not a day-1 requirement." An estimate that does not lead to a decision is just arithmetic.</p>
    </div>
  </section>

  <hr class="section-divider">

  <!-- ═══════════════════════════════════════════════
       SECTION 5 — KEY CONCEPTS
  ════════════════════════════════════════════════ -->
  <section class="section" id="sec-concepts">
    <div class="section-header">
      <h2>Key Concepts</h2>
      <p>The concepts that show up in every system design interview — click each item to expand the explanation.</p>
    </div>

    <div class="acc" id="acc-concepts">

      <!-- 1. Horizontal vs Vertical -->
      <div class="acc-item" id="acc-scaling">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Horizontal vs. Vertical Scaling</span>
            <span class="badge badge-green">fundamentals</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p><strong>Vertical scaling (scale up):</strong> adds more CPU, RAM or disk to the same machine. It is simple — no code changes required. But it has a physical and hardware limit (there is no machine with infinite RAM), creates a single point of failure, and cost grows exponentially with capacity.</p>
          <p><strong>Horizontal scaling (scale out):</strong> adds more machines. Theoretically unlimited and cheaper at scale. It requires stateless application servers, load balancing and coordination between nodes. Most large-scale web systems scale horizontally.</p>
          <p><strong>Practical strategy:</strong> start vertical (simpler, zero refactoring), but design for horizontal from the start. When vertical hits a cost or physical limit, move to horizontal. The mistake is not planning for this from the beginning.</p>
          <div class="table-wrap" style="margin-top:12px;"><table class="cmp-table">
            <thead><tr><th>Aspect</th><th>Vertical</th><th>Horizontal</th></tr></thead>
            <tbody>
              <tr><td>Implementation</td><td>Simple</td><td>Complex</td></tr>
              <tr><td>Limit</td><td>Maximum hardware</td><td>Practically unlimited</td></tr>
              <tr><td>Cost</td><td>Grows exponentially</td><td>Grows linearly</td></tr>
              <tr><td>Single point of failure</td><td>Yes</td><td>No (with redundancy)</td></tr>
              <tr><td>Downtime when expanding</td><td>Usually yes</td><td>No</td></tr>
            </tbody>
          </table></div>
        </div>
      </div>

      <!-- 2. Load Balancer -->
      <div class="acc-item" id="acc-lb">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Load Balancer</span>
            <span class="badge badge-blue">infrastructure</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p>Distributes requests across multiple backend servers, preventing any server from being overloaded while others sit idle. It also runs health checks and automatically removes failed servers from the pool.</p>
          <p><strong>Distribution algorithms:</strong></p>
          <ul>
            <li><code>Round-robin:</code> each server receives requests in turn. Simple, but ignores the current load.</li>
            <li><code>Weighted round-robin:</code> more powerful servers receive a larger share of requests.</li>
            <li><code>Least connections:</code> forwards to the server with the fewest active connections. Better for requests of variable duration.</li>
            <li><code>IP hash:</code> <code>shard = hash(client_IP) % N</code>. Guarantees sticky sessions (same client → same server). Useful when the server holds state.</li>
          </ul>
          <p><strong>Implementation types:</strong> Hardware (F5, Cisco), software (Nginx, HAProxy, Envoy), cloud-managed (AWS ALB/NLB, GCP Cloud Load Balancing).</p>
          <p><strong>Watch out:</strong> the load balancer itself can become a single point of failure. Solution: active/passive pairs (primary + standby with automatic failover) or DNS-based load balancing (multiple IPs in DNS with a short TTL).</p>
        </div>
      </div>

      <!-- 3. DB Denormalization & NoSQL -->
      <div class="acc-item" id="acc-nosql">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Database Denormalization &amp; NoSQL</span>
            <span class="badge badge-amber">data</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p><strong>Denormalization:</strong> denormalizing a relational database means strategically duplicating data to avoid expensive JOINs. You trade consistency (updates must be made in several places) for read performance. It works well when reads far outnumber writes and JOINs are a proven bottleneck.</p>
          <p><strong>NoSQL — when and which to use:</strong></p>
          <ul>
            <li><strong>Key-Value</strong> (Redis, DynamoDB): O(1) access by key. Ideal for sessions, caching, leaderboards, rate limiting.</li>
            <li><strong>Document</strong> (MongoDB, Couchbase): semi-structured data, flexible schema. Ideal for product catalogs, user profiles.</li>
            <li><strong>Column-family</strong> (Cassandra, HBase): massive distributed writes, queries by partition key. Ideal for time series, IoT, logs.</li>
            <li><strong>Graph</strong> (Neo4j, Amazon Neptune): complex relationships between entities. Ideal for social graphs, recommendation systems, fraud detection.</li>
          </ul>
          <p><strong>CAP Theorem:</strong> in a distributed system, you can guarantee at most 2 of the 3 properties: <code>Consistency</code> (all nodes see the same data), <code>Availability</code> (every request gets a response), <code>Partition tolerance</code> (the system keeps working despite network failures). In practice, P is unavoidable — you choose between CP (consistency) and AP (availability).</p>
        </div>
      </div>

      <!-- 4. Sharding -->
      <div class="acc-item" id="acc-sharding">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Database Partitioning (Sharding)</span>
            <span class="badge badge-amber">data</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p>Splits the database across multiple nodes (shards), where each node stores a subset of the data. It lets you scale storage and query throughput horizontally beyond the limits of a single machine.</p>
          <p><strong>Sharding strategies:</strong></p>
          <ul>
            <li><strong>Vertical partitioning:</strong> different tables on different servers. Simple, but limits the growth of individual tables.</li>
            <li><strong>Horizontal (range-based):</strong> users with id 1–1M on shard A, 1M–2M on B. Good for range queries, but can create hot spots if the distribution is uneven.</li>
            <li><strong>Hash-based:</strong> <code>shard = hash(user_id) % N</code>. Uniform distribution, avoids hot spots. Makes range queries harder. <strong>Consistent hashing</strong> minimizes data remapping when nodes are added or removed.</li>
            <li><strong>Directory-based:</strong> a lookup table maps key → shard. Flexible (lets you move data without rehashing), but the table becomes a bottleneck and a single point of failure.</li>
          </ul>
          <p><strong>Classic problem:</strong> queries that span shards (cross-shard joins) are extremely expensive. Choose the sharding key based on the most frequent access patterns. If 90% of queries are by <code>user_id</code>, use <code>user_id</code> as the sharding key.</p>
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
          <p>Stores computed results or frequently accessed data in memory (much faster than disk) to avoid recomputation or database I/O. It is one of the highest-impact optimizations in read-heavy systems.</p>
          <p><strong>Eviction policies (when memory is full):</strong></p>
          <ul>
            <li><code>LRU (Least Recently Used):</code> removes the item accessed longest ago. It is the default — it works well for most workloads.</li>
            <li><code>LFU (Least Frequently Used):</code> removes the least frequently accessed item. Better when data popularity is stable over time.</li>
            <li><code>TTL (Time-To-Live):</code> each item has an expiration time. Essential for time-sensitive data (e.g. prices, sessions).</li>
          </ul>
          <p><strong>Write strategies:</strong></p>
          <ul>
            <li><code>Write-through:</code> writes to the cache and the database at the same time. Guaranteed consistency, but higher write latency.</li>
            <li><code>Write-back (write-behind):</code> writes to the cache immediately and propagates to the database asynchronously. Higher throughput, but risk of data loss if the cache fails.</li>
            <li><code>Write-around:</code> writes straight to the database, bypassing the cache. The cache is only populated on the next read. Useful when written data is rarely read right afterwards.</li>
          </ul>
          <p><strong>Classic problems:</strong> <em>Cache stampede</em> (many keys expiring at the same time cause a flood of database queries — use probabilistic expiration or a mutex lock), <em>cold start</em> (empty cache after a deploy — use warm-up scripts), <em>cache poisoning</em> (invalid data in the cache).</p>
        </div>
      </div>

      <!-- 6. Async Queues -->
      <div class="acc-item" id="acc-queues">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Asynchronous Processing &amp; Queues</span>
            <span class="badge badge-green">architecture</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p>Instead of processing everything synchronously inside the user's request, you enqueue the heavy work for asynchronous execution. The user gets a fast response (an acknowledgment), and workers do the processing in the background.</p>
          <p><strong>Classic use cases:</strong></p>
          <ul>
            <li>Sending email/SMS after sign-up</li>
            <li>Generating an image thumbnail after upload</li>
            <li>Payment processing with automatic retry</li>
            <li>Indexing content for a search engine</li>
            <li>Push notifications to mobile devices</li>
          </ul>
          <p><strong>Tools and tradeoffs:</strong></p>
          <ul>
            <li><code>RabbitMQ:</code> AMQP, delivery guarantees (at-least-once), complex routing via exchange/binding. Ideal for workloads that need delivery guarantees.</li>
            <li><code>Apache Kafka:</code> distributed log, persistent message retention, replay capability, very high throughput (millions of msg/s). Ideal for event streaming, auditing, multiple independent consumers.</li>
            <li><code>Amazon SQS:</code> managed, zero ops, SQS Standard (at-least-once, unordered) or FIFO (exactly-once, ordered). Ideal if you want simplicity on AWS.</li>
          </ul>
          <p>The producer-consumer pattern decouples services, absorbs traffic spikes (the producer can be much faster than the consumer for short periods) and enables automatic retry when a worker fails.</p>
        </div>
      </div>

      <!-- 7. Networking Metrics -->
      <div class="acc-item" id="acc-networking">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Networking Metrics</span>
            <span class="badge badge-blue">metrics</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p>Three fundamental metrics to understand and size the network capacity of a distributed system:</p>
          <div class="metric-grid" style="margin-top:12px;">
            <div class="metric-card">
              <div class="metric-label">Bandwidth</div>
              <div class="metric-val" style="color:var(--blue);">cap.</div>
              <div class="metric-desc">Theoretical maximum capacity of the channel in bits/second. It is the ceiling — the most the link can carry.</div>
            </div>
            <div class="metric-card">
              <div class="metric-val" style="color:var(--accent);">real</div>
              <div class="metric-label">Throughput</div>
              <div class="metric-desc">Actual rate of successful transfer. Always ≤ bandwidth. Reduced by congestion, retransmissions and overhead.</div>
            </div>
            <div class="metric-card">
              <div class="metric-val" style="color:var(--coral);">RTT</div>
              <div class="metric-label">Latency</div>
              <div class="metric-desc">Time for a packet to go from A to B (one-way) or A→B→A (Round-Trip Time). Made up of propagation + transmission + processing + queuing delay.</div>
            </div>
          </div>
          <p><strong>Components of latency:</strong></p>
          <ul>
            <li><code>Propagation delay:</code> speed of light × distance. São Paulo → New York ≈ 100ms minimum.</li>
            <li><code>Transmission delay:</code> packet size ÷ bandwidth. A 1GB file over a 100Mbps link takes ~80 seconds.</li>
            <li><code>Processing delay:</code> time routers take to process the header and decide the next hop.</li>
            <li><code>Queuing delay:</code> time spent waiting in the buffers of congested routers. Variable and unpredictable.</li>
          </ul>
          <p><strong>Rule of thumb:</strong> optimizing throughput (batching, compression) can increase latency. Optimizing latency (smaller requests, persistent connections) can reduce throughput. Understand which one is more critical for your system before optimizing.</p>
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
          <p>A programming paradigm for processing large datasets in parallel on a cluster. The programmer only defines the Map and Reduce functions; the framework takes care of distribution, parallelism, fault tolerance and the shuffle.</p>
          <p><strong>The flow of the two phases:</strong></p>
          <ul>
            <li><strong>Map:</strong> each worker reads a chunk of the input data and emits <code>(key, value)</code> pairs. E.g.: for word count, each line → emits <code>(word, 1)</code> for every word found.</li>
            <li><strong>Shuffle &amp; Sort:</strong> the framework automatically groups all values emitted for the same key and sends them to the same reducer.</li>
            <li><strong>Reduce:</strong> the reducer receives <code>(key, [v1, v2, v3, ...])</code> and produces the final result. E.g.: <code>(word, [1,1,1]) → (word, 3)</code>.</li>
          </ul>
          <p><strong>The framework takes care of:</strong> distributing data among workers, parallel execution, automatic re-execution of failed tasks (fault tolerance), shuffle/sort between Map and Reduce, and monitoring.</p>
          <p><strong>Implementations:</strong> Hadoop MapReduce (batch, disk I/O — robust but slow), Apache Spark (in-memory — 10-100x faster for iterative algorithms such as ML, streaming via Spark Streaming).</p>
          <p><strong>When NOT to use it:</strong> real-time queries with low-latency requirements, ACID transactions that need strong consistency, caching systems or simple lookups. MapReduce is for batch processing of large volumes.</p>
          <pre># Pseudocode — Word Count in MapReduce
def map(document_id, text):
    for word in text.split():
        emit(word, 1)           # emits (key, value)

def reduce(word, counts):       # receives (key, [v1, v2, ...])
    emit(word, sum(counts))     # aggregates and emits the final result</pre>
        </div>
      </div>

      <!-- 9. Consistent Hashing -->
      <div class="acc-item" id="acc-consistent">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Consistent Hashing</span>
            <span class="badge badge-amber">data</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p><strong>The problem:</strong> with <code>shard = hash(key) % N</code>, changing N (adding a node or losing one) remaps almost every key. In a distributed cache this amounts to emptying the whole cache at once — and all traffic falls on the database.</p>
          <p><strong>The solution:</strong> nodes and keys are placed on a hash ring (e.g. 0 … 2³²−1). Each key belongs to the first node found going clockwise. When a node is added or removed, only the keys in the neighboring range change owner — on average <code>K/N</code> keys.</p>
          <ul>
            <li><strong>Virtual nodes:</strong> each physical node takes several positions on the ring, which evens out the distribution and lets you give more weight to bigger machines.</li>
            <li><strong>Replication:</strong> the key is also stored on the next R−1 nodes of the ring (the Dynamo and Cassandra model).</li>
            <li><strong>Where it shows up:</strong> Cassandra, DynamoDB, Riak, Memcached clients (ketama), Nginx (<code>hash $request_uri consistent;</code>).</li>
          </ul>
        </div>
      </div>

      <!-- 10. Replication & Consistency -->
      <div class="acc-item" id="acc-replication">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Replication &amp; Consistency Models</span>
            <span class="badge badge-amber">data</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p>Replicating data increases availability and read capacity, but forces you to choose <strong>what the client may see</strong> while the replicas converge.</p>
          <p><strong>Topologies:</strong></p>
          <ul>
            <li><strong>Leader-follower (primary-replica):</strong> writes go to the leader, reads scale out on the replicas. With asynchronous replication there is <em>replication lag</em> — a read on a replica may return stale data.</li>
            <li><strong>Multi-leader:</strong> writes accepted in several regions. Requires conflict resolution (last-write-wins, CRDTs, merge in the application).</li>
            <li><strong>Leaderless (quorum):</strong> N replicas; a write is acknowledged by W and a read queries R. If <code>R + W &gt; N</code>, every read hits at least one replica with the latest acknowledged write. E.g.: N=3, W=2, R=2.</li>
          </ul>
          <p><strong>Consistency models (strongest to weakest):</strong> linearizability (strong) → read-your-writes → monotonic reads → eventual consistency.</p>
          <p><strong>Practical trick:</strong> to guarantee read-your-writes without global strong consistency, read from the leader for a few seconds after the user's own write (e.g. after editing their profile).</p>
          <p class="acc-link">In the course: <a href="../classes/distributed_systems/cap/">CAP Theorem</a> · <a href="../classes/distributed_systems/consensus/">Consensus &amp; Algorithms</a></p>
        </div>
      </div>

      <!-- 11. CDN -->
      <div class="acc-item" id="acc-cdn">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">CDN &amp; Edge</span>
            <span class="badge badge-blue">infrastructure</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p>A CDN (Content Delivery Network) is a network of edge servers that keep copies of content close to the user. It reduces latency (the RTT to the edge is much smaller than to the origin) and takes load off the origin.</p>
          <ul>
            <li><strong>Pull CDN:</strong> the edge fetches from the origin on the first access (cache miss) and stores it according to <code>Cache-Control</code>/TTL. Simple, the default in most cases.</li>
            <li><strong>Push CDN:</strong> you publish the content to the CDN explicitly. Useful for large, rarely changing files.</li>
            <li><strong>Invalidation:</strong> prefer versioning the file name (<code>app.3f9a1c.js</code>) over invalidating the cache — invalidation is slow and expensive.</li>
            <li><strong>Beyond static files:</strong> TLS termination, DDoS/WAF protection, edge compute and caching of dynamic responses with a short TTL.</li>
          </ul>
          <p><strong>Examples:</strong> Amazon CloudFront, Cloudflare, Akamai, Fastly.</p>
        </div>
      </div>

      <!-- 12. Rate Limiting -->
      <div class="acc-item" id="acc-ratelimit">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Rate Limiting</span>
            <span class="badge badge-coral">resilience</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p>Limits how many requests a client (user, API key, IP) can make within a time window. It protects against abuse and accidental spikes, ensures fair use and controls cost. The standard response is <code>HTTP 429 Too Many Requests</code> with a <code>Retry-After</code> header.</p>
          <p><strong>Algorithms:</strong></p>
          <ul>
            <li><code>Token bucket:</code> tokens are refilled at a fixed rate; each request consumes one. Allows bursts up to the bucket size. The most common choice for APIs.</li>
            <li><code>Leaky bucket:</code> requests enter a queue that is drained at a constant rate. Smooths traffic (it is the model behind Nginx's <code>limit_req</code>).</li>
            <li><code>Fixed window counter:</code> one counter per window (e.g. per minute). Simple, but allows up to 2× the limit at the window boundary.</li>
            <li><code>Sliding window (log or counter):</code> more accurate than the fixed window, at a higher memory/computation cost.</li>
          </ul>
          <p><strong>Distributed:</strong> with several gateway replicas, the counter must be shared — typically Redis (<code>INCR</code> + <code>EXPIRE</code>, or a Lua script for atomicity). Also decide what happens if Redis goes down: <em>fail-open</em> (let traffic through) or <em>fail-closed</em> (block it).</p>
          <p class="acc-link">In the course: <a href="../hands-on/2/">Hands-on 2 — Gateway</a> · <a href="../hands-on/8/">Hands-on 8 — In-Memory Cache</a></p>
        </div>
      </div>

      <!-- 13. API Gateway & Microservices -->
      <div class="acc-item" id="acc-gateway">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">API Gateway &amp; Microservices</span>
            <span class="badge badge-green">architecture</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p><strong>API Gateway:</strong> the single entry point of the system. It concentrates cross-cutting concerns — routing, authentication (JWT validation), rate limiting, TLS, CORS, response aggregation — so internal services don't have to repeat them.</p>
          <ul>
            <li><strong>Communication:</strong> synchronous (REST/gRPC) when the client needs the answer now; asynchronous (events on a queue) when the work can happen later.</li>
            <li><strong>Database per service:</strong> each service owns its data. Consistency across services via <em>Saga</em> (orchestrated or choreographed) and the <em>Outbox pattern</em> to publish events reliably.</li>
            <li><strong>Service discovery:</strong> the orchestrator's DNS (Kubernetes Services) or a registry (Eureka, Consul).</li>
          </ul>
          <p><strong>A tradeoff that impresses in interviews:</strong> knowing when <em>not</em> to use microservices. Small team and a still-unstable domain → start with a modular monolith and extract services when there is a concrete reason (independent scaling, independent deploys, separate teams).</p>
          <p class="acc-link">In the course: <a href="../classes/microservices/architecture/">Microservices — Architecture &amp; Components</a> · <a href="../hands-on/2/">Hands-on 2 — Gateway</a> · <a href="../hands-on/3/">Hands-on 3 — Security</a></p>
        </div>
      </div>

      <!-- 14. Resilience Patterns -->
      <div class="acc-item" id="acc-resilience">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Resilience Patterns</span>
            <span class="badge badge-coral">resilience</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p>In distributed systems, partial failures are the rule. These patterns keep the failure of one dependency from bringing down the whole system (cascading failure).</p>
          <ul>
            <li><code>Timeout:</code> every remote call needs one. Without a timeout, a slow dependency exhausts the threads of its callers.</li>
            <li><code>Retry with exponential backoff + jitter:</code> only for transient errors and idempotent operations. Jitter keeps all clients from retrying at the same time (thundering herd).</li>
            <li><code>Circuit breaker:</code> closed → open (fails fast, without calling the dependency) → half-open (tests whether it is back).</li>
            <li><code>Bulkhead:</code> resource pools isolated per dependency, so that one cannot consume all the connections.</li>
            <li><code>Idempotency key:</code> the client sends a unique identifier; the server deduplicates repetitions of the same operation.</li>
            <li><code>Fallback / graceful degradation:</code> a degraded response (cache, default value) instead of an error.</li>
            <li><code>Load shedding:</code> reject part of the traffic early when saturated, instead of degrading every request.</li>
          </ul>
          <p class="acc-link">In the course: <a href="../classes/reliability/patterns/">Resilience Patterns</a> · <a href="../classes/reliability/chaos/">Chaos Engineering</a></p>
        </div>
      </div>

      <!-- 15. Observability & SLOs -->
      <div class="acc-item" id="acc-observability">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Observability &amp; SLOs</span>
            <span class="badge badge-blue">metrics</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <p>Designing the system is not enough: you need to know <strong>when</strong> and <strong>where</strong> it is failing. Bringing up observability at the end of the interview shows production maturity.</p>
          <ul>
            <li><strong>Logs:</strong> what happened, event by event. Structured (JSON) and with a trace id.</li>
            <li><strong>Metrics:</strong> how much and how often. The <em>RED</em> method for services (Rate, Errors, Duration) and <em>USE</em> for resources (Utilization, Saturation, Errors).</li>
            <li><strong>Traces:</strong> where the time was spent in a request that crosses several services.</li>
          </ul>
          <p><strong>SLI / SLO / SLA:</strong> the SLI is the measurement (e.g. % of requests with latency &lt; 300 ms); the SLO is the internal target (e.g. 99.9% over 28 days); the SLA is the contract with the customer, with a penalty. The <em>error budget</em> (1 − SLO) defines how much risk you can spend on deploys and experiments.</p>
          <p><strong>Use percentiles, not averages:</strong> p50, p95 and p99. The average hides the tail — and the tail is where the unhappy users are.</p>
          <p class="acc-link">In the course: <a href="../classes/observability/">Observability</a> · <a href="../classes/reliability/sli-slo-sla/">SLI / SLO / SLA</a> · <a href="../hands-on/6/">Hands-on 6</a> · <a href="../hands-on/10/">Hands-on 10</a></p>
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
      <h2>Worked Example: URL Shortener</h2>
      <p>The 5 steps applied to the system in the diagram above — the outline of a ~45-minute answer.</p>
    </div>

    <div class="step-list">
      <div class="step-item">
        <div class="step-num amber">1</div>
        <div class="step-body">
          <strong>Scope the Problem</strong>
          <span>Functional: shorten a long URL, redirect the short code to the original URL, custom alias and expiration (optional), click counting. Out of scope: user accounts and link editing. Non-functional: low-latency redirect (p99 &lt; 100 ms), high availability and codes that are not trivial to guess.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num amber">2</div>
        <div class="step-body">
          <strong>Make Reasonable Assumptions</strong>
          <span>100M new URLs/month → ~40 writes/s. A 100:1 read:write ratio → ~4,000 redirects/s on average (peak ~10k/s). Storage over 5 years: 6B records × ~500 B ≈ 3 TB. Cache: ~350M redirects/day; keeping the 20% most accessed ≈ 35 GB of RAM — fits in a small Redis cluster.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num amber">3</div>
        <div class="step-body">
          <strong>Draw the Major Components</strong>
          <span>API: <code>POST /api/v1/urls {longUrl, alias?, expiresAt?}</code> → <code>201 {shortUrl}</code> and <code>GET /{code}</code> → <code>301/302 Location: longUrl</code>. Model: <code>urls(code PK, long_url, created_at, expires_at)</code>. Components: load balancer → stateless app servers → database.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num amber">4</div>
        <div class="step-body">
          <strong>Identify the Key Issues</strong>
          <span>(a) Generating unique codes without collisions and without expensive coordination between servers. (b) The database takes all the read traffic. (c) Counting clicks synchronously would slow down the redirect.</span>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num amber">5</div>
        <div class="step-body">
          <strong>Redesign for the Key Issues</strong>
          <span>Cache-aside in Redis for the hot codes; read replicas on the database; sharding by hash of the <code>code</code> only if the volume requires it. Each click becomes an event on a queue (Kafka/SQS) consumed by workers that write to the analytics database — the redirect does not wait for it.</span>
        </div>
      </div>
    </div>

    <h3 class="sub-h">How to generate the short code?</h3>
    <div class="card-grid-3">
      <div class="card border-green">
        <div class="card-label green">Option A</div>
        <h3>Hash + truncate</h3>
        <p>Hash (MD5/SHA-256) of the URL, first 7 characters in base62. Deterministic: the same URL produces the same code. <strong>Con:</strong> collisions must be detected and resolved (re-hash with a salt).</p>
      </div>
      <div class="card border-blue">
        <div class="card-label blue">Option B</div>
        <h3>Counter + base62</h3>
        <p>A unique ID (sequence, Snowflake or ranges pre-allocated per server) converted to base62. No collisions. <strong>Con:</strong> sequential codes are predictable and allow links to be enumerated.</p>
      </div>
      <div class="card border-purple">
        <div class="card-label purple">Option C</div>
        <h3>Key Generation Service</h3>
        <p>A service pre-generates random keys and hands them out in batches to the app servers. No collisions on the request path, and unpredictable. <strong>Con:</strong> one more component to operate and replicate.</p>
      </div>
    </div>

    <pre># base62: 62^7 ≈ 3.5 trillion codes — plenty for 6B URLs
ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

def base62(n: int) -> str:
    s = ""
    while n > 0:
        n, r = divmod(n, 62)
        s = ALPHABET[r] + s
    return s or "0"</pre>

    <div class="itip">
      <div class="itip-label">Classic tradeoff: 301 or 302?</div>
      <p><strong>301 (Moved Permanently)</strong> is cached by the browser: less load on the server, but subsequent clicks no longer go through you — the count is incomplete.<br>
      <strong>302 (Found)</strong> always goes through the server: accurate analytics, but more traffic. There is no right answer — choose and justify it with the requirements from step 1.</p>
    </div>
  </section>

  <hr class="section-divider">

  <!-- ═══════════════════════════════════════════════
       SECTION — PRACTICE PROBLEMS
  ════════════════════════════════════════════════ -->
  <section class="section" id="sec-practice">
    <div class="section-header">
      <h2>Practice Problems</h2>
      <p>Classic interview questions. Try to solve them with the 5 steps before opening the key points.</p>
    </div>

    <div class="acc">

      <div class="acc-item">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Distributed Rate Limiter</span>
            <span class="badge badge-green">medium</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <ul>
            <li>Choice of algorithm (token bucket vs. sliding window) and its justification.</li>
            <li>State shared across gateway replicas (Redis) and atomicity (Lua script).</li>
            <li>Rules per client/endpoint, a <code>429</code> response with <code>Retry-After</code>.</li>
            <li>Fail-open vs. fail-closed if the counter storage goes down.</li>
          </ul>
        </div>
      </div>

      <div class="acc-item">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">News Feed (Twitter / Instagram)</span>
            <span class="badge badge-amber">hard</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <ul>
            <li><strong>Fan-out on write</strong> (push to pre-computed timelines) vs. <strong>fan-out on read</strong> (build the timeline at read time).</li>
            <li>Hybrid model: push for regular users, pull for celebrities with millions of followers.</li>
            <li>Timeline in cache (a list of IDs in Redis), media in object storage + CDN.</li>
            <li>Cursor-based pagination, not offset-based.</li>
          </ul>
        </div>
      </div>

      <div class="acc-item">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Chat (WhatsApp / Slack)</span>
            <span class="badge badge-amber">hard</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <ul>
            <li>Persistent connections (WebSocket) and a service that knows which server each user is connected to.</li>
            <li>Per-conversation ordering (a sequence number per <code>conversation_id</code>) — global ordering is not needed.</li>
            <li>Delivery to offline users (store-and-forward) and delivery/read receipts.</li>
            <li>Partitioning the message storage by conversation (e.g. Cassandra).</li>
          </ul>
        </div>
      </div>

      <div class="acc-item">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Notification System</span>
            <span class="badge badge-green">medium</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <ul>
            <li>Multiple channels (push, e-mail, SMS) with separate queues and workers per channel.</li>
            <li>Retries with backoff and idempotency so nobody is notified twice.</li>
            <li>User preferences and opt-out, per-user rate limit, templates.</li>
            <li>Integration with external providers (APNs, FCM, SES, Twilio) and what to do when they fail.</li>
          </ul>
        </div>
      </div>

      <div class="acc-item">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Web Crawler</span>
            <span class="badge badge-green">medium</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <ul>
            <li>URL frontier: a prioritized queue partitioned by domain.</li>
            <li>Politeness: respect <code>robots.txt</code> and limit requests per domain.</li>
            <li>Deduplication: a Bloom filter for URLs already seen, a content hash for duplicate pages.</li>
            <li>DNS cache, distributed page storage, spider-trap detection.</li>
          </ul>
        </div>
      </div>

      <div class="acc-item">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Ride Sharing (Uber / 99)</span>
            <span class="badge badge-amber">hard</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <ul>
            <li>Frequent location updates (every few seconds) — a write-heavy system.</li>
            <li>Geospatial index: geohash, quadtree or H3 for "nearby drivers".</li>
            <li>Matching that guarantees a driver is never assigned to two rides (lock/strong consistency at that point).</li>
            <li>Surge pricing, ETA and partitioning by region/city.</li>
          </ul>
        </div>
      </div>

      <div class="acc-item">
        <button class="acc-header" type="button" aria-expanded="false">
          <div class="acc-title-wrap">
            <span class="acc-title">Distributed Key-Value Store</span>
            <span class="badge badge-coral">advanced</span>
          </div>
          <span class="acc-arrow">▶</span>
        </button>
        <div class="acc-body">
          <ul>
            <li>Partitioning with consistent hashing and virtual nodes.</li>
            <li>Replication with a configurable quorum (N, R, W) and the consistency × latency tradeoff.</li>
            <li>Failure detection (gossip), hinted handoff and anti-entropy (Merkle trees).</li>
            <li>Conflict resolution: vector clocks or last-write-wins.</li>
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
      <h2>Connection to the Course</h2>
      <p>Where each interview concept appears in the 2026.2 classes and hands-ons.</p>
    </div>

    <div class="callout">
      <p>The hands-ons build, piece by piece, the same architecture as the diagram: <strong>gateway → load balancer → stateless services → cache → database → queue → observability</strong>. Use your project as a concrete example in the interview: <em>"in my project, I put a shared Redis behind the gateway because each replica had an inconsistent local cache..."</em></p>
    </div>

    <div class="card-grid-3">
      <a class="card border-amber" href="../classes/distributed_systems/">
        <div class="card-label amber">Class 1</div>
        <h3>Distributed Systems</h3>
        <p>CAP theorem, consistency and consensus algorithms.</p>
      </a>
      <a class="card border-green" href="../hands-on/2/">
        <div class="card-label green">Hands-on 2</div>
        <h3>Gateway</h3>
        <p>Single entry point, routing and the natural place for rate limiting.</p>
      </a>
      <a class="card border-blue" href="../hands-on/7/">
        <div class="card-label blue">Hands-on 7</div>
        <h3>Load Balancer</h3>
        <p>Nginx distributing traffic across replicas — horizontal scaling in practice.</p>
      </a>
      <a class="card border-purple" href="../hands-on/8/">
        <div class="card-label purple">Hands-on 8</div>
        <h3>In-Memory Cache</h3>
        <p>Redis shared across replicas, cache-aside and TTL.</p>
      </a>
      <a class="card border-green" href="../hands-on/9/">
        <div class="card-label green">Hands-on 9</div>
        <h3>Kafka Messaging</h3>
        <p>Event-driven asynchronous processing and decoupling between services.</p>
      </a>
      <a class="card border-coral" href="../classes/reliability/">
        <div class="card-label coral">Class 8</div>
        <h3>Reliability</h3>
        <p>SLI/SLO/SLA, resilience patterns and chaos engineering.</p>
      </a>
      <a class="card border-blue" href="../hands-on/6/">
        <div class="card-label blue">Hands-on 6</div>
        <h3>Observability</h3>
        <p>Metrics with Prometheus and dashboards in Grafana.</p>
      </a>
      <a class="card border-blue" href="../hands-on/10/">
        <div class="card-label blue">Hands-on 10</div>
        <h3>Distributed Tracing</h3>
        <p>OpenTelemetry + Jaeger: where a request's time was spent.</p>
      </a>
      <a class="card border-amber" href="../exercises/bottlenecks/">
        <div class="card-label amber">Exercise</div>
        <h3>Bottlenecks</h3>
        <p>Identify and mitigate bottlenecks — step 4 of the design outline.</p>
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
      <p>Test your knowledge with questions in the style of a real interview.</p>
    </div>

    <div class="quiz-section">
      <div class="quiz-progress"><div class="quiz-progress-fill" id="iv-qpf" style="width:10%"></div></div>
      <div class="quiz-num" id="iv-qnum">Question 1</div>
      <div class="quiz-q" id="iv-qtext"></div>
      <div class="quiz-opts" id="iv-qopts"></div>
      <div id="iv-qfb"></div>
      <div class="quiz-nav">
        <button type="button" data-iv-prev>← previous</button>
        <span class="quiz-score" id="iv-qscore"></span>
        <button type="button" data-iv-next>next →</button>
      </div>
    </div>
    <button type="button" class="btn-ghost" data-iv-quiz-reset>↺ restart quiz</button>
  </section>

  <hr class="section-divider">

  <!-- ═══════════════════════════════════════════════
       SECTION — CHECKLIST
  ════════════════════════════════════════════════ -->
  <section class="section" id="sec-checklist">
    <div class="section-header">
      <h2>Interview Checklist</h2>
      <p>Use it to assess your preparation before a System Design interview. Tick the items as you practice — your progress is saved in this browser.</p>
    </div>

    <div class="check-progress" id="iv-check-progress"></div>
    <div class="checklist" id="iv-checklist"></div>
    <button type="button" class="btn-ghost" data-iv-check-reset>↺ reset checklist</button>
  </section>

  <hr class="section-divider">

  <!-- ═══════════════════════════════════════════════
       SECTION — REFERÊNCIAS
  ════════════════════════════════════════════════ -->
  <section class="section" id="sec-refs">
    <div class="section-header">
      <h2>References</h2>
      <p>Essential resources to go further — organized by type and relevance to technical interviews.</p>
    </div>

    <h3 class="sub-h">Books</h3>
    <div class="refs-grid">
      <a class="ref-card" href="https://www.crackingthecodinginterview.com/" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--accent);">Book — main reference</div>
        <div class="ref-title">Cracking the Coding Interview (6th ed.)</div>
        <div class="ref-desc">Gayle Laakmann McDowell. Chapter 9 is dedicated to System Design and Scalability. The main source for the content of this page.</div>
        <div class="ref-url">crackingthecodinginterview.com</div>
      </a>
      <a class="ref-card" href="https://www.oreilly.com/library/view/designing-data-intensive-applications/9781491903063/" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--blue);">Book — advanced reference</div>
        <div class="ref-title">Designing Data-Intensive Applications</div>
        <div class="ref-desc">Martin Kleppmann (O'Reilly). The best book on distributed systems: replication, partitioning, transactions, stream processing. Required reading.</div>
        <div class="ref-url">oreilly.com — ISBN 978-1491903063</div>
      </a>
      <a class="ref-card" href="https://www.amazon.com/System-Design-Interview-insiders-Second/dp/B08CMF2CQF" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--purple);">Book — interview prep</div>
        <div class="ref-title">System Design Interview (Vol. 1 &amp; 2)</div>
        <div class="ref-desc">Alex Xu. Practical design cases of real systems (URL shortener, Twitter, YouTube, Uber). Excellent for practicing the interview format.</div>
        <div class="ref-url">amazon.com — Alex Xu</div>
      </a>
      <a class="ref-card" href="https://www.amazon.com/Clean-Architecture-Craftsmans-Software-Structure/dp/0134494164" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--amber);">Book — software architecture</div>
        <div class="ref-title">Clean Architecture</div>
        <div class="ref-desc">Robert C. Martin (Uncle Bob). Software design principles that connect directly to the architectural decisions in system design interviews.</div>
        <div class="ref-url">amazon.com — Robert C. Martin</div>
      </a>
    </div>

    <h3 class="sub-h">Free Online Resources</h3>
    <div class="refs-grid">
      <a class="ref-card" href="https://github.com/donnemartin/system-design-primer" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--accent);">GitHub — essential repository</div>
        <div class="ref-title">System Design Primer</div>
        <div class="ref-desc">Donnemartin. The most complete free repository on system design. Includes flashcards, full examples, diagrams and a structured study guide. More than 280k stars on GitHub.</div>
        <div class="ref-url">github.com/donnemartin/system-design-primer</div>
      </a>
      <a class="ref-card" href="https://highscalability.com/" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--blue);">Blog — real cases</div>
        <div class="ref-title">High Scalability</div>
        <div class="ref-desc">A blog about how large systems (Twitter, Netflix, Amazon, Instagram) were built and scaled. Each post is a real architecture case study.</div>
        <div class="ref-url">highscalability.com</div>
      </a>
      <a class="ref-card" href="https://www.youtube.com/@ByteByteGo" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--purple);">YouTube — videos</div>
        <div class="ref-title">ByteByteGo (Alex Xu)</div>
        <div class="ref-desc">A YouTube channel with animations and visual explanations of system design. Excellent for seeing how the components connect. Complements the System Design Interview book.</div>
        <div class="ref-url">youtube.com/@ByteByteGo</div>
      </a>
      <a class="ref-card" href="https://www.educative.io/courses/grokking-modern-system-design-interview-for-engineers-managers" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--amber);">Interactive course</div>
        <div class="ref-title">Grokking Modern System Design Interview</div>
        <div class="ref-desc">Educative.io. A structured course with practice problems and step-by-step solutions. Covers the design of systems such as TinyURL, Instagram, Netflix and Uber.</div>
        <div class="ref-url">educative.io</div>
      </a>
      <a class="ref-card" href="https://www.geeksforgeeks.org/system-design-tutorial/" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--coral);">Tutorial</div>
        <div class="ref-title">GeeksforGeeks — System Design Tutorial</div>
        <div class="ref-desc">A complete tutorial with an article for each concept: load balancing, caching, sharding, CAP theorem, consistent hashing, SQL vs NoSQL and more.</div>
        <div class="ref-url">geeksforgeeks.org/system-design-tutorial</div>
      </a>
      <a class="ref-card" href="https://leetcode.com/discuss/interview-question/system-design" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--accent);">Practice</div>
        <div class="ref-title">LeetCode — System Design Discussions</div>
        <div class="ref-desc">LeetCode forum with discussions of real system design questions asked in interviews at major tech companies (FAANG, high-growth startups).</div>
        <div class="ref-url">leetcode.com/discuss/system-design</div>
      </a>
      <a class="ref-card" href="https://sre.google/books/" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--blue);">Online book — free</div>
        <div class="ref-title">Site Reliability Engineering (Google)</div>
        <div class="ref-desc">Google's SRE books, available for free. The reference for SLOs, error budgets, monitoring and incident response — the "running in production" side of system design.</div>
        <div class="ref-url">sre.google/books</div>
      </a>
    </div>

    <h3 class="sub-h">Technical Articles &amp; Papers</h3>
    <div class="refs-grid">
      <a class="ref-card" href="https://static.googleusercontent.com/media/research.google.com/en//archive/mapreduce-osdi04.pdf" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--blue);">Paper — Google</div>
        <div class="ref-title">MapReduce: Simplified Data Processing on Large Clusters</div>
        <div class="ref-desc">Dean &amp; Ghemawat, OSDI 2004. The original MapReduce paper. Essential reading to understand the programming model, use cases and the reference implementation.</div>
        <div class="ref-url">research.google.com — OSDI 2004</div>
      </a>
      <a class="ref-card" href="https://www.allthingsdistributed.com/2007/10/amazons_dynamo.html" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--amber);">Paper — Amazon</div>
        <div class="ref-title">Dynamo: Amazon's Highly Available Key-Value Store</div>
        <div class="ref-desc">DeCandia et al., SOSP 2007. The paper that brought consistent hashing, eventual consistency and the CAP theorem into practice. The conceptual foundation of Cassandra, DynamoDB and Riak.</div>
        <div class="ref-url">allthingsdistributed.com — SOSP 2007</div>
      </a>
      <a class="ref-card" href="https://engineering.fb.com/category/core-data/" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--purple);">Engineering blog</div>
        <div class="ref-title">Meta Engineering Blog</div>
        <div class="ref-desc">Technical articles on how Facebook/Meta scales its systems: TAO (distributed data store), Cassandra, cache hierarchy, Haystack (object storage) and more. Real cases at the scale of billions.</div>
        <div class="ref-url">engineering.fb.com</div>
      </a>
      <a class="ref-card" href="https://netflixtechblog.com/" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--coral);">Engineering blog</div>
        <div class="ref-title">Netflix Tech Blog</div>
        <div class="ref-desc">How Netflix solves scaling problems: microservices, chaos engineering (Chaos Monkey), global CDN, video encoding, ML-based recommendations. A reference for high-availability systems.</div>
        <div class="ref-url">netflixtechblog.com</div>
      </a>
      <a class="ref-card" href="https://gist.github.com/jboner/2841832" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--accent);">Quick reference</div>
        <div class="ref-title">Latency Numbers Every Programmer Should Know</div>
        <div class="ref-desc">The classic latency table popularized by Jeff Dean and Peter Norvig — the basis for the back-of-the-envelope estimates on this page.</div>
        <div class="ref-url">gist.github.com/jboner/2841832</div>
      </a>
    </div>

    <h3 class="sub-h">Tools to Practice</h3>
    <div class="refs-grid">
      <a class="ref-card" href="https://www.pramp.com/" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--accent);">Peer practice</div>
        <div class="ref-title">Pramp</div>
        <div class="ref-desc">A free platform to practice technical interviews with other candidates. Includes system design sessions with structured feedback. Excellent for simulating a real interview setting.</div>
        <div class="ref-url">pramp.com</div>
      </a>
      <a class="ref-card" href="https://interviewing.io/" target="_blank" rel="noopener">
        <div class="ref-type" style="color:var(--blue);">Mock interviews</div>
        <div class="ref-title">interviewing.io</div>
        <div class="ref-desc">Mock interviews with engineers from companies such as Google, Facebook and Amazon. Lets you practice system design and algorithms with feedback from experienced interviewers.</div>
        <div class="ref-url">interviewing.io</div>
      </a>
    </div>
  </section>

  <hr class="section-divider">

  <footer class="site-footer">
    <span>Coding Interview Prep · System Design &amp; Scalability</span>
    <span>Study material — educational use</span>
  </footer>

</div>
