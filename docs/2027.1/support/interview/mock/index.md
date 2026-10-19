# Mock interviews

System design is a spoken exam, and the only way to get good at a spoken exam is to speak. This page is a protocol for **mock interviews in pairs**: one student is the candidate, the other the interviewer, and you swap. Being the interviewer is not a favor to your classmate: listening to a design with the rubric in hand is the fastest way to learn what a strong answer sounds like.

!!! abstract "What you need"
    - Two people (three if you add an observer), 60 minutes: 45 for the interview, 10 for feedback, 5 to swap.
    - A problem from the [practice problems](../problems/index.md) and, for the interviewer, the matching case study.
    - A whiteboard, paper, or an online canvas ([Excalidraw](https://excalidraw.com) or the [playground](../../../../playground/index.md) in full mode).
    - A timer and a printed or copied [score sheet](#score-sheet).

## Roles

| Role | Job | Must not |
|---|---|---|
| **Candidate** | Drive the session: clarify, estimate, design, go deep, discuss trade-offs, wrap up — out loud | Wait to be told what to do; go silent for more than a minute |
| **Interviewer** | Give the prompt, answer clarifying questions with realistic numbers, push with follow-ups, keep time, take notes for the rubric | Lecture, give the answer, or accept "it scales" without asking how |
| **Observer** (optional) | Keep time per phase, note exact phrases (good and bad), watch communication | Interrupt |

!!! tip "Interviewer: you can say 'I don't know, you decide'"
    Real interviewers often leave choices to the candidate. If you are asked something the problem does not define, answer "what would you assume?" — then judge whether the assumption is reasonable and stated.

## Before the session

1. **Pick a problem** of the right level from the [problem list](../problems/index.md): warm-up for the first sessions, medium after the course's first half, hard and advanced near the end. Don't tell the candidate in advance.
2. **Interviewer prepares** (10 minutes): read the matching case study (for example the [ticketing case study](../../../classes/case-studies/ticketing/index.md) for the BoxOffice flash sale), decide the numbers you will give when asked (users, peak, read/write ratio, data sizes), and choose **two deep dives** and **three follow-ups** from the lists below.
3. **Agree on the medium**: whiteboard, paper or online canvas. If you use the playground, start from the `blank` scenario.
4. **Set the timer** with the phase marks of the script below.

## The 45-minute script

| Phase | Minutes | Clock |
|---|---|---|
| 1. Clarify the requirements | 5 | 0–5 |
| 2. Estimate | 5 | 5–10 |
| 3. API and data model | 5 | 10–15 |
| 4. High-level design | 10 | 15–25 |
| 5. Deep dives | 12 | 25–37 |
| 6. Bottlenecks and trade-offs | 5 | 37–42 |
| 7. Wrap-up | 3 | 42–45 |

The phases follow the [framework](../framework/index.md). The interviewer keeps the clock: if the candidate is still clarifying at minute 8, say so ("let's move to the design in a minute").

### 1. Clarify the requirements (0–5 min)

**Interviewer says:** the prompt in one sentence, nothing else. "Design a ticketing site for a stadium show. Tickets go on sale Saturday at 10:00."

**If the candidate is stuck:** "Who are the users and what do they do?" · "What would make this system fail in the news?"

**Answers to have ready** (BoxOffice flash sale): 60,000 seats, about 2 million fans online at 10:00, seats are assigned (a seat map), a hold lasts 10 minutes while paying, no double booking ever, payment through an external provider, tickets by email.

| Green flags | Red flags |
|---|---|
| Separates functional from non-functional requirements | Starts drawing in the first minute |
| Asks about scale, peak, consistency and what must never go wrong | Asks only about features |
| Writes a short list on the board and states what is out of scope | Tries to cover every possible feature |

### 2. Estimate (5–10 min)

**Interviewer says:** "Roughly what load are we talking about?" (only if the candidate doesn't start on their own).

**Push with:** "Which of these numbers changes your design?" · "What is the peak, not the average?"

| Green flags | Red flags |
|---|---|
| Users → requests per second, average and peak; reads vs writes | Exact arithmetic that eats five minutes |
| Finds the number that matters (33 fans per seat; contention on few rows) | Numbers that are never used again |
| Rounds aggressively and says the assumptions out loud | Refuses to estimate ("it depends") |

### 3. API and data model (10–15 min)

**Interviewer says:** "What does the API look like for the main flow?"

**Push with:** "What happens if the client sends this request twice?" · "What is the key of this table, and which query uses it?"

| Green flags | Red flags |
|---|---|
| A few endpoints or events for the core flow, with an idempotency key where money or inventory is involved | A long list of CRUD endpoints for every entity |
| Entities with keys driven by access patterns | Choosing a database by brand before knowing the queries |

### 4. High-level design (15–25 min)

**Interviewer says:** "Walk me through the design."

**Push with:** "Follow one request from the fan's click to the database." · "What is stateless here, and where does the state live?"

| Green flags | Red flags |
|---|---|
| Clients → edge → services → storage, with async work behind a queue | Twenty boxes, no arrows labeled |
| Walks one read and one write through the diagram | Microservices for everything without a reason |
| Every box justified by a requirement or a number | Boxes that appear because "everybody has one" |

### 5. Deep dives (25–37 min)

**Interviewer says:** "Let's go deeper on…" — choose the hardest part of the problem, or ask the candidate "which part is the riskiest?" (a strong candidate names it).

**Deep dives to pick from:**

| Problem | Deep dive 1 | Deep dive 2 |
|---|---|---|
| BoxOffice flash sale | How exactly is a seat held without double booking? | How does the waiting room admit fans at a sustainable rate? |
| Chat | How does a message reach a user connected to another server? | Ordering and delivery to offline users |
| URL shortener | How are short codes generated without collisions? | How do redirects stay fast at 100 k req/s? |
| AI assistant | How is the answer grounded in BoxOffice's policies (RAG)? | How do you stop the agent from refunding the wrong order? |

| Green flags | Red flags |
|---|---|
| Precise mechanism (a conditional update, a lock, a partition key), not a buzzword | "We'd use Redis" without saying how |
| Mentions the failure cases of the mechanism | Defends the first idea after a valid objection |
| Uses numbers to size the component | Goes deep on an easy part (UI, CRUD) |

### 6. Bottlenecks and trade-offs (37–42 min)

**Interviewer says:** "What breaks first if traffic is 10× bigger?" or "What did you trade away?"

**Follow-ups to push** (pick three):

- Generic: "This dependency gets slow: what happens to the rest of the system?" · "A whole availability zone goes down." · "The cache is flushed at the worst moment." · "How would you know this is broken before users tell you?" · "What does this cost per month, roughly?"
- BoxOffice flash sale: "The payment provider starts timing out at 10:02." · "Bots open 500 k sessions." · "The event is moved to another date; 60 k fans must be notified."
- Chat: "A celebrity group has 100 k members." · "A user is on a train and keeps reconnecting."
- URL shortener: "One link goes viral: 1 M clicks per minute." · "Analytics must count unique visitors."
- AI assistant: "The model provider is down." · "A review on the event page contains a prompt injection." · "Cost per conversation doubled."

| Green flags | Red flags |
|---|---|
| Finds the bottleneck by comparing load and capacity | "Add more servers" as the answer to everything |
| Names trade-offs explicitly: "X over Y because…, the cost is…" | Claims the design has no weaknesses |
| Talks about timeouts, retries, idempotency, observability | Never mentions failure |

### 7. Wrap-up (42–45 min)

**Interviewer says:** "We're almost out of time. Summarize your design."

| Green flags | Red flags |
|---|---|
| Four or five sentences: the flow, the key decisions, the main trade-off, what's next | Starts adding new boxes |
| Lists what they'd do with more time (multi-region, cost, abuse, monitoring) | Runs over time |

!!! warning "Interviewer pitfalls"
    - **Helping too much.** If you explain the answer, you learn nothing about the candidate and the candidate learns nothing about being stuck. Give a hint as a question, at most one per phase.
    - **Rabbit holes.** If the candidate spends ten minutes on one detail, interrupt politely: "let's park that and look at the rest".
    - **Grading the answer, not the reasoning.** A different design from the case study can be excellent. Grade how well it meets the requirements and how well the trade-offs are argued.

## Feedback (10 min)

Feedback right after the interview, while both remember the details, is the most valuable part of the session.

1. **Candidate first** (2 min): "What went well? What would you do differently?"
2. **Interviewer** (6 min), using the rubric: **one strength** and **two improvements**, each tied to a specific moment ("at minute 20, when I asked about the payment timeout, you…"). Quote phrases.
3. **Agree on one thing** to practice in the next session (2 min).

!!! example "Specific feedback, not vague"
    Vague: "Your estimation was weak."
    Specific: "You estimated 2 M users but never turned it into requests per second at 10:00, so when you chose one PostgreSQL primary we couldn't tell whether it would hold. Next time, write the peak QPS on the board and point at it when you size each box."

## Scoring rubric

Score each dimension from 1 to 4; the signals describe what you should observe.

| Dimension | 1 · No hire | 2 · Lean no | 3 · Lean hire | 4 · Strong hire |
|---|---|---|---|---|
| **Requirements & scoping** | Starts designing with no questions | Asks about features only | Functional and non-functional requirements, scope stated | Finds what must never fail and the real shape of the load before drawing |
| **Estimation** | No numbers, or refuses | Numbers that are wrong by orders of magnitude or never used | Correct peak QPS, storage, read/write ratio | Uses the numbers to make decisions (sizing, choosing a store, spotting contention) |
| **API & data model** | Missing or incoherent | CRUD for every entity, no keys | Core endpoints and entities with keys | Idempotency, pagination, access patterns drive the schema |
| **High-level design** | Doesn't cover the requirements | Covers them with unexplained boxes | Clear, simple design; one read and one write walked through | Simple, justified, evolvable; knows what to leave out |
| **Deep dive & technical depth** | Buzzwords only | Knows the component names, not the mechanisms | Explains the mechanism of one hard part correctly | Explains mechanisms, their failure cases and alternatives, with numbers |
| **Trade-offs & bottlenecks** | "It scales" | Names trade-offs only when asked | Finds the main bottleneck and states trade-offs | Quantifies trade-offs and proposes how to measure and evolve |
| **Reliability & operability** | Never mentions failure | Mentions failure vaguely | Timeouts, retries, idempotency, redundancy where needed | Designs for failure end to end: degradation, observability, SLOs, testing (load, chaos) |
| **Communication & driving** | Silent or disorganized | Needs to be led step by step | Thinks out loud, follows a structure, checks in | Drives the session, manages time, adapts smoothly to hints and objections |

### Expectations by level

| Level | A "lean hire" usually looks like |
|---|---|
| **Intern / new grad** | Mostly 3s on requirements, estimation, high-level design and communication; 2s acceptable on depth and operability if the candidate reacts well to hints |
| **Mid-level** | 3s everywhere, at least one 4 (usually depth on one component); drives without being led |
| **Senior** | 4s on trade-offs, depth and operability; finds the hard part early; discusses cost, evolution and organizational impact |

## Score sheet { #score-sheet }

Copy this block into your notes for each session.

```text
MOCK INTERVIEW - SCORE SHEET
Date: ____________   Problem: ______________________________
Candidate: ____________________   Interviewer: ____________________

Phase timing (actual minute reached):
  clarify __  estimate __  API/data __  high-level __  deep dives __  trade-offs __  wrap-up __

Dimension                         1  2  3  4   Evidence (minute + what was said)
Requirements & scoping            [] [] [] []  ________________________________
Estimation                        [] [] [] []  ________________________________
API & data model                  [] [] [] []  ________________________________
High-level design                 [] [] [] []  ________________________________
Deep dive & technical depth       [] [] [] []  ________________________________
Trade-offs & bottlenecks          [] [] [] []  ________________________________
Reliability & operability         [] [] [] []  ________________________________
Communication & driving           [] [] [] []  ________________________________

One strength: ____________________________________________________
Two improvements: 1) _____________________________________________
                  2) _____________________________________________
Practice before next session: ____________________________________
```

## Variants

### 30-minute version

For class sessions or when time is short: clarify 3, estimate 3, high-level design 9, one deep dive 10, trade-offs and wrap-up 5. Skip the API phase unless the problem is about an API (rate limiter, API gateway).

### Online, with a canvas or the playground

Use [Excalidraw](https://excalidraw.com) for a free-form diagram, or the [playground](../../../../playground/index.md) in full mode starting from `blank`: the candidate builds the design with the course's palette while talking. The playground has a bonus: at the end, run a `load` or `spike` profile and see whether the design survives — then discuss what the report says.

### Chaos follow-up

After the wrap-up (or instead of the bottlenecks phase), the interviewer injects a failure in the candidate's playground design — a slow payment provider, an AZ outage, a cache flush, a hot key — and asks the candidate to diagnose it from the metrics and fix it in five minutes. It trains exactly the troubleshooting questions of the [quick diagnosis table](../index.md#sec-diagnosis).

!!! tip "Record yourself"
    With your partner's consent, record the audio of one session. Listening to yourself is uncomfortable and very effective: you will hear the long silences, the "basically", and the moments where you said "it scales" instead of a number.

## A class session in three rounds

For a 2-hour class with groups of three (A, B, C):

| Round | Minutes | Candidate | Interviewer | Observer | Problem level |
|---|---|---|---|---|---|
| 1 | 0–35 | A | B | C | Warm-up (30-min version + 5 min feedback) |
| 2 | 35–75 | B | C | A | Medium (30-min version + 10 min feedback) |
| 3 | 75–115 | C | A | B | Medium or hard (30-min version + 10 min feedback) |
| Debrief | 115–120 | everyone | | | Each group shares one lesson with the class |

Each interviewer chooses a different problem, so nobody sees their problem beforehand. Keep the score sheets: they are the best record of your progress and good material for the [behavioral stories](../behavioral/index.md).
