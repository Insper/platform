
Your team has built the store: a **gateway**, the **auth**, **account**, **product**, **order** and **exchange** services, a **Postgres** database, a **Redis** cache and **Kafka**. It runs fine on a laptop with Docker Compose. Now it has to run somewhere real, and you have four kinds of options: buy servers, rent virtual machines, hand your code or container to a platform that runs it, or skip the component and pay for a product that already does the job.

Each option draws a different line between **what your team operates** and **what someone else operates**. That line is what a **cloud service model** defines.

!!! abstract "The one idea of this class"

    **Every service model answers the same question: who operates each layer of the stack?** The more you hand over, the faster you move and the less you control.

!!! abstract "Learning objectives"

    By the end of this class you should be able to:

    - **Explain** what makes a service "cloud" and the difference between CapEx and OpEx.
    - **Place** IaaS, CaaS, PaaS, FaaS and SaaS on the responsibility stack, stating who acts when something breaks.
    - **Compare** the models by control, unit of deployment, scaling, cost and portability.
    - **Choose** a model for each component of a system and justify the trade-off.
    - **Identify** what never moves to the provider: your data, your access rules and your configuration.

## Slides

<div class="slides-embed">
  <iframe src="slides/service-models.html" title="Slides: service models" loading="lazy" allowfullscreen></iframe>
</div>

Click the slides and use ← → to move through them; **F** goes full screen and **P** opens the presenter view, with the notes.
[:material-presentation: Open the slides in a new tab](slides/service-models.html){:target="_blank"}

---

## What makes it "cloud"?

Renting a server in a datacentre on a three-year contract is not cloud computing, even if the server is far away. NIST[^1] defines cloud computing by **five essential characteristics**, and a service must have all of them:

<div class="compact-table" markdown>

| Characteristic | What it means | In the store |
|---|---|---|
| **On-demand self-service** | You provision resources yourself, without talking to a human at the provider | `aws rds create-db-instance` creates the Postgres database in minutes |
| **Broad network access** | Resources are reachable over the network with standard protocols | The gateway is an HTTPS endpoint |
| **Resource pooling** | The provider serves many customers (**tenants**) from shared hardware | Your order service may share a physical host with another company's workload, isolated from it |
| **Rapid elasticity** | Capacity grows and shrinks quickly, often automatically | Black Friday: order goes from 2 to 20 replicas, then back |
| **Measured service** | Usage is metered and billed per unit | The bill shows vCPU-hours, GB of storage and GB of data transfer |

</div>

**CapEx vs OpEx.** Buying servers is **capital expenditure (CapEx)**: a large payment up front for hardware sized for the peak you *expect*. The cloud turns this into **operational expenditure (OpEx)**: you pay monthly for what you *use*. OpEx removes the up-front bet, but it is not automatically cheaper. A workload at full load 24/7 for years can cost more in the cloud than on owned hardware.

!!! info "Service model is not deployment model"
    NIST also defines **deployment models**, which say *who shares* the infrastructure: **public** (any paying customer), **private** (one organisation), **hybrid** (a combination) and **community** (organisations with common requirements). This class is about the other axis: *how much of it you operate*.

---

## The responsibility stack

Any application in production needs the same six layers. Read them from the bottom up, as if each one were standing on the one below:

<div class="compact-table" markdown>

| Layer | What it is | In the store |
|---|---|---|
| **Data and access** | What the application stores and who may read it | Orders, accounts, database users, API keys |
| **Application** | Your code | The gateway and the services |
| **Middleware** | The software your code needs in order to run | JDK, web server, Redis |
| **OS** | The operating system of each machine | Linux |
| **Virtualisation** | The hypervisor that slices a physical host into virtual machines | KVM, Xen |
| **Hardware** | Servers, disks, network, power and cooling | The datacentre |

</div>

Now the central picture of this class. Each column is a model, and from left to right the provider takes over more of the stack.

🟧 you operate it · 🟦 the provider operates it

<div class="compact-table" markdown>

| Layer | On-premises | IaaS | CaaS | PaaS | FaaS | SaaS |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Data and access** | 🟧 | 🟧 | 🟧 | 🟧 | 🟧 | 🟧 |
| **Application** | 🟧 | 🟧 | 🟧 | 🟧 | 🟧 | 🟦 |
| **Middleware** | 🟧 | 🟧 | 🟧 | 🟦 | 🟦 | 🟦 |
| **OS** | 🟧 | 🟧 | 🟦 | 🟦 | 🟦 | 🟦 |
| **Virtualisation** | 🟧 | 🟦 | 🟦 | 🟦 | 🟦 | 🟦 |
| **Hardware** | 🟧 | 🟦 | 🟦 | 🟦 | 🟦 | 🟦 |

</div>

Three things to notice:

- **The top row never changes.** The provider may store your data, but only you can decide who may read it. AWS sums this up as security *of* the cloud (the provider) versus security *in* the cloud (the customer)[^2], and Microsoft draws the same table for Azure[^3].
- **CaaS and PaaS differ by one layer: the middleware.** On CaaS the JDK is inside the image you build. On PaaS the platform supplies it.
- **PaaS and FaaS have the same colours.** What changes is the size of what you deploy: an application or a single function.

!!! tip "An analogy: pizza as a service"
    - **On-premises:** you make pizza at home, with your own oven and your own ingredients.
    - **IaaS:** you rent a kitchen. Oven and gas are provided; you bring the ingredients and cook.
    - **PaaS:** you order delivery. Someone cooks; you provide the table and the drinks.
    - **SaaS:** you eat at a restaurant. You just choose from the menu, and you still decide who sits at your table.

### Who acts when something happens?

The stack becomes concrete when something goes wrong. Find the event and read across the row to see who has to act (🟧 you, 🟦 the provider):

<div class="compact-table" markdown>

| Event | On-premises | IaaS | CaaS | PaaS | FaaS | SaaS |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| A disk fails | 🟧 | 🟦 | 🟦 | 🟦 | 🟦 | 🟦 |
| A flaw is found in the Linux kernel | 🟧 | 🟧 | 🟦 | 🟦 | 🟦 | 🟦 |
| A flaw is found in the JDK | 🟧 | 🟧 | 🟧 | 🟦 | 🟦 | 🟦 |
| Black Friday: traffic grows tenfold | 🟧 | 🟧 | 🟦 | 🟦 | 🟦 | 🟦 |
| A bug in the application | 🟧 | 🟧 | 🟧 | 🟧 | 🟧 | 🟦 |
| An access key leaks | 🟧 | 🟧 | 🟧 | 🟧 | 🟧 | 🟧 |

</div>

The table assumes the usual setup of each model. On CaaS and PaaS the platform scales, but you still set the limits. On managed Kubernetes with classic node groups, the OS of the nodes is still partly your job.

<div class="csim" data-sim="service-stack" data-model="iaas"></div>

!!! tip "Try it"
    Pick each model with no event: the layers you maintain drop from **6** on-premises to **4** on IaaS, **3** on CaaS, **2** on PaaS and FaaS and **1** on SaaS. The dashed line between you and the provider climbs one layer at a time, except from PaaS to FaaS, which share it.

    1. Choose **JDK flaw** and step from IaaS to CaaS to PaaS: you act on IaaS and CaaS (on CaaS the JDK is inside your image); the provider acts from PaaS on.
    2. Choose **Black Friday 10×**: it hits no single layer: it is capacity, so whoever adds machines acts. On IaaS you start more VMs, on CaaS the provider adds instances (you still set the limits).
    3. Choose **Key leaks** and try all six models: the actor is always you.

??? question "Check your understanding: the store runs on a PaaS and a flaw is published in the Linux kernel. What does your team do?"
    Nothing, as far as the OS is concerned: the provider patches it, which is what the OS row shows. Now change one thing: the store runs on CaaS and the flaw is in the **JDK**. Then your team acts, because the JDK is inside your image: you update the base image, rebuild and deploy again.

The same event, step by step: a Linux kernel flaw is published while the store runs on IaaS, and again on PaaS.

``` mermaid-sim
sequenceDiagram
  participant L as Linux community
  participant P as Cloud provider
  participant T as Your team
  participant S as The store
  L->>P: publishes the kernel flaw (CVE)
  Note over P,S: IaaS: the OS is yours
  P->>T: security bulletin
  T->>S: apt upgrade and reboot, one VM at a time
  Note over P,S: PaaS: the OS is the provider's
  P->>S: patches the hosts and restarts your instances gradually
  S-->>T: nothing to do but watch the dashboards
```

---

## Climbing the stack, one model at a time

NIST defines three foundational models: **IaaS**, **PaaS** and **SaaS**[^1]. The market later added **CaaS** and **FaaS** between them. Each section below has the same parts, so you can compare them, and each one puts the store on that model.

What you hand to the platform shrinks as you climb:

``` mermaid-sim
flowchart LR
  you([Your team])
  you -->|"SSH, apt install, java -jar"| iaas["IaaS<br/>a VM"]
  you -->|"docker push"| caas["CaaS<br/>an image"]
  you -->|"git push"| paas["PaaS<br/>the code"]
  you -->|"upload a handler"| faas["FaaS<br/>a function"]
  you -->|"sign up, configure"| saas["SaaS<br/>an account"]
```

### IaaS: Infrastructure as a Service

**You rent a machine and do the rest.** The provider supplies virtual compute, storage and network. You install and maintain everything from the OS up.

<div class="compact-table" markdown>

| You hand over | You keep |
|---|---|
| Datacentre, power, cooling, physical network | OS: installation, patches, hardening |
| Hardware and hypervisor | Runtime, middleware, your code and data |
| | Firewall rules, access control, backups |

</div>

**Examples:** AWS EC2, Google Compute Engine, Azure Virtual Machines, DigitalOcean Droplets.

!!! example "The order service on IaaS"
    ```bash
    aws ec2 run-instances --image-id <ubuntu-ami> --instance-type t3.medium --key-name <key>
    ssh ubuntu@<public-ip>
    sudo apt update && sudo apt install -y openjdk-21-jre-headless nginx
    java -jar order.jar
    ```
    And that is just the first day. You still have to configure nginx, restart the service if it crashes, apply OS patches and schedule backups.

- **Choose it when** you need control of the OS (a specific kernel, custom drivers or special hardware such as GPUs) or when moving an existing application to cloud VMs without redesigning it (**lift-and-shift**).
- **Avoid it when** nobody on the team wants to be on call for servers: every layer above the hypervisor is yours to maintain.

### CaaS: Container as a Service

**You hand over a container image; the platform runs it.** The provider manages scheduling, networking, scaling and machine health. Everything inside the image is still yours.

<div class="compact-table" markdown>

| You hand over | You keep |
|---|---|
| Machines, OS of the hosts, scheduling | The image: base image, JDK, your code |
| Networking between containers, scaling | Limits, configuration, data |

</div>

**Examples:** AWS ECS / Fargate, Google Cloud Run, Azure Container Apps.

!!! example "The order service on CaaS"
    ```bash
    docker build -t <registry>/order:1.0 .
    docker push <registry>/order:1.0
    gcloud run deploy order --image <registry>/order:1.0 --region southamerica-east1 --max-instances 10
    ```
    It is the same image you already run with Docker Compose. That is what makes CaaS portable: moving to another provider means pushing that image somewhere else.

**Managed Kubernetes** (Amazon EKS, Google GKE, Azure AKS) is also usually classified as CaaS. The provider runs the control plane (API server, scheduler, etcd), and you deploy containers through the standard Kubernetes API maintained by the CNCF[^4]. How much of the worker nodes stays with you depends on the mode: classic node groups leave node sizing and upgrades to you, while GKE Autopilot and EKS Auto Mode hand them over too. This is the option your project uses.

- **Choose it when** your services are already containers and you want the same artifact from the laptop to production.
- **Avoid it when** the team would rather not maintain images and base-image patches at all: then PaaS is one step up.

### PaaS: Platform as a Service

**You hand over the code; the platform builds and runs it.** The provider detects the language, supplies the runtime and handles deploys, load balancing and scaling. You write the application and configure it with environment variables.

<div class="compact-table" markdown>

| You hand over | You keep |
|---|---|
| Everything up to the runtime, including OS and JDK | Application code |
| Build, deploy, load balancing, scaling | Configuration (env vars, scaling rules) |
| | Data and access |

</div>

**Examples:** Heroku, AWS Elastic Beanstalk, Google App Engine, Azure App Service, Railway, Render.

!!! example "The order service on PaaS"
    ```bash
    heroku create store-order
    heroku addons:create heroku-postgresql:essential-0
    git push heroku main
    heroku ps:scale web=2
    ```
    The platform finds the `pom.xml` and builds the project with a **buildpack**, a script that recognises the project and knows how to build and run it. Nobody installed a JDK or a database.

PaaS favours the **12-factor app**[^5] pattern: stateless processes, configuration in environment variables and logs to stdout. The reason is practical: the platform may restart or move your process at any time and wipe its local disk, so anything that must survive belongs in an external service, such as a database.

- **Choose it when** the team wants to ship features rather than manage servers: MVPs, API backends, teams without infrastructure experience.
- **Avoid it when** you need software or settings the platform does not offer, or when the price per instance is too high at a large, steady scale.

### FaaS: Function as a Service

**You hand over a single function; it runs only when something calls it.** This is PaaS taken to the extreme, also known as **serverless**. The platform creates instances on demand and scales down to zero when idle, and you pay per invocation and per millisecond.

<div class="compact-table" markdown>

| You hand over | You keep |
|---|---|
| Everything up to the runtime, including scaling | The function code |
| Creating and removing instances as calls arrive | Trigger configuration, data and access |

</div>

**Examples:** AWS Lambda, Google Cloud Functions, Azure Functions, Cloudflare Workers.

!!! example "Part of the order service on FaaS"
    The whole order service is not a good fit, but the e-mail sent after each order is:

    ```java
    public class OrderCreated implements RequestHandler<Map<String, Object>, String> {
        @Override
        public String handleRequest(Map<String, Object> event, Context context) {
            // send the confirmation e-mail for this order
            return "sent";
        }
    }
    ```

Two constraints come with this model. The first is the **cold start**: the first request that reaches a function with no instance ready has to wait for the platform to create a sandbox, load the code and start the runtime, and in a Spring Boot application that can take seconds. The second is a maximum execution time: 15 minutes on Lambda[^6].

``` mermaid-sim
sequenceDiagram
  participant E as Event (new order)
  participant P as FaaS platform
  participant F as Function instance
  E->>P: invoke
  Note over P,F: cold start: no instance ready
  P->>F: create sandbox, load code, start the runtime
  F-->>P: response (seconds with Spring Boot)
  E->>P: next invoke, a moment later
  Note over P,F: warm: the instance is reused
  P->>F: call the handler
  F-->>P: response (milliseconds)
  Note over P,F: idle for minutes: the platform removes the instance (scale to zero)
```

- **Choose it when** the work is short, event-driven and sporadic: webhooks, scheduled jobs, processing a file after upload.
- **Avoid it when** the service needs low latency on every request or receives steady, heavy traffic: an always-on container is cheaper and more predictable.

<div class="csim" data-sim="cloud-cost" data-requests="1000000" data-duration="100" data-memory="512"></div>

!!! tip "Try it"
    The sliders start at **1 M requests/month**, **100 ms** and **512 MB**: FaaS costs **\$1.03** a month, the 2 always-on Fargate tasks **\$36.04** and the 2 VMs **\$60.74**. Prices: EC2 t3.medium \$0.0416/h, Fargate \$0.04048 per vCPU-hour and \$0.004445 per GB-hour, Lambda \$0.20 per million requests and \$0.0000166667 per GB-second (AWS `us-east-1`, on-demand, November 2026; free tier, load balancer and data transfer left out).

    1. Slide the requests up: FaaS stops being cheaper at about **34.9 M requests/month**, only **13.3 requests per second** on average. Past that point the always-on tasks cost the same, while FaaS keeps charging for every request.
    2. At **1 B requests/month** FaaS costs **\$1,033**, Fargate **\$216** (12 tasks) and the VMs **\$91.10** (3 VMs): at a large, steady scale the cheapest unit wins, as the bullets above say.
    3. Set the duration to **300 ms** and the memory to **1024 MB**: each call costs about 5× more and the break-even falls to **6.9 M**. With **10 ms** and **128 MB** it rises to **163 M**.

!!! info "Serverless containers blur the line"
    Google Cloud Run and Azure Container Apps also **scale to zero** and bill by usage, just like FaaS, but they run any container image. "Serverless" describes the *operating model* (no servers to manage, pay per use), not only functions.

### SaaS: Software as a Service

**You use the product; the provider runs everything else.** There is no infrastructure or application to operate. You manage users, permissions and the data you put in.

<div class="compact-table" markdown>

| You hand over | You keep |
|---|---|
| Everything, including the application | User accounts and permissions |
| Security of the service, updates | The data you enter |
| | Integrations (APIs, webhooks) |

</div>

**Examples:** Google Workspace, Salesforce, Slack, GitHub, Datadog, Shopify.

!!! example "The store on SaaS"
    There is nothing to deploy, because Shopify already is a store: you create an account, register the products and set up payments. It is live the same day, but the store can only do what the product allows.

Most SaaS is **multi-tenant**: one application serves all customers (tenants), with the data of each one kept apart. Sharing the same installation among so many customers is what makes SaaS cheap and instant to adopt.

- **Choose it when** an existing product already meets the need and the tool is not what sets your company apart: e-mail, CRM, monitoring, CI/CD.
- **Avoid it when** the software *is* your differentiator, or when you need a level of customisation the product will never offer.

---

## Managed building blocks

Not everything fits on the ladder above. **DBaaS** applies the same handover to a *single component*: instead of operating a Postgres server, you rent one.

<div class="compact-table" markdown>

| Running Postgres on a VM | Using a DBaaS |
|---|---|
| You install it and patch the OS and the database | The provider applies the patches in a window you choose |
| You write backup scripts and test them | You set the retention period |
| You build replication and failover | You turn on an option (such as Multi-AZ on RDS) |
| Schema, queries, access | Schema, queries, access: **these stay with you** |

</div>

**Examples:** AWS RDS, Amazon Aurora, Google Cloud SQL, Azure Database, Neon.

The same idea exists for other components:

<div class="compact-table" markdown>

| Model | Abbreviation | Examples |
|---|---|---|
| Storage as a Service | STaaS | AWS S3, Google Cloud Storage, Backblaze B2 |
| AI / ML as a Service | AIaaS | AWS Bedrock, Google Vertex AI, Azure AI |
| Monitoring as a Service | — | Datadog, New Relic, Grafana Cloud |
| Security as a Service | SECaaS | Cloudflare, AWS Shield, Snyk |
| Communication as a Service | CPaaS | Twilio, SendGrid, AWS SES |

</div>

---

## Comparing the models

Read the table by rows, watching how each characteristic changes from left to right:

<div class="compact-table" markdown>

| | On-premises | IaaS | CaaS | PaaS | FaaS | SaaS |
|---|---|---|---|---|---|---|
| **You deploy** | Everything | A VM | An image | Code | A function | Nothing |
| **Control** | Maximum | High | Medium | Medium | Low | Minimal |
| **Time to go live** | Months | Hours | Minutes | Minutes | Minutes | Immediate |
| **Scaling** | Buy hardware | Manual or scripted | Automatic (some to zero) | Automatic | Automatic to zero | Automatic |
| **You pay for** | Hardware (CapEx) | VM-hours | Container time | Instances or usage | Invocations and duration | Users or seats |
| **Portability** | Full | High | High (the image) | Medium | Low (vendor API) | Low (data export) |

</div>

---

## Who offers each model { #providers }

The big clouds offer almost every model; smaller providers usually specialize in one step of the stack. Read the table by columns to see that **a model describes a service, not a company**: AWS appears on every row.

<div class="compact-table" markdown>

| Model | AWS | Google Cloud | Microsoft | Other providers |
|---|---|---|---|---|
| **IaaS** | EC2 | Compute Engine | Azure Virtual Machines | DigitalOcean Droplets, Oracle Cloud Compute, Magalu Cloud |
| **CaaS** | ECS / Fargate, EKS | Cloud Run, GKE | Azure Container Apps, AKS | DigitalOcean Kubernetes, Fly.io |
| **PaaS** | Elastic Beanstalk | App Engine | Azure App Service | Heroku, Railway, Render |
| **FaaS** | Lambda | Cloud Run functions (formerly Cloud Functions) | Azure Functions | Cloudflare Workers, Vercel Functions |
| **SaaS** | Amazon Connect, QuickSight | Google Workspace | Microsoft 365, Dynamics 365 | Salesforce, Slack, GitHub, Shopify, TOTVS, RD Station |
| **Managed blocks** | RDS, ElastiCache, MSK | Cloud SQL, Memorystore | Azure Database, Azure Cache for Redis | Neon, Upstash, Confluent Cloud |

</div>

The store in this class could use one row of a single provider (on AWS: EKS for the services, RDS for Postgres) or mix providers (GitHub for the code and CI): what decides is the requirement of each component, as the next section shows.

---

## How to choose

**Choose per component, not per system.** Start from the most managed option and go down only when a concrete requirement forces you to. Ask these questions in order and stop at the first **yes**:

<div class="compact-table" markdown>

| # | Question | If yes |
|---|---|---|
| 1 | Does a product already do the job? | **SaaS:** GitHub Actions, Datadog |
| 2 | Is it a standard database, cache or broker? | **Managed service:** RDS, ElastiCache, MSK |
| 3 | Is the work short, event-driven and sporadic? | **FaaS:** Lambda, Cloud Functions |
| 4 | Do you need control of the OS or special hardware? | **IaaS:** EC2, Compute Engine, Azure VM |
| 5 | Is it a container and do you need the Kubernetes API? | **CaaS, managed Kubernetes:** EKS, GKE, AKS |
| 6 | Is it a container? | **CaaS, managed containers:** Cloud Run, ECS Fargate |
| | None of the above | **PaaS:** Heroku, App Engine |

</div>

The same questions as a flow; each component of the system goes through it on its own:

``` mermaid-sim
flowchart TD
  q1["1. A product already<br/>does the job?"] -->|yes| saas["SaaS"]
  q1 -->|no| q2["2. Standard database,<br/>cache or broker?"]
  q2 -->|yes| man["Managed service"]
  q2 -->|no| q3["3. Short, event-driven,<br/>sporadic work?"]
  q3 -->|yes| faas["FaaS"]
  q3 -->|no| q4["4. Need the OS or<br/>special hardware?"]
  q4 -->|yes| iaas["IaaS"]
  q4 -->|no| q5["5. Container that needs<br/>the Kubernetes API?"]
  q5 -->|yes| k8s["CaaS: managed Kubernetes"]
  q5 -->|no| q6["6. A container?"]
  q6 -->|yes| caas["CaaS: managed containers"]
  q6 -->|no| paas["PaaS"]
```

### Example: the store, component by component

Real systems **mix** models. Running each component of the store through the questions above gives one reasonable result on AWS, with the same shape as the course project:

``` mermaid-sim
flowchart LR
  client([Client]) --> gw["gateway<br/>CaaS: EKS"]
  gw --> acc["account<br/>CaaS: EKS"]
  gw --> ord["order<br/>CaaS: EKS"]
  acc --> db[("Postgres<br/>DBaaS: RDS")]
  ord --> db
  ord --> cache[("Redis<br/>DBaaS: ElastiCache")]
  ord --> kafka["Kafka<br/>managed: Amazon MSK"]
  kafka --> fn["notification<br/>FaaS: Lambda"]
  fn --> mail["e-mail<br/>CPaaS: AWS SES"]
```

<div class="compact-table" markdown>

| Component | Do it yourself | Managed option | What changes for the team |
|---|---|---|---|
| gateway, account, order | Docker Compose on an EC2 VM (IaaS) | EKS or ECS Fargate (CaaS) | No more SSH and OS patching; you write manifests or task definitions instead |
| Postgres | Postgres installed on EC2 (IaaS) | RDS (DBaaS) | Backups, replication and failover become configuration options |
| Redis ([Hands-on 8](../../hands-on/8/index.md)) | Redis container on the VM | ElastiCache (DBaaS) | Cache survives a VM reboot; you pay per node |
| Kafka ([Hands-on 10](../../hands-on/10/index.md)) | Kafka brokers on VMs | Amazon MSK | Broker patching and replacement move to AWS |
| Order notification | A consumer always running in the cluster | Lambda triggered by the Kafka topic (FaaS) | Pay per message; accept cold starts on an asynchronous path |
| CI/CD | Jenkins in a container ([Hands-on 4](../../hands-on/4/index.md)) | GitHub Actions (SaaS) | No Jenkins server to upgrade |
| Monitoring | Prometheus and Grafana ([Hands-on 6](../../hands-on/6/index.md)) | Grafana Cloud or Datadog (SaaS) | No metric storage to size; pricing per host or per metric |

</div>

Moving a component to a more managed model never removes the data and access row: you still decide who can connect to RDS, who can reach the gateway and what gets logged.

??? question "Your turn: where would you run the exchange service, which converts currencies by calling an external rate API?"
    Follow the questions. No product does exactly this job and it is not a database. It answers synchronous requests during checkout, so FaaS is possible but cold starts would hurt. It needs no control of the OS, it is already a container and the project already has Kubernetes: **CaaS on EKS**, next to the other services. Outside the project, a small team without a cluster could reasonably pick Cloud Run. There is often more than one good answer: what matters is the justification.

---

## Common mistakes

!!! warning "Common mistakes"
    - **Reading "managed" as "not my problem".** Most cloud data leaks come from customer-side configuration, such as a public S3 bucket, a database open to `0.0.0.0/0` or a leaked access key, and not from the provider. That layer is always yours[^2].
    - **Ignoring lock-in.** The higher the model, the more your code and data depend on one vendor's API. Prefer open interfaces where they cost little: containers, Postgres and the Kubernetes API.
    - **Assuming the higher model is always cheaper.** Managed services charge a premium per unit. At small scale this is far cheaper than an engineer's time; at large, steady scale a team may save by running the component itself.
    - **Storing state on a PaaS or FaaS instance.** Local files and in-memory sessions disappear on restart or scale-in. Keep state in a database, cache or object store.
    - **Using FaaS for a latency-critical, high-traffic API.** Cold starts and per-invocation pricing make an always-on container cheaper and more predictable at sustained load.

---

## Key takeaways

- A service model defines **who operates each layer** of the stack; moving from IaaS to SaaS, you hand over more and more of it.
- More managed means **faster and less operations**, but **less control and portability**.
- What you deploy tells the models apart: a VM (IaaS), an image (CaaS), code (PaaS), a function (FaaS) or nothing (SaaS).
- A service is "cloud" when it has the five NIST characteristics, and it turns CapEx into OpEx, which does not always mean cheaper.
- Real systems mix models: **choose per component**, starting from the most managed option.
- Your data, access rules and configuration are **always** your responsibility.

## Connections

- [Containerization](../containerization/index.md): the Docker image that CaaS platforms run.
- [Microservices](../microservices/index.md): why the store is split into services that can each go to a different model.
- [Cloud Deployment Roadmap](../deployment/index.md): the next class, with concrete platforms (Railway, Fly.io, Lightsail, ECS, EKS) and their costs.
- [Hands-on 5: Orchestration](../../hands-on/5/index.md): Kubernetes locally with Minikube, the API that EKS manages for you.
- Project: [AWS](../../exercises/project/aws/index.md), [EKS](../../exercises/project/eks/index.md) and [Costs & PaaS](../../exercises/project/costs/index.md).

---

:fontawesome-brands-youtube:{ .youtube } [IaaS vs PaaS vs SaaS](https://www.youtube.com/watch?v=SBQoyZXrpcY){:target="_blank"} — practical overview of the three foundational models.


[^1]: MELL, P.; GRANCE, T. [The NIST Definition of Cloud Computing](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-145.pdf){:target="_blank"}. NIST Special Publication 800-145, 2011.
[^2]: [AWS Shared Responsibility Model](https://aws.amazon.com/compliance/shared-responsibility-model/){:target="_blank"}
[^3]: [Azure Shared Responsibility](https://learn.microsoft.com/en-us/azure/security/fundamentals/shared-responsibility){:target="_blank"}
[^4]: [Cloud Native Computing Foundation (CNCF)](https://www.cncf.io/){:target="_blank"}
[^5]: WIGGINS, A. [The Twelve-Factor App](https://12factor.net/){:target="_blank"}, 2011.
[^6]: [AWS Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html){:target="_blank"} — function timeout up to 900 seconds (15 minutes).
