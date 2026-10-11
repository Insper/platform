Clique em **"Resposta"** para ver a resposta correta e a explicação.

---

## Segurança / JWT

**Q1.** Quais são as três partes estruturais de um JWT e como elas são separadas?

- A. Header, Body, Footer — separadas por quebras de linha
- B. Algorithm, Claims, Secret — separadas por ponto e vírgula
- C. Header, Payload, Signature — separadas por pontos (`.`)
- D. Type, Data, Hash — separadas por sublinhados

??? success "Resposta"
    **C — Header.Payload.Signature.**

    Cada parte é codificada em Base64URL e unida às outras por pontos. O Header declara o algoritmo (`HS256`, `RS256`). O Payload contém as claims (ID do usuário, papéis, expiração). A Signature é calculada sobre Header + Payload com a chave secreta — qualquer adulteração invalida a assinatura, sem exigir consulta ao banco de dados.

---

**Q2.** Qual serviço **gera os tokens JWT** após um login bem-sucedido, e por que essa responsabilidade fica com ele?

- A. O gateway — ele cuida de toda a lógica de autenticação, por ser o ponto de entrada
- B. O serviço de contas — ele é o dono dos dados de identidade do usuário
- C. O serviço de autenticação — ele valida as credenciais e emite tokens assinados, com expiração e claims configuráveis
- D. O cliente — os JWTs são autoassinados pelo navegador

??? success "Resposta"
    **C — O serviço de autenticação.**

    O serviço de autenticação é responsável por: receber as credenciais de login, pedir ao serviço de contas que as confira (`POST /accounts/login`, que compara hashes de senha), gerar um JWT assinado com a identidade da conta (`id`, `name`, `email`) e devolvê-lo ao cliente em um cookie. Separar isso do serviço de contas mantém a lógica de autenticação coesa e com deploy independente.

---

**Q3.** Qual é o papel do `RouterValidator` no serviço de gateway?

- A. Ele valida os corpos JSON das requisições contra um schema antes do roteamento
- B. Ele escolhe para qual instância do microsserviço seguinte rotear, de acordo com a carga
- C. Ele determina quais rotas exigem um JWT válido (protegidas) e quais passam sem token (rotas abertas, como `/login` e `/register`)
- D. Ele valida se a configuração de rotas do gateway corresponde à especificação OpenAPI

??? success "Resposta"
    **C — Distingue rotas protegidas de rotas abertas.**

    Nem todos os endpoints exigem autenticação: os endpoints de login e de cadastro precisam ser acessíveis sem token (senão os usuários nunca conseguiriam fazer login). O `RouterValidator` oferece um predicado que o `AuthorizationFilter` consulta — se a rota é aberta, o filtro a deixa passar; se é protegida, ele valida o JWT primeiro.

---

**Q4.** Em que ponto do ciclo de vida da requisição a **validação do JWT** é feita?

- A. Dentro de cada microsserviço de negócio, em toda requisição recebida
- B. Na camada de banco de dados, quando a sessão do usuário é consultada
- C. No `AuthorizationFilter` dentro do serviço de gateway, antes que a requisição seja encaminhada a qualquer serviço seguinte
- D. No provedor de identidade, por meio de um callback a cada requisição

??? success "Resposta"
    **C — No `AuthorizationFilter` do gateway.**

    O gateway intercepta todas as requisições. O `AuthorizationFilter` verifica o JWT da requisição (vindo do cookie `__store_jwt_token`), chama o serviço de autenticação (`POST /auth/solve`) para validá-lo e, então, ou encaminha a requisição com a identidade resolvida, ou devolve `401 Unauthorized`. Os microsserviços de negócio nunca recebem requisições não autenticadas.

---

**Q5.** Por que o `AuthController` é definido como uma **interface no módulo `auth`**, e não diretamente dentro do `auth-service`?

- A. O Spring Boot exige que interfaces e implementações fiquem em módulos Maven separados
- B. Isso reduz o tempo de compilação, ao separar a interface da implementação
- C. Outros serviços podem chamar o auth via Feign dependendo só do módulo de interface `auth`, sem carregar a implementação completa e suas dependências transitivas — seguindo o Princípio da Inversão de Dependência
- D. Isso permite fazer o deploy do serviço de autenticação como uma imagem Docker separada e menor

??? success "Resposta"
    **C — Separação da interface para um gerenciamento limpo de dependências.**

    Um cliente Feign só precisa da interface e dos DTOs, então quem chama depende da biblioteca enxuta `auth` — exatamente como o próprio `auth-service` chama o `account-service` pela biblioteca `account`. Depender do `auth-service` levaria o JJWT, o Spring MVC e todo o resto do serviço para o classpath de quem chama. (O Gateway é a exceção: ele é reativo, então chama o `/auth/solve` com `WebClient`, e não com Feign.)

---
