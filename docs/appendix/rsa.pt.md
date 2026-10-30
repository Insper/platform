# RSA e Ed25519

Esta página responde a uma pergunta: **como duas partes que nunca se encontraram podem confiar uma na outra numa rede pública?** A resposta é a criptografia de chave pública, e você a usa sempre que um serviço desta disciplina conversa com outro: o HTTPS no gateway (TLS[^rfc8446]), o JWT que o serviço de autenticação assina e todos os outros serviços conferem[^rfc7518], a chave SSH que abre um servidor ou um repositório Git[^rfc4253], os certificados que um cluster Kubernetes usa por dentro. Vamos montar o RSA com números pequenos, ver por que sua forma de livro-texto é insegura e depois conhecer o Ed25519, a alternativa moderna.

---

## Por que criptografia de chave pública { #why }

Na criptografia **simétrica** (AES, ChaCha20), a mesma chave cifra e decifra. Ela é rápida, mas os dois lados precisam já compartilhar a chave, e mandá-la pela rede é exatamente o que um bisbilhoteiro espera. Ela também não escala: com uma chave por par, `N` partes precisam de `N(N − 1)/2` chaves, então 100 microsserviços precisariam de 4.950 segredos compartilhados.

Em 1976, Diffie e Hellman propuseram uma saída[^dh_paper]: dar a cada parte **duas** chaves, uma pública e uma privada, de modo que o que a chave pública faz só a privada consegue desfazer. Em 1978, Rivest, Shamir e Adleman publicaram o primeiro esquema prático, o **RSA**[^rsa][^rsa_paper]. Cada parte agora publica uma chave e guarda uma em segredo: `N` partes precisam de `N` pares de chaves, e nada secreto trafega.

---

## O par de chaves { #key-pair }

| Chave | Quem a possui | O que faz |
|---|---|---|
| Chave pública `(e, n)` | Qualquer pessoa | Cifra dados *para* o dono; verifica as assinaturas do dono |
| Chave privada `(d, n)` | Somente o dono | Decifra dados enviados ao dono; cria assinaturas |

As duas chaves são usadas em dois sentidos, para dois trabalhos diferentes:

``` diagram
flowchart LR
    subgraph enc ["Cifragem: qualquer um → dono"]
        a([remetente]) -->|"cifra com a chave<br/>PÚBLICA do dono"| c[texto cifrado]:::comp
        c -->|"decifra com a chave<br/>PRIVADA do dono"| o([dono])
    end
    subgraph sig ["Assinatura: dono → qualquer um"]
        o2([dono]) -->|"assina com a chave<br/>PRIVADA do dono"| s[mensagem + assinatura]:::comp
        s -->|"verifica com a chave<br/>PÚBLICA do dono"| v([qualquer um])
    end
```

A cifragem dá **confidencialidade** (só o dono lê). A assinatura dá **autenticidade e integridade** (só o dono poderia tê-la produzido, e a mensagem não foi alterada); ela não esconde a mensagem.

---

## A matemática, com números pequenos { #maths }

O RSA se apoia na **aritmética modular** e numa assimetria: multiplicar dois primos grandes é rápido, mas fatorar o produto de volta nesses primos é inviável nos tamanhos reais de chave[^factoring]. A geração das chaves tem cinco passos; a coluna da direita os acompanha com números de brinquedo.

| Passo | Regra | Exemplo |
|---|---|---|
| 1. Escolha dois primos | `p`, `q`, secretos | `p = 61`, `q = 53` |
| 2. Módulo | `n = p × q`, público | `n = 3233` |
| 3. Totiente | `φ(n) = (p − 1)(q − 1)`, secreto | `φ(n) = 60 × 52 = 3120` |
| 4. Expoente público | `1 < e < φ(n)` com `gcd(e, φ(n)) = 1` | `e = 17` |
| 5. Expoente privado | `d = e⁻¹ mod φ(n)`, isto é, `e × d ≡ 1 (mod φ(n))` | `d = 2753`, pois `17 × 2753 = 46801 = 15 × 3120 + 1` |

O passo 5 é o **algoritmo de Euclides estendido**: divida `φ(n)` por `e`, depois o divisor pelo resto, e assim por diante, escrevendo cada resto como um múltiplo de `e` módulo `φ(n)`. Quando o resto chega a 1, o seu coeficiente é `d`. As mesmas divisões conferem o passo 4: o último resto não nulo é o `gcd(e, φ(n))`. O simulador mostra cada divisão.

Alguns fatos que o exemplo de brinquedo esconde:

- **Tamanhos reais.** `p` e `q` são primos aleatórios de cerca de 1024 bits cada (um `n` de 2048 bits) ou mais, e `e` é quase sempre `65537` (`2¹⁶ + 1`, um primo com apenas dois bits 1, então a cifragem é rápida).
- **λ em vez de φ.** O padrão (RFC 8017[^rfc8017]) calcula `d` módulo `λ(n) = lcm(p − 1, q − 1)`, o que dá um `d` menor que funciona igual: aqui `λ(n) = 780` e `d = 413`.
- **Os primos são guardados, em segredo.** O arquivo da chave privada também guarda `p`, `q` e alguns valores derivados deles, para que a decifragem use o teorema chinês do resto e rode várias vezes mais rápido. Quem descobre `p` ou `q` recalcula `d`, então eles são tão secretos quanto o próprio `d`.
- **Por que funciona.** `(mᵉ)ᵈ = m^(ed) = m^(1 + k·φ(n)) ≡ m (mod n)`, pelo teorema de Euler[^euler] quando `m` não tem fator comum com `n` (e pelo teorema chinês do resto para todo outro `m < n`).

<div class="csim" data-sim="rsa" data-p="61" data-q="53" data-e="17"></div>

!!! tip "Experimente"
    Mantenha p = 61, q = 53, e = 17 e aperte play: n = 3.233, φ(n) = 3.120, e o algoritmo de Euclides estendido acha d = 2.753 em 4 divisões. Agora escolha e = 3: gcd(3, 3.120) = 3, então não existe d. De volta a e = 17, use a chave: cifre 65 → 2.790 e veja-o voltar ao decifrar; digite HELLO e veja as duas letras L darem o mesmo número (L → 2.726). Assine 123 → 2.746 e depois adultere a assinatura. Em *ataque de dicionário*, o atacante acha a nota B em 2 tentativas só com a chave pública; com padding aleatório a mesma nota muda de texto cifrado a cada vez, embora este padding de brinquedo ainda deixe só 60 tentativas. Em *fatorar n*, a divisão por tentativa separa n em 53 × 61 após 27 divisões e recupera d. Um n de 2048 bits exigiria cerca de 10³⁰⁸.

---

## Cifrar e decifrar { #encrypt }

A mensagem é primeiro transformada num inteiro `m` com `0 ≤ m < n`. Então:

- **Cifrar** com a chave pública: `c = mᵉ mod n`
- **Decifrar** com a chave privada: `m = cᵈ mod n`

Com a chave acima, `65¹⁷ mod 3233 = 2790` e `2790²⁷⁵³ mod 3233 = 65`.

Ninguém calcula `2790²⁷⁵³` multiplicando 2.752 vezes. O **square-and-multiply** (elevar ao quadrado e multiplicar) lê o expoente em binário: um quadrado por bit, mais uma multiplicação por bit 1. `17 = 10001₂` custa 4 quadrados e 1 multiplicação; um `d` de 2048 bits custa cerca de 2.048 quadrados, não 2²⁰⁴⁸ multiplicações. Reduzir `mod n` a cada passo mantém todo número abaixo de `n²`.

Aplicar a fórmula diretamente, como acima, é o chamado **RSA de livro-texto** (*textbook RSA*), e ele é inseguro:

- **Determinístico.** O mesmo `m` sempre dá o mesmo `c`. Um atacante que consegue adivinhar as mensagens possíveis ("sim" ou "não", uma nota de A a F) cifra cada palpite com a chave pública e compara: um **ataque de dicionário**. Letra a letra, é uma simples cifra de substituição.
- **Maleável.** Multiplicar um texto cifrado por `2ᵉ mod n` dobra o texto claro escondido: no exemplo, `2790 × 2¹⁷ mod 3233` decifra para `130 = 2 × 65`. Um atacante consegue alterar uma mensagem que não consegue ler.
- **Mensagens pequenas vazam.** Com `e = 3` e uma mensagem curta, `m³` pode ser menor que `n`: aí não há redução, e uma raiz cúbica comum recupera `m`.

A correção é o **padding** com aleatoriedade antes da exponenciação, visto [mais abaixo](#padding).

---

## Assinaturas digitais { #signatures }

A mesma matemática com as chaves trocadas dá assinaturas. Na prática, o que se assina é um **hash** da mensagem, `h = H(m)`: um hash cabe abaixo de `n`, e assiná-lo vale tanto quanto assinar a mensagem inteira.

- **Assinar** com a chave privada: `s = hᵈ mod n`
- **Verificar** com a chave pública: conferir que `sᵉ mod n = h`

Com a chave acima, `h = 123` dá `s = 123²⁷⁵³ mod 3233 = 2746`, e `2746¹⁷ mod 3233 = 123`. Mude um bit da mensagem ou de `s` e a conferência falha; produzir um `s` válido para outra mensagem exige `d`.

É assim que funciona um JWT assinado com **`RS256`** ou **`PS256`**[^rfc7518]: o serviço de autenticação assina `header.payload` com a sua chave privada, e qualquer serviço que tenha a chave pública verifica o token sem conseguir emitir novos. As chaves públicas costumam ser publicadas como um JWK Set (RFC 7517[^rfc7517]) na URL que o provedor de identidade anuncia como `jwks_uri`.

``` diagram-sim
sequenceDiagram
    participant U as Cliente
    participant A as serviço de autenticação
    participant G as API gateway
    U->>A: POST /login (credenciais)
    A->>A: assina header.payload com a chave PRIVADA (RS256 / PS256)
    A-->>U: JWT = header.payload.assinatura
    U->>G: GET /orders, Authorization: Bearer JWT
    G->>A: busca as chaves públicas (jwks_uri) e as guarda em cache
    G->>G: verifica a assinatura com a chave PÚBLICA
    G-->>U: 200 OK, ou 401 se a assinatura não confere
```

| `alg` do JWT | Esquema de assinatura | Hash |
|---|---|---|
| `RS256` | RSASSA-PKCS1-v1_5 | SHA-256 |
| `PS256` | RSASSA-PSS | SHA-256, MGF1 com SHA-256 |
| `EdDSA` / `Ed25519` | Ed25519 | SHA-512 (dentro do algoritmo) |

!!! warning "Quem escolhe o algoritmo é o verificador, não o token"

    Um verificador que confia no próprio cabeçalho `alg` do token pode ser enganado: com `alg: none` ele pula a conferência, e com `alg: HS256` ele pode usar a chave *pública* RSA como segredo de HMAC, que o atacante também conhece. Configure o algoritmo e a chave esperados no lado que verifica.

---

## Criptografia híbrida { #hybrid }

O RSA não é usado para cifrar grandes volumes de dados. Cada operação é uma exponenciação modular completa sobre números de 2048 bits, ordens de grandeza mais lenta que o AES, que as CPUs modernas executam em hardware. E uma operação carrega muito pouco: com OAEP e SHA-256, uma chave de 2048 bits cifra no máximo `256 − 2 × 32 − 2 = 190` bytes (RFC 8017, §7.1.1[^rfc8017]).

Por isso os sistemas combinam os dois tipos de criptografia, um padrão chamado **criptografia híbrida**: uma chave simétrica aleatória nova cifra os dados, e o algoritmo de chave pública protege só essa chave pequena.

``` diagram
flowchart LR
    doc([documento]) --> aes["AES-256-GCM<br/>com a chave K"]:::comp
    k([chave aleatória K]) --> aes
    k --> oaep["RSA-OAEP com a chave<br/>pública do destinatário"]:::comp
    aes --> ct([documento cifrado])
    oaep --> wk([K, embrulhada])
    ct --> msg["mensagem = K embrulhada + documento cifrado"]
    wk --> msg
```

O destinatário desembrulha `K` com a chave privada e decifra o documento com `K`. O JWE (`alg: RSA-OAEP-256`, `enc: A256GCM`)[^rfc7518], o OpenPGP[^rfc9580] e a "envelope encryption" dos serviços de gerenciamento de chaves na nuvem funcionam assim.

### Como o TLS 1.3 a usa { #tls }

O TLS 1.2 podia fazer exatamente o que está acima: o cliente cifrava um segredo aleatório com a chave RSA do servidor. Esse modo tem uma falha: quem grava o tráfego hoje e rouba a chave privada do servidor depois decifra todas as sessões gravadas, porque uma só chave protegia todas (sem **forward secrecy**). O TLS 1.3 o removeu[^rfc8446]. O handshake ainda usa os dois tipos de criptografia, mas cada um para um trabalho diferente:

- uma troca **Diffie–Hellman efêmera** (normalmente X25519) combina um segredo novo por conexão, que nunca passa pela rede;
- a **chave do certificado** do servidor (RSA-PSS, ECDSA ou Ed25519) só **assina** o handshake, provando quem está do outro lado;
- cifras **simétricas** AEAD (AES-GCM ou ChaCha20-Poly1305) cifram os dados.

``` diagram-sim
sequenceDiagram
    participant C as Cliente
    participant S as Servidor
    C->>S: ClientHello + key_share (valor público X25519 efêmero do cliente)
    S->>C: ServerHello + key_share (valor público X25519 efêmero do servidor)
    Note over C,S: os dois derivam o mesmo segredo (ECDHE) e depois as chaves do handshake (HKDF)
    S->>C: Certificate (chave pública do servidor, assinada por uma CA)
    S->>C: CertificateVerify: assinatura sobre o handshake com a chave PRIVADA
    S->>C: Finished (MAC sobre o handshake)
    C->>S: Finished
    C->>S: requisição HTTP, cifrada com AES-GCM
    S-->>C: resposta HTTP, cifrada com AES-GCM
```

---

## Padding: OAEP e PSS { #padding }

O padding corrige o RSA de livro-texto misturando **aleatoriedade e estrutura** ao número antes da exponenciação. Há dois esquemas padrão, ambos no PKCS #1 v2.2 / RFC 8017[^rfc8017], um para cada uso.

### OAEP — para cifragem { #oaep }

O OAEP (Optimal Asymmetric Encryption Padding), proposto por Bellare e Rogaway[^oaep_paper], combina a mensagem com uma **semente aleatória** por meio de duas máscaras feitas pela MGF1, uma função de geração de máscara construída sobre um hash como o SHA-256 (RFC 8017, §7.1.1):

``` diagram
flowchart TD
    L([rótulo, normalmente vazio]) --> LH["lHash = SHA-256(rótulo)"]
    M([mensagem]) --> DB["DB = lHash ‖ bytes zero ‖ 0x01 ‖ mensagem"]
    LH --> DB
    S([semente aleatória]) --> G1["MGF1(semente)"]
    G1 --> X1["maskedDB = DB ⊕ MGF1(semente)"]
    DB --> X1
    X1 --> G2["MGF1(maskedDB)"]
    G2 --> X2["maskedSeed = semente ⊕ MGF1(maskedDB)"]
    S --> X2
    X1 --> EM["EM = 0x00 ‖ maskedSeed ‖ maskedDB"]
    X2 --> EM
    EM --> E["RSA: c = EMᵉ mod n"]:::comp
    E --> C([texto cifrado])
```

- **Aleatorizado:** cifrar a mesma mensagem duas vezes dá textos cifrados diferentes, então o ataque de dicionário falha. A semente tem o tamanho do hash (32 bytes com SHA-256), valores demais para testar.
- **Tudo ou nada:** mudar qualquer bit do texto cifrado embaralha todo o bloco com padding, e a conferência na decifragem o rejeita; a maleabilidade some.
- **Demonstrado:** o RSA-OAEP é seguro contra ataques de texto cifrado escolhido (IND-CCA2) no modelo de oráculo aleatório.

!!! warning "Nunca use o padding de cifragem PKCS#1 v1.5"

    O antigo padding de cifragem `PKCS1v15` é vulnerável ao ataque de Bleichenbacher (1998)[^bleichenbacher][^bleichenbacher_paper]: um servidor que revela se um texto cifrado tinha padding válido (por uma mensagem de erro, ou só pelo tempo de resposta) deixa um atacante decifrar com muitas consultas. O ataque sempre volta: em 2017, o ROBOT[^robot] o encontrou nas pilhas TLS de grandes fabricantes. Use OAEP.

### PSS — para assinaturas { #pss }

O PSS (Probabilistic Signature Scheme), também de Bellare e Rogaway[^pss_paper], acrescenta um **salt aleatório** ao hash da mensagem antes da operação com a chave privada (RFC 8017, §9.1.1):

``` diagram
flowchart TD
    M([mensagem]) --> MH["mHash = SHA-256(mensagem)"]
    SA([salt aleatório]) --> MP["M' = 8 bytes zero ‖ mHash ‖ salt"]
    MH --> MP
    MP --> H["H = SHA-256(M')"]
    SA --> DB["DB = bytes zero ‖ 0x01 ‖ salt"]
    H --> G["MGF1(H)"]
    G --> X["maskedDB = DB ⊕ MGF1(H)"]
    DB --> X
    X --> EM["EM = maskedDB ‖ H ‖ 0xbc"]
    H --> EM
    EM --> RS["RSA: s = EMᵈ mod n"]:::comp
    RS --> SIG([assinatura])
```

- **Aleatorizado:** com o salt, assinar a mesma mensagem duas vezes dá assinaturas diferentes, ao contrário das assinaturas determinísticas PKCS#1 v1.5.
- **Demonstrado:** o PSS foi projetado com uma prova de segurança justa (*tight*), que reduz forjar uma assinatura a quebrar o próprio RSA.
- **Nos protocolos:** o TLS 1.3 só aceita assinaturas RSA no handshake com PSS (o v1.5 sobrevive só dentro dos certificados)[^rfc8446]; no JWT, `PS256` é PSS e `RS256` é v1.5. O `RS256` não tem ataque prático conhecido e é o mais suportado, mas prefira `PS256` (ou Ed25519) em sistemas novos.

---

## Ed25519 { #ed25519 }

O Ed25519[^ed25519][^eddsa_paper] é um **algoritmo de assinatura de curvas elípticas**, padronizado na RFC 8032[^rfc8032]. Ele não é RSA e não cifra, mas para assinaturas faz o mesmo trabalho com chaves muito menores, e hoje é a escolha preferida em muitos protocolos.

### Por que curvas elípticas { #why-ecc }

A segurança do RSA vem da dificuldade de fatorar. A criptografia de curvas elípticas (ECC)[^ecc] usa outro problema difícil, o **logaritmo discreto em curvas elípticas**: dados os pontos `B` e `A = a · B` numa curva, achar `a`[^elliptic_curves]. Os melhores ataques conhecidos contra ele são muito mais lentos que os contra a fatoração, então uma chave bem menor dá a mesma segurança. O ECDSA[^ecdsa_video], usado pelo Bitcoin e por muitos certificados TLS, é a assinatura de curvas elípticas mais antiga; o Ed25519 é o seu sucessor moderno.

| Algoritmo | Tamanho da chave (bits) | Força de segurança (bits) |
|---|---|---|
| RSA | 2048 | 112 |
| RSA | 3072 | 128 |
| RSA | 7680 | 192 |
| RSA | 15360 | 256 |
| Ed25519 (ou ECDSA P-256) | 256 | ~128 |
| Ed448 | 448 | ~224 |

As linhas de RSA e P-256 seguem o NIST SP 800-57[^sp800_57]; os níveis de Ed25519 e Ed448 são os declarados na RFC 8032[^rfc8032]. Uma chave Ed25519 de 256 bits equivale a uma chave RSA de 3072 bits.

### Como o Ed25519 funciona { #how-ed25519 }

O Ed25519 trabalha na curva de Edwards torcida **edwards25519**, birracionalmente equivalente à curva de Montgomery **Curve25519** de Bernstein[^curve25519][^curve25519_paper] (a mesma curva em outras coordenadas):

```
-x² + y² = 1 − (121665/121666)·x²·y²  (mod p),   p = 2²⁵⁵ − 19
```

Geração de chaves (RFC 8032, §5.1.5):

1. A chave privada `k` são 32 bytes aleatórios.
2. Aplique o hash: `SHA-512(k)` dá 64 bytes. Os 32 primeiros são "ajustados" (*clamped*, alguns bits fixados) e lidos como o escalar secreto `a`; os 32 últimos são um `prefix` guardado para assinar.
3. A chave pública é o ponto da curva `A = a · B`, em que `B` é o ponto base fixo da curva, codificado em 32 bytes.

Assinando uma mensagem `m` (§5.1.6):

1. Derive um nonce determinístico `r = SHA-512(prefix ‖ m)`.
2. Calcule `R = r · B`.
3. Calcule `S = (r + SHA-512(R ‖ A ‖ m) · a) mod ℓ`, em que `ℓ` é a ordem do ponto base.
4. A assinatura é `(R, S)`: 64 bytes.

A verificação confere que `S · B = R + SHA-512(R ‖ A ‖ m) · A`. Para ir mais fundo, veja a palestra do IEEE S&P sobre o Ed25519 na teoria e na prática[^eddsa_video].

### Ed25519 comparado ao RSA { #compare }

| Propriedade | RSA (2048 bits) | Ed25519 |
|---|---|---|
| Chave pública | 256 bytes (o módulo) | 32 bytes |
| Assinatura | 256 bytes | 64 bytes |
| Geração de chaves | Lenta (busca de dois primos grandes) | Rápida (32 bytes aleatórios e um hash) |
| Assinatura (velocidade) | Mais lenta (exponenciação de 2048 bits com `d`) | Rápida |
| Verificação | Rápida (`e = 65537` é pequeno) | Rápida |
| Assinaturas determinísticas | v1.5: sim; PSS: não (salt aleatório) | Sim (nonce derivado da chave e da mensagem) |
| Cifragem | Sim, com OAEP | Não: só assinaturas (o X25519 faz o acordo de chaves) |
| Jeitos de errar | Modo de padding, tamanho da chave, vazamentos de tempo | Poucos: sem padding, projetado para código de tempo constante |

### Determinismo, uma troca { #determinism }

O Ed25519 deriva o seu nonce da chave privada e da mensagem, em vez de pedir a um gerador de números aleatórios. Isso elimina toda uma classe de bugs catastróficos: em 2010, o PlayStation 3 da Sony assinava o seu firmware com ECDSA usando o **mesmo nonce toda vez**, e duas assinaturas bastaram para calcular a chave privada[^ps3]. O preço é que um dispositivo cuja computação pode ser perturbada fisicamente (uma falha injetada enquanto ele assina a mesma mensagem duas vezes) pode vazar a sua chave[^fault]; isso importa para smart cards e hardware embarcado, não para servidores.

### Onde o Ed25519 é usado { #where }

- **SSH:** chaves `ssh-ed25519` (RFC 8709[^rfc8709]); desde o OpenSSH 9.5 (2023), o `ssh-keygen` gera chaves Ed25519 por padrão[^openssh95].
- **TLS 1.3:** `ed25519` é um dos esquemas de assinatura do handshake[^rfc8446], embora a maioria dos certificados públicos ainda use RSA ou ECDSA.
- **JWT:** `alg: "EdDSA"` com uma chave `OKP` e `crv: "Ed25519"` (RFC 8037[^rfc8037]); a RFC 9864 deprecia o `EdDSA` genérico em favor do explícito `alg: "Ed25519"`[^rfc9864].
- **Git:** commits e tags podem ser assinados com uma chave SSH Ed25519 (`git config gpg.format ssh`) ou uma chave OpenPGP Ed25519.
- **X25519**, o irmão do Ed25519 na mesma curva, faz acordo de chaves: o handshake TLS 1.3 acima, WireGuard, Signal e age.

---

## Qual usar { #which }

!!! tip "Qual você deve usar?"

    - **Assinaturas em sistemas novos** (chaves SSH, JWT entre os seus serviços, assinatura no Git): **Ed25519**. Chaves menores, mais rápido, nenhum padding para configurar errado.
    - **Quando precisar de RSA** (um parceiro ou biblioteca sem Ed25519, cifragem para a chave de um destinatário): pelo menos 2048 bits, 3072 para chaves que precisam durar, com **PSS** para assinaturas e **OAEP** para cifragem.
    - **Nunca** RSA de livro-texto, padding de *cifragem* PKCS#1 v1.5, ou chaves de 1024 bits ou menos.
    - **Cifrar dados**: criptografia híbrida por meio de uma biblioteca ou protocolo (TLS, JWE, age, um KMS na nuvem), nunca feita à mão.

Gerando chaves:

```bash
ssh-keygen -t ed25519 -C "you@example.com"                                 # SSH key pair
openssl genpkey -algorithm ED25519 -out ed25519.pem                        # Ed25519 private key
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out rsa.pem  # RSA private key
openssl pkey -in rsa.pem -pubout -out rsa.pub.pem                          # its public key
```

!!! info "O horizonte quântico"

    Um computador quântico grande rodando o algoritmo de Shor quebraria **tanto** o RSA quanto as curvas elípticas. Nenhum existe ainda, mas o tráfego gravado hoje poderia ser decifrado depois, então a migração já começou: o NIST padronizou o ML-KEM (estabelecimento de chaves, FIPS 203[^fips203]) e o ML-DSA (assinaturas, FIPS 204[^fips204]) em 2024, e o seu plano de transição deprecia os algoritmos RSA e de curvas elípticas depois de 2030 e os proíbe depois de 2035[^nistir8547]. Implantações de TLS 1.3 já negociam trocas de chaves híbridas que combinam X25519 com ML-KEM.

---

## Vídeos { #videos }

Eddie Woo resolve o RSA à mão, do mesmo jeito que o simulador acima (em inglês):

=== "Parte 1: calculando um exemplo"

    :fontawesome-brands-youtube:{ .youtube } [The RSA Encryption Algorithm (1 of 2: Computing an Example)](https://youtu.be/4zahvcJ9glg){target="_blank"}

=== "Parte 2: gerando as chaves"

    :fontawesome-brands-youtube:{ .youtube } [The RSA Encryption Algorithm (2 of 2: Generating the Keys)](https://youtu.be/oOcTVTpUsPQ){target="_blank"}

---

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - A criptografia de chave pública resolve a distribuição de chaves: cada parte publica uma chave e guarda uma em segredo, e nada secreto trafega.
    - As chaves RSA vêm de dois primos secretos: `n = p × q` é público, `d = e⁻¹ mod φ(n)` é achado com o algoritmo de Euclides estendido, e fatorar `n` revelaria `d`.
    - A chave pública cifra e verifica; a privada decifra e assina. Um JWT assinado com `RS256`/`PS256` é conferido por todo serviço com a chave pública.
    - O RSA de livro-texto é determinístico e maleável: use OAEP para cifragem e PSS para assinaturas, nunca o padding de cifragem PKCS#1 v1.5.
    - O RSA protege chaves, não dados: a criptografia híbrida o usa para uma chave simétrica pequena, e o TLS 1.3 usa chaves públicas só para combinar chaves (Diffie–Hellman) e assinar o handshake.
    - O Ed25519 dá 128 bits de segurança com chaves de 32 bytes e assinaturas de 64 bytes, nonces determinísticos e nenhum padding: prefira-o para novas assinaturas, e acompanhe a migração pós-quântica.

[^rsa]: [RSA cryptosystem — Wikipedia](https://en.wikipedia.org/wiki/RSA_(cryptosystem)){target="_blank"}
[^euler]: [Euler's theorem — Wikipedia](https://en.wikipedia.org/wiki/Euler%27s_theorem){target="_blank"}
[^bleichenbacher]: [Bleichenbacher's attack — Wikipedia](https://en.wikipedia.org/wiki/Adaptive_chosen-ciphertext_attack#Bleichenbacher's_attack_on_PKCS1_v1.5){target="_blank"}
[^curve25519]: [Curve25519 — Wikipedia](https://en.wikipedia.org/wiki/Curve25519){target="_blank"}
[^ed25519]: [EdDSA / Ed25519 — Wikipedia](https://en.wikipedia.org/wiki/EdDSA){target="_blank"}
[^ecc]: [Elliptic-curve cryptography — Wikipedia](https://en.wikipedia.org/wiki/Elliptic-curve_cryptography){target="_blank"}
[^factoring]: [Integer factorization — Wikipedia](https://en.wikipedia.org/wiki/Integer_factorization){target="_blank"}

[^rsa_paper]: R.L. Rivest, A. Shamir, L. Adleman. "A Method for Obtaining Digital Signatures and Public-Key Cryptosystems." *Communications of the ACM*, 21(2):120–126, 1978. [ACM DL](https://dl.acm.org/doi/10.1145/359340.359342){target="_blank"}
[^dh_paper]: W. Diffie, M.E. Hellman. "New Directions in Cryptography." *IEEE Transactions on Information Theory*, 22(6):644–654, 1976. [PDF](https://ee.stanford.edu/~hellman/publications/24.pdf){target="_blank"}
[^oaep_paper]: M. Bellare, P. Rogaway. "Optimal Asymmetric Encryption." *EUROCRYPT 1994*, LNCS 950, pp. 92–111. [PDF](https://cseweb.ucsd.edu/~mihir/papers/oae.pdf){target="_blank"}
[^pss_paper]: M. Bellare, P. Rogaway. "The Exact Security of Digital Signatures – How to Sign with RSA and Rabin." *EUROCRYPT 1996*, LNCS 1070, pp. 399–416. [PDF](https://cseweb.ucsd.edu/~mihir/papers/pss.pdf){target="_blank"}
[^bleichenbacher_paper]: D. Bleichenbacher. "Chosen Ciphertext Attacks Against Protocols Based on the RSA Encryption Standard PKCS #1." *CRYPTO 1998*, LNCS 1462, pp. 1–12. [PDF](https://archiv.infsec.ethz.ch/education/fs08/secsem/bleichenbacher98.pdf){target="_blank"}
[^robot]: H. Böck, J. Somorovsky, C. Young. "Return Of Bleichenbacher's Oracle Threat (ROBOT)." *USENIX Security 2018*. [robotattack.org](https://robotattack.org/){target="_blank"}
[^curve25519_paper]: D.J. Bernstein. "Curve25519: New Diffie-Hellman Speed Records." *PKC 2006*, LNCS 3958, pp. 207–228. [PDF](https://cr.yp.to/ecdh/curve25519-20060209.pdf){target="_blank"}
[^eddsa_paper]: D.J. Bernstein, N. Duif, T. Lange, P. Schwabe, B.-Y. Yang. "High-Speed High-Security Signatures." *CHES 2011*, LNCS 6917, pp. 124–142. [PDF](https://ed25519.cr.yp.to/ed25519-20110926.pdf){target="_blank"}
[^ps3]: fail0verflow. "Console Hacking 2010: PS3 Epic Fail." 27th Chaos Communication Congress, 2010. [PDF](https://fahrplan.events.ccc.de/congress/2010/Fahrplan/attachments/1780_27c3_console_hacking_2010.pdf){target="_blank"}
[^fault]: Y. Romailler, S. Pelissier. "Practical Fault Attack against the Ed25519 and EdDSA Signature Schemes." *FDTC 2017*, pp. 17–24. [DOI](https://doi.org/10.1109/FDTC.2017.12){target="_blank"}

[^rfc8017]: [RFC 8017 — PKCS #1: RSA Cryptography Specifications v2.2](https://datatracker.ietf.org/doc/html/rfc8017){target="_blank"}
[^rfc8032]: [RFC 8032 — Edwards-Curve Digital Signature Algorithm (EdDSA)](https://datatracker.ietf.org/doc/html/rfc8032){target="_blank"}
[^rfc8037]: [RFC 8037 — CFRG Elliptic Curves for JOSE (OKP key type, Ed25519)](https://datatracker.ietf.org/doc/html/rfc8037){target="_blank"}
[^rfc9864]: [RFC 9864 — Fully-Specified Algorithms for JOSE and COSE](https://datatracker.ietf.org/doc/html/rfc9864){target="_blank"}
[^rfc7517]: [RFC 7517 — JSON Web Key (JWK)](https://datatracker.ietf.org/doc/html/rfc7517){target="_blank"}
[^rfc7518]: [RFC 7518 — JSON Web Algorithms (JWA)](https://datatracker.ietf.org/doc/html/rfc7518){target="_blank"}
[^rfc8446]: [RFC 8446 — The Transport Layer Security (TLS) Protocol Version 1.3](https://datatracker.ietf.org/doc/html/rfc8446){target="_blank"}
[^rfc4253]: [RFC 4253 — The Secure Shell (SSH) Transport Layer Protocol](https://datatracker.ietf.org/doc/html/rfc4253){target="_blank"}
[^rfc8709]: [RFC 8709 — Ed25519 and Ed448 Public Key Algorithms for the Secure Shell (SSH) Protocol](https://datatracker.ietf.org/doc/html/rfc8709){target="_blank"}
[^rfc9580]: [RFC 9580 — OpenPGP (obsoletes RFC 4880)](https://datatracker.ietf.org/doc/html/rfc9580){target="_blank"}
[^openssh95]: [OpenSSH 9.5 release notes (2023-10-04)](https://www.openssh.org/txt/release-9.5){target="_blank"}
[^sp800_57]: [NIST SP 800-57 Part 1 Rev. 5 — Recommendation for Key Management (Table 2)](https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final){target="_blank"}
[^fips203]: [FIPS 203 — Module-Lattice-Based Key-Encapsulation Mechanism Standard (ML-KEM)](https://csrc.nist.gov/pubs/fips/203/final){target="_blank"}
[^fips204]: [FIPS 204 — Module-Lattice-Based Digital Signature Standard (ML-DSA)](https://csrc.nist.gov/pubs/fips/204/final){target="_blank"}
[^nistir8547]: [NIST IR 8547 — Transition to Post-Quantum Cryptography Standards (2026)](https://csrc.nist.gov/pubs/ir/8547/final){target="_blank"}

[^ecdsa_video]: :simple-youtube: [ECDSA Signatures | How does ECDSA work and what are Elliptic Curves?](https://www.youtube.com/watch?v=e3ugVpBBlhc){target="_blank"}
[^eddsa_video]: :simple-youtube: [Ed25519 Signature Schemes: Theory and Practice](https://www.youtube.com/watch?v=9w7ajCIWg-g){target="_blank"}
[^elliptic_curves]: :simple-youtube: [Elliptic Curves - Computerphile](https://www.youtube.com/watch?v=NF1pwjL9-DE){target="_blank"}
