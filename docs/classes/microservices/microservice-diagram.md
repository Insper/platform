``` mermaid
flowchart LR
  subgraph client["Internet"]
    direction LR
    Web
    Mobile
    Desktop
  end
  subgraph Trusted Layer
    direction LR
    lb(["Load Balance"])
    gateway["Gateway"]
    auth["Auth"]
    subgraph bm ["Business Microservice"]
      direction LR
      ms1["Service 1"]
      ms2["Service 2"]
      ms3["Service 3"]
      db1[("Database 1")]
      db2[("Database 2")]
    end
  end
  subgraph third-party["Third-Party API"]
    direction LR
    tp1["Third-Party Service"]
  end
  client --> lb --> gateway
  gateway --> ms1
  gateway --> ms2
  gateway --> ms3
  ms1 --> db1
  ms2 --> db2
  ms2 --> ms3
  ms3 --> tp1
  gateway --> auth
```