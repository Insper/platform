# Behavioral questions

Most system-design interview loops include a conversation about **what you have done**: "tell me about a technical decision you made", "tell me about something that failed". For an internship or a first job, the projects of this course are exactly the material these questions ask for. This page shows how to turn them into short, honest stories that show judgment — the same judgment the design interview is looking for.

## Why they appear in a system-design loop

A design interview shows how you reason about a hypothetical system in 45 minutes. A behavioral question checks whether you have reasoned that way **for real**: chosen between options, lived with the consequences, measured, failed, and learned. Interviewers listen for the same signals in both: trade-offs stated explicitly, numbers, ownership, and the ability to change your mind with evidence.

| What they assess | What it sounds like |
|---|---|
| Judgment | "We chose X over Y because…, it cost us…, we would revisit if…" |
| Ownership | "I" for what you did, "we" for the team; no blaming |
| Evidence | "p99 went from 900 ms to 180 ms in the k6 load test" |
| Learning | "Next time I'd measure before choosing" |
| Collaboration | How you handled a disagreement or helped a teammate |

## The STAR(L) format

Answer in **two minutes or less**, with this structure:

- **S — Situation**: the context in one or two sentences. Which project, which system, what scale.
- **T — Task**: what *you* had to achieve, and what made it hard.
- **A — Action**: what you did, with the reasoning and the alternatives you rejected. This is the longest part.
- **R — Result**: what happened, with a number if possible.
- **L — Learning**: what you would do differently, or what you now do by default.

!!! tip "Talking about trade-offs"
    Use the same sentence as in the design interview: **"We chose X over Y because [requirement or number]. The cost was [what we gave up]. We would revisit it if [condition]."** For example: "We chose Redis cache-aside over read replicas for the catalog because 95% of the traffic was reads of the same 200 events. The cost was up to 60 seconds of stale prices. We would revisit it if prices started changing during the sale."

## Turning course work into stories

You already have the raw material. Write down one story from each of these before an interview season:

| Course activity | Story it gives you | Typical question |
|---|---|---|
| [Team project](../../../exercises/project/index.md) | A design decision and its trade-off; a disagreement in the team | "Tell me about a technical decision you're proud of" |
| [Load-test campaign](../../../exercises/project/load-test-campaign/index.md) | Finding a bottleneck with data, before/after numbers | "Tell me about a performance problem you solved" |
| [Chaos game day](../../../exercises/project/game-day/index.md) | Something that broke, how you diagnosed it, what you changed | "Tell me about a failure" |
| [Design doc and ADRs](../../../exercises/design-doc/index.md) | Writing down alternatives, defending a choice, accepting feedback | "Tell me about a time you changed your mind" |
| Labs (for example [Hands-on 9](../../../hands-on/9/index.md)) | Adding resilience to a dependency | "How do you deal with unreliable dependencies?" |

## Ten common questions

| # | Question | What is being assessed | Outline of a good answer |
|---|---|---|---|
| 1 | Tell me about a technical decision you made. | Judgment, trade-offs | Options considered, criteria (numbers, requirements), the choice, its cost, the result |
| 2 | Tell me about something that failed. | Ownership, learning | What broke, your part in it, how you found out, what you fixed, what changed afterwards |
| 3 | Tell me about a performance problem you solved. | Method, evidence | Symptom, measurement, hypothesis, experiment, before/after numbers |
| 4 | Tell me about a disagreement with a teammate. | Collaboration | Both positions fairly, how you decided (data, a spike, a timebox), relationship afterwards |
| 5 | Tell me about a time you changed your mind. | Openness to evidence | The original belief, the evidence, the new decision, what it taught you |
| 6 | What's the most complex system you've built? | Depth, communication | Explain it at two levels: one sentence, then the architecture and the hardest part |
| 7 | Tell me about a time you had to learn something fast. | Learning ability | What, why, how (docs, small experiments, asking), how quickly it became useful |
| 8 | Tell me about a deadline you almost missed. | Prioritization | What you cut and why, how you communicated, the outcome |
| 9 | How do you make sure your code works in production? | Operability mindset | Tests, observability, gradual rollout, alerts — with an example from the course |
| 10 | What would you do differently in your project? | Reflection | One concrete thing with its reason, not "nothing" and not "everything" |

!!! example "A worked answer: question 3, from a BoxOffice project"
    **Situation.** "In our System Architecture course, my team of three built a ticketing platform with a catalog, an inventory service for seat holds and an order service, on Kubernetes."

    **Task.** "Our target was to serve 2,000 requests per second on the event page with a p99 under 300 ms. In the first k6 load test, p99 was 1.4 seconds at only 600 requests per second, and I was responsible for the catalog service."

    **Action.** "I didn't want to guess, so I looked at the traces first: 85% of the time was in the database, the same query for the event details, about 40 times per second for the same event. I considered read replicas and a cache. Replicas would add capacity but keep the 20 ms query on every request; a cache-aside Redis would remove most queries, at the cost of stale data. Since event details change rarely, I chose the cache with a 60-second TTL and deleted the key on updates. I also added an index the `EXPLAIN` showed was missing."

    **Result.** "In the next campaign, p99 was 180 ms at 2,000 requests per second, the hit ratio was 97%, and database CPU went from 90% to 15%."

    **Learning.** "Measuring before choosing saved us from adding replicas we didn't need. Since then I start every performance problem with a trace and a hypothesis written down."

## Pitfalls

!!! warning "What makes a good story sound bad"
    - **"We" all the time.** The interviewer is hiring you: say what *you* did.
    - **No numbers.** "It got much faster" is weak; "p99 from 1.4 s to 180 ms" is strong.
    - **A story with no trade-off or no difficulty.** If it was easy, it isn't a good story.
    - **Blaming.** Teammates, the professor, the cloud provider: describe the situation, own your part.
    - **Too long.** Two minutes. The interviewer will ask for more detail if they want it.
    - **Invented stories.** Follow-up questions expose them quickly. A small true story beats a big fake one.

## Your story bank

Fill one row per story; aim for six to eight stories that together cover the ten questions.

| Story (title) | Situation and task | Action (and the alternatives) | Result (numbers) | Learning | Answers questions |
|---|---|---|---|---|---|
| Catalog cache | Project; p99 1.4 s at 600 req/s | Traces → cache-aside over replicas, plus an index | p99 180 ms at 2,000 req/s | Measure before choosing | 1, 3, 5 |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |

Back to the [interview page](../index.md) · practice the design side with the [problems](../problems/index.md) and [mock interviews](../mock/index.md).
