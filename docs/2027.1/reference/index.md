# Reference

The reference section is the part of the course you keep open in another tab: while designing in the playground, while doing a lab, while preparing for an interview. Nothing here needs to be read in order. Each page answers one kind of question quickly and links back to the class where the topic is explained in depth.

<div class="grid cards" markdown>

-   __[Component catalog](components/index.md)__

    ---

    The 44 components of the palette, one entry each: what it is, when to use it and when not to, key numbers, failure modes, playground parameters, real products on AWS, GCP, Azure and open source, and an interview one-liner.

-   __[Numbers](numbers/index.md)__

    ---

    The numbers every estimate starts from: latency ladder, powers of two, requests per second, storage sizes, the nines of availability, throughput of common components and approximate cloud prices.

-   __[Glossary](glossary/index.md)__

    ---

    The vocabulary of system design from A to Z, with a one- or two-sentence definition and a link to where each term is taught. The Portuguese page gives the usual Brazilian equivalent.

-   __[Tools](tools/index.md)__

    ---

    The tools of the trade, grouped by job: load testing, chaos and fault injection, observability, infrastructure as code, delivery, local clusters, diagramming and AI systems — with the lab where we use each one.

-   __[Reading list](reading/index.md)__

    ---

    The books, papers, engineering blogs and courses behind the course, each with one line on why it is worth your time.

</div>

## Which page answers my question?

| I want to… | Go to |
|---|---|
| Know what a box does before I add it to a design | [Component catalog](components/index.md) |
| Compare two components (queue vs pub/sub, SQL vs NoSQL) | The two catalog entries, then the class page they link to |
| Estimate QPS, storage or bandwidth | [Numbers](numbers/index.md) and [Class 2 · Estimation](../classes/estimation/index.md) |
| Check what a term means | [Glossary](glossary/index.md) |
| Pick a load-testing or chaos tool | [Tools](tools/index.md) |
| Go deeper than the class | [Reading list](reading/index.md) |
| Prepare for an interview | [Support › Interview](../support/interview/index.md) |
| Try an idea under load | [Playground](../../playground/index.md) |

!!! note "About the numbers and prices"
    Latencies, throughputs and prices in the reference are either well-known published values or orders of magnitude labeled *illustrative*. They are good enough to reason about a design and to compare options; they are not benchmarks of your hardware. Prices are approximate list prices observed in 2026 and change often — always confirm with the providers' calculators before quoting a cost.
