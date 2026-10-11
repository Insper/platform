Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Segurança / JWT

**Q1.** Quais são as três partes estruturais de um JWT, e como elas são separadas?

- A. Header, Body, Footer — separadas por quebras de linha
- B. Algorithm, Claims, Secret — separadas por ponto e vírgula
- C. Header, Payload, Signature — separadas por pontos (`.`)
- D. Type, Data, Hash — separadas por sublinhados

??? success "Resposta"
    **C — Header.Payload.Signature.**

    Cada parte é codificada em Base64URL, e as partes são unidas por pontos. O Header declara o algoritmo (`HS256`, `RS256`). O Payload contém as claims (ID do usuário, papéis, expiração). A Signature é calculada sobre Header + Payload usando a chave secreta — qualquer adulteração invalida a assinatura, sem precisar consultar o banco de dados.

---

**Q2.** Qual serviço **gera os tokens JWT** depois de um login bem-sucedido, e por que essa responsabilidade fica nele?

- A. O gateway — ele trata toda a lógica de autenticação, por ser o ponto de entrada
- B. O serviço account — ele é dono dos dados de identidade do usuário
- C. O serviço auth — ele valida as credenciais e emite tokens assinados, com expiração e claims configuráveis
- D. O cliente — os JWTs são autoassinados pelo navegador

??? success "Resposta"
    **C — Serviço auth.**

    O serviço auth é responsável por: receber as credenciais de login, validá-las junto ao serviço account, gerar um JWT assinado com a identidade e os papéis do usuário e devolvê-lo ao cliente. Separar isso do serviço account mantém a lógica de autenticação coesa e com deploy independente.

---

**Q3.** Qual é o papel do `RouterValidator` no serviço gateway?

- A. Valida os corpos JSON das requisições contra um schema antes de rotear
- B. Escolhe para qual instância do microsserviço downstream rotear, com base na carga
- C. Determina quais rotas exigem um JWT válido (protegidas) e quais passam sem token (rotas abertas, como `/login` e `/register`)
- D. Valida se a configuração de roteamento do gateway corresponde à especificação OpenAPI

??? success "Resposta"
    **C — Distingue rotas protegidas de rotas abertas.**

    Nem todos os endpoints exigem autenticação: os endpoints de login e de cadastro precisam ser acessíveis sem token (caso contrário, os usuários nunca conseguiriam fazer login). O `RouterValidator` fornece um predicado que o `AuthorizationFilter` verifica — se a rota é aberta, o filtro a deixa passar; se é protegida, ele valida o JWT primeiro.

---

**Q4.** Em que ponto do ciclo de vida da requisição a **validação do JWT** é feita?

- A. Dentro de cada microsserviço de negócio, em toda requisição recebida
- B. Na camada de banco de dados, quando a sessão do usuário é consultada
- C. No `AuthorizationFilter`, dentro do serviço gateway, antes que a requisição seja encaminhada a qualquer serviço downstream
- D. No provedor de identidade, por meio de um callback em toda requisição

??? success "Resposta"
    **C — `AuthorizationFilter` no gateway.**

    O gateway intercepta todas as requisições. O `AuthorizationFilter` verifica o JWT da requisição (vindo de um cookie ou do header `Authorization`), chama o serviço auth para validá-lo e, então, encaminha a requisição com a identidade resolvida ou retorna `401 Unauthorized`. Os microsserviços de negócio nunca veem requisições não autenticadas.

---

**Q5.** Por que o `AuthService` é definido como uma **interface no módulo `auth`**, e não diretamente dentro do `auth-service`?

- A. O Spring Boot exige que interfaces e implementações fiquem em módulos Maven separados
- B. Reduz o tempo de compilação, ao separar a interface da implementação
- C. Outros serviços (gateway, account) podem depender do módulo de interface `auth` sem trazer junto a implementação completa e suas dependências transitivas — seguindo o Princípio da Inversão de Dependência
- D. Permite que o serviço auth seja implantado como uma imagem Docker separada e mais enxuta

??? success "Resposta"
    **C — Separação da interface para um gerenciamento limpo de dependências.**

    O gateway precisa chamar o serviço auth (para validar tokens). Ele depende do módulo de interface `auth` — uma biblioteca enxuta, só com a interface e os DTOs. Se dependesse do `auth-service`, traria para o classpath do gateway o Spring Data JPA, o driver do banco de dados e todas as outras dependências do auth-service.

---
