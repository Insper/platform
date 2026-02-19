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
    lb["Load Balance"]
    gateway["Gateway"]
    auth["Auth"]
    subgraph bm ["Business Microservice"]
      direction LR
      ms1["Service 1"]
      ms2["Service 2"]
      ms3["Service 3"]
    end
  end
  client --> lb --> gateway --> bm
  gateway --> auth
```