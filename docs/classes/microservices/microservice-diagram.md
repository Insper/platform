``` mermaid
flowchart LR
  subgraph Client
    direction LR
    Web
    Mobile
    Desktop
  end
  subgraph Microservices
    direction LR
    gateway["Gateway"]
    subgraph Essentials
      direction TB
      discovery["Discovery"]
      auth["Auth"]
      config["Configuration"]
    end
    subgraph Businesses
      direction TB
      ms1["Service 1"]
      ms2["Service 2"]
      ms3["Service 3"]
    end
  end
  Client --> lb["Load Balance"] --> gateway --> Businesses
  gateway --> auth
  gateway --> discovery
  click gateway "../gateway/" "Gateway"
  click discovery "../discovery/" "Discovery"
  click auth "../auth-service/" "Auth"
  click config "../config/" "Configuration"
  click lb "../load-balancing/" "Load Balance"
```