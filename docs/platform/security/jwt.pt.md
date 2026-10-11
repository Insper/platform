## JWT - JSON Web Token

JWT significa JSON Web Token. É um meio compacto e seguro para URLs (URL-safe) de representar claims entre duas partes. JWTs são muito usados para proteger a transmissão de informações entre partes em um ambiente web, tipicamente para autenticação e troca de informações. A especificação do JWT é definida pela RFC 7519[^1] e é uma abordagem descentralizada de segurança (que pode suportar [escalabilidade horizontal](../concepts.md#horizontal-scalability-scale-out)).

Estes são os principais componentes e conceitos do JWT:

* **Formato JSON:** JWTs são representados como objetos JSON, fáceis de interpretar e de gerar. O formato JSON os torna legíveis por humanos e fáceis de manipular.
* **Três partes:** JWTs são compostos por três partes separadas por pontos (`.`): Header, Payload e Signature.

    - **Header:** o header normalmente tem duas partes: o tipo do token (JWT) e o algoritmo de assinatura utilizado, como HMAC SHA256 ou RSA.

    - **Payload:** o payload contém as claims. Claims são afirmações sobre uma entidade (tipicamente, o usuário) e dados adicionais. Há três tipos de claims: registradas (registered), públicas (public) e privadas (private).

    - **Signature:** para criar a assinatura, você pega o header codificado, o payload codificado, um segredo e o algoritmo especificado no header, e assina tudo isso.

* **Codificação:** cada uma das três partes é codificada em Base64Url, e as strings resultantes são concatenadas com pontos entre elas. O JWT final tem o formato: `xxxxx.yyyyy.zzzzz`.
* **Stateless e autocontido:** JWTs são stateless, ou seja, toda a informação necessária está no próprio token. O servidor não precisa armazenar o estado do usuário. Eles também são autocontidos, ou seja, tudo o que é necessário está contido no token.
* **Casos de uso:** JWTs são muito usados para autenticação e troca de informações entre partes. Por exemplo, depois que um usuário faz login, o servidor pode gerar um JWT e enviá-lo ao cliente. O cliente pode então incluir o JWT nos headers das requisições seguintes para acessar recursos protegidos. O servidor verifica a autenticidade do JWT usando a chave secreta armazenada.
* **Cuidados de segurança:** embora JWTs sejam amplamente usados e versáteis, é importante manipulá-los com segurança. Por exemplo, a chave usada para assinar o JWT deve ser mantida em segredo, e deve-se usar HTTPS para transmitir JWTs, evitando ataques man-in-the-middle.

Veja um exemplo simples de JWT criado no JWT Builder[^2]:

`eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJpc3MiOiJJbnNwZXIiLCJpYXQiOjE3MDMwMDgzMzgsImV4cCI6MjAxODU0MTEzOCwiYXVkIjoid3d3Lmluc3Blci5lZHUuYnIiLCJzdWIiOiJodW1iZXJ0b3JzQGluc3Blci5lZHUuYnIiLCJHaXZlbk5hbWUiOiJIdW1iZXJ0byIsIlN1cm5hbWUiOiJTYW5kbWFubiIsIkVtYWlsIjoiaHVtYmVydG9yc0BpbnNwZXIuZWR1LmJyIiwiUm9sZSI6IlByb2Zlc3NvciJ9.SsGdvR5GbYWTRbxY7IGxHt1vSxhkpRueBJWsi0lrPhJVCICp119QjU8F3QvHW0yF5tw-HhQ9RVh0l89t4M0LNw`

Esse JWT é composto por três partes, decodificadas por [^3]:

=== "Header"

    `eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9`

    ```json
    {
      "typ": "JWT",
      "alg": "HS512"
    }
    ```

=== "Payload"

    `eyJpc3MiOiJJbnNwZXIiLCJpYXQiOjE3MDMwMDgzMzgsImV4cCI6MjAxODU0MTEzOCwiYXVkIjoid3d3Lmluc3Blci5lZHUuYnIiLCJzdWIiOiJodW1iZXJ0b3JzQGluc3Blci5lZHUuYnIiLCJHaXZlbk5hbWUiOiJIdW1iZXJ0byIsIlN1cm5hbWUiOiJTYW5kbWFubiIsIkVtYWlsIjoiaHVtYmVydG9yc0BpbnNwZXIuZWR1LmJyIiwiUm9sZSI6IlByb2Zlc3NvciJ9`

    ```json
    {
      "iss": "Insper",
      "iat": 1703008338,
      "exp": 2018541138,
      "aud": "www.insper.edu.br",
      "sub": "humbertors@insper.edu.br",
      "GivenName": "Humberto",
      "Surname": "Sandmann",
      "Email": "humbertors@insper.edu.br",
      "Role": "Professor"
    }
    ```

=== "Signature"

    `SsGdvR5GbYWTRbxY7IGxHt1vSxhkpRueBJWsi0lrPhJVCICp119QjU8F3QvHW0yF5tw-HhQ9RVh0l89t4M0LNw`

    ```py
    HMACSHA512(
      base64UrlEncode(header) + "." +
      base64UrlEncode(payload),
      qwertyuiopasdfghjklzxcvbnm123456,
    )
    ```

JWTs são amplamente usados no desenvolvimento web por sua simplicidade, flexibilidade e suporte em diversas linguagens de programação e frameworks. Eles são comuns em sistemas de autenticação baseados em token.

### Material adicional

- [Spring Cloud Security](../../handout/microservices/auth.md)

- :fontawesome-brands-youtube:{ .youtube } [ByteByteGo - Why is JWT popular?](https://www.youtube.com/watch?v=P2CPd9ynFLg){:target='_blank'}

    [![](https://img.youtube.com/vi/P2CPd9ynFLg/0.jpg){ width=60% }](https://www.youtube.com/watch?v=P2CPd9ynFLg){:target="_blank"}



[^1]: [RFC 7519 - JSON Web Token (JWT)](https://datatracker.ietf.org/doc/html/rfc7519){:target="_blank"}, 2015.
    
[^2]: [JWT - Builder](http://jwtbuilder.jamiekurtz.com){:target="_blank"}.
    
[^3]: [jwt.io - JWT Verification](https://jwt.io/){:target="_blank"}.

[^4]: [Unix Time Stamp - Epoch Converter](https://www.unixtimestamp.com){:target="_blank"}.

[^5]: DELANTHA, R., [Spring Cloud Gateway security with JWT](https://medium.com/@rajithgama/spring-cloud-gateway-security-with-jwt-23045ba59b8a){:target="_blank"}, 2023.

[^6]: [Wikipedia - Pepper (cryptography)](https://en.wikipedia.org/wiki/Pepper_(cryptography)){:target="_blank"}.

[^7]: PGzlan, [Serve your hash with Salt and Pepper for Stronger Account Security](https://dev.to/0xog_pg/serve-your-hash-with-salt-and-pepper-for-stronger-account-security-587k){:target="_blank"}, 2023.