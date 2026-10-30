# 2. Imagem e Cadeia de Suprimentos { #2-image-and-supply-chain }

O seu código é uma parte pequena do que roda em produção: a imagem também contém uma distribuição Linux,
um JRE e cerca de cem bibliotecas. A **segurança da cadeia de suprimentos** faz três perguntas sobre toda
imagem antes que ela rode: *o que há dentro dela?* (um SBOM), *ela contém vulnerabilidades conhecidas?*
(um scan) e *ela foi mesmo construída pelo nosso pipeline, a partir deste commit?* (proveniência). O job
`image` do `ci.yaml` responde às três, nesta ordem:

``` diagram-sim
flowchart LR
    build["build (carregada localmente)"] --> sarif["relatório do Trivy -> aba Security"]
    sarif --> gate{"portão do Trivy: CRITICAL com correção?"}
    gate -->|sim| fail[job falha, nada é publicado]
    gate -->|não| sbom["SBOM (Syft, SPDX)"]
    sbom --> push["push para ghcr.io (sha-<commit>, main)"]
    push --> prov["atesta a proveniência (Sigstore)"]
    prov --> attsbom["atesta o SBOM"]
```

O job está em `.github/workflows/ci.yaml` (mostrado completo no [passo 1](../ci/index.md)); esta página
explica os seus steps.

## Build, depois scan, depois push { #build-then-scan-then-push }

| Step | Action | Observações |
|---|---|---|
| nome da imagem | shell | `ghcr.io/<owner>/boxoffice-catalog`, **em minúsculas** (o GHCR rejeita maiúsculas; `${VAR,,}` converte para minúsculas no Bash) |
| `docker/setup-buildx-action` (v4.4.1), `docker/login-action` (v4.6.0) | | BuildKit, e um login no registry do GitHub com o próprio `GITHUB_TOKEN` do job (`packages: write`) |
| `docker/metadata-action` (v6.2.0) | | tags `sha-<sha completo do commit>` (imutável, o que vai para o deploy) e `main` (móvel, para humanos) |
| build com `load: true` | `docker/build-push-action` (v7.4.0) | a imagem vai para o Docker do runner, **ainda não** para o registry; camadas em cache no cache do GitHub (`type=gha`) |
| relatório do Trivy | `aquasecurity/trivy-action` | SARIF enviado para **Security → Code scanning**, nunca falha |
| portão do Trivy | `aquasecurity/trivy-action` | **falha** numa vulnerabilidade `CRITICAL` **que tem correção** (`ignore-unfixed`): algo sobre o que você pode agir agora |
| SBOM | `anchore/sbom-action` (Syft) | `sbom.spdx.json`: todo pacote e versão na imagem |
| push | `docker/build-push-action` (v7.4.0) | as mesmas camadas (cache hit), agora enviadas com as tags |
| atestações | `actions/attest-build-provenance` (v4.2.2), `actions/attest-sbom` (v4.1.0) | declarações assinadas ligadas ao **digest** da imagem, guardadas junto dela no GHCR |

Escanear *antes* do push significa que uma imagem vulnerável nunca é publicada. O portão é estreito de
propósito: falhar em todo `HIGH` sem correção bloquearia todo o trabalho por problemas que ninguém
consegue resolver hoje, e times aprendem a ignorar um portão que está sempre vermelho. O relatório
completo continua listando essas vulnerabilidades.

!!! warning "Fixe actions de terceiros num commit"

    Uma action é código que roda com o seu token. Uma tag como `@v0.36.0` pode ser movida por quem
    controla o repositório da action — o sequestro de tags já foi usado em ataques reais à cadeia de
    suprimentos contra pipelines de CI. Toda action em `ci.yaml` e `deploy.yaml` — incluindo as do
    GitHub e as do Docker — está fixada num **SHA completo de commit**, com a versão num comentário
    (`actions/checkout@3d3c42e… # v7.0.1`). O Dependabot (abaixo) propõe as atualizações como pull
    requests, e o [lab 13](../../13/index.md) confere as fixações com o `zizmor`.

## Mantenha as dependências em dia { #keep-dependencies-moving }

``` yaml title=".github/dependabot.yml"
--8<-- "docs/2027.1/hands-on/11/code/.github/dependabot.yml"
```

O Dependabot abre um pull request quando uma action fixada, uma dependência Maven ou uma imagem base tem
uma nova versão; o seu CI então testa a atualização como qualquer outra mudança.

## Veja funcionar { #see-it-work }

Depois de um push para a `main`, abra **Actions → CI → image (catalog)**. Você deve ver todos os steps
verdes e, no fim, dois links de atestação. Depois:

- **Packages** (a página do seu perfil ou do repositório): `boxoffice-catalog` com as tags `main` e
  `sha-…`. Pacotes novos são **privados**; para o cluster local do passo 4, torne-o público
  (pacote → *Package settings* → *Change visibility*) ou crie um pull secret (o passo 4 mostra como).
- **Security → Code scanning**: os achados do Trivy, um alerta por vulnerabilidade.
- Verifique a proveniência a partir da sua máquina com a GitHub CLI:

    ``` shell
    gh attestation verify oci://ghcr.io/<your-user>/boxoffice-catalog:main --owner <your-user>
    ```

    Você deve ver `✓ Verification succeeded!` e o workflow, o commit e o runner que construíram a
    imagem. Qualquer mudança na imagem — mesmo de um byte — muda o seu digest, e a verificação falha.

??? question "O que o SBOM lhe dá no dia em que uma nova vulnerabilidade é publicada?"

    A lista de toda imagem que contém a biblioteca e a versão afetadas — sem refazer o build nem
    escanear nada de novo. No dia em que o Log4Shell foi divulgado, times com SBOMs responderam "quais
    dos nossos serviços são afetados?" em minutos; os outros levaram dias.

[Próximo: Portão de desempenho](../performance-gate/index.md){ .md-button .md-button--primary }
