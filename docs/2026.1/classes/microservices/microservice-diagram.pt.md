``` mermaid
flowchart LR
  subgraph client["Internet"]
    direction LR
    Web
    Mobile
    Desktop
  end
  subgraph trusted["Camada confiável"]
    direction LR
    lb(["Balanceador de carga"])
    gateway["Gateway"]
    auth["Auth"]
    subgraph bm ["Microsserviço de negócio"]
      direction LR
      ms1["Serviço 1"]
      ms2["Serviço 2"]
      ms3["Serviço 3"]
      db1[("Banco de dados 1")]
      db2[("Banco de dados 2")]
    end
  end
  subgraph third-party["API de terceiros"]
    direction LR
    tp1["Serviço de terceiros"]
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