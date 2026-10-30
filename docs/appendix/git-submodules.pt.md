Um **submódulo** (submodule) do Git é um repositório Git colocado dentro de outro repositório como um subdiretório, com o seu próprio histórico, independente[^book]. O repositório de fora é o **superprojeto** (superproject). Nesta disciplina, o caso típico é um projeto que reúne vários microsserviços, cada um no seu repositório (`account`, `order`, `gateway`…), num só lugar onde um único `docker compose up` ou uma única pipeline de CI enxerga todos.

Esta página responde a uma pergunta: **o que o superprojeto guarda de fato**, e como isso explica cada comando — e cada surpresa — do fluxo de trabalho com submódulos?

## O modelo mental: um ponteiro para um commit { #mental-model }

O superprojeto **não** copia os arquivos do submódulo e **não** acompanha uma branch. Ele guarda duas coisas:

- no arquivo **`.gitmodules`**: *de onde* clonar o submódulo (o seu caminho e a sua URL);
- na sua própria árvore, no caminho do submódulo: um **gitlink**, o **hash de um commit** do submódulo.

``` diagram
flowchart LR
    subgraph sup ["superprojeto: store (branch main)"]
        readme["README.md<br/>compose.yaml"]
        gm[".gitmodules<br/>path = api/account<br/>url = …/account.git"]
        link["api/account<br/>gitlink: 12174e7"]:::comp
    end
    subgraph acc ["repositório do submódulo: account"]
        c1["commit a91f3c0"] --> c2["commit 12174e7"]:::tech
        c2 --> c3["commit 83eff0b"]
        br(["branch main"]) -.-> c3
    end
    gm -.->|"de onde clonar"| acc
    link ==>|"fixa exatamente este commit"| c2
```

A equipe do `account` pode continuar fazendo commits na `main`: o superprojeto continua apontando para `12174e7` até que alguém, no superprojeto, **faça o commit de um novo ponteiro**. É por isso que os submódulos são reprodutíveis (um checkout do superprojeto sempre traz o mesmo código) e é por isso que eles nunca se atualizam sozinhos. Dá para ver o gitlink diretamente — o modo `160000` significa "um commit de outro repositório":

```bash
git ls-tree HEAD api/account
# 160000 commit 12174e72e52d514b6256f51f42dee36897ef5261	api/account
```

## Adicionando um submódulo { #add }

```bash
# From inside the superproject
git submodule add https://github.com/username/account.git api/account
#               or ssh:  git@github.com:username/account.git api/account

git submodule add https://github.com/username/order.git api/order
```

Cada `git submodule add`:

- clona o repositório na pasta indicada;
- adiciona uma entrada em `.gitmodules`, um arquivo que vai para o commit;
- coloca no stage o gitlink, o ponteiro para o commit que está no checkout do submódulo.

Faça o commit dos dois, como qualquer outra mudança:

```bash
git commit -m "Add account and order as submodules"
```

O novo `.gitmodules` fica assim:

```ini
[submodule "api/account"]
    path = api/account
    url = https://github.com/username/account.git
[submodule "api/order"]
    path = api/order
    url = https://github.com/username/order.git
```

## O fluxo, passo a passo { #workflow }

Acompanhe uma mudança desde um clone novo até a máquina de um colega. Observe duas coisas: o que há em `api/account/` em cada passo, e para qual repositório vai cada push.

``` diagram-sim
sequenceDiagram
    actor You as Você
    participant W as o seu clone
    participant S as repo store (GitHub)
    participant A as repo account (GitHub)
    actor T as colega
    You->>S: git clone …/store.git (sem --recurse-submodules)
    S-->>W: arquivos + gitlink 12174e7, mas api/account/ está vazia
    You->>W: git submodule update --init
    W->>A: clona o account, faz checkout de 12174e7
    A-->>W: api/account em 12174e7, HEAD destacado (detached)
    You->>W: cd api/account, git switch main, edita, commit 83eff0b
    W->>A: git push (primeiro o submódulo)
    You->>W: cd ../.., git add api/account, git commit
    Note over W: gitlink 12174e7 → 83eff0b
    W->>S: git push (depois o superprojeto)
    T->>S: git pull --recurse-submodules
    S-->>T: gitlink 83eff0b, então api/account fica em 83eff0b
```

Os mesmos passos, em comandos:

```bash
# 1. clone: --recurse-submodules (or --recursive) also clones and checks out every submodule
git clone --recurse-submodules https://github.com/username/store.git

# ...or, if you already cloned without it (api/account/ is empty):
git submodule update --init --recursive

# 2. work inside the submodule: leave the detached HEAD first
cd api/account
git switch main
git pull
# edit, then commit and push in the submodule
git commit -am "Validate e-mail on sign-up"
git push

# 3. record the new pointer in the superproject, then push it
cd ../..
git add api/account
git commit -m "Bump account to 83eff0b"
git push
```

O `--recursive` importa quando os submódulos têm, eles próprios, submódulos. `git diff --submodule=log` mostra quais commits do submódulo uma mudança de ponteiro traz, antes de você fazer o commit.

## Recebendo atualizações { #updates }

Duas perguntas diferentes, dois comandos diferentes:

- **"Quero os commits para os quais o superprojeto aponta"** (depois que outra pessoa atualizou um ponteiro):

    ```bash
    git pull --recurse-submodules
    # if the pull brought a new submodule, also: git submodule update --init --recursive
    ```

- **"Quero mover os ponteiros para o commit mais novo da branch de cada submódulo"** (é você quem atualiza):

    ```bash
    git submodule update --remote --merge   # or --rebase
    # then commit the new pointers in the superproject
    git add api/account api/order
    git commit -m "Bump submodules to latest main"
    ```

## Referência rápida { #reference }

| O que você quer fazer | Comando |
|:--------------------|:--------|
| Adicionar um novo submódulo | `git submodule add <url> [path]` |
| Clonar o repositório e todos os submódulos | `git clone --recurse-submodules <url>` |
| Inicializar e baixar os submódulos após um clone normal | `git submodule update --init --recursive` |
| Fazer checkout dos commits que o superprojeto registra | `git submodule update --recursive` |
| Fazer pull do superprojeto e atualizar os submódulos | `git pull --recurse-submodules` |
| Mover os submódulos para o commit mais recente do remoto | `git submodule update --remote [--merge or --rebase]` |
| Ver o commit de cada submódulo (`-` = não inicializado, `+` = difere do ponteiro) | `git submodule status` |
| Executar um comando em cada submódulo | `git submodule foreach 'git status'` |
| Recusar o push de um ponteiro cujo commit não está num remoto | `git push --recurse-submodules=check` |
| Fazer o push dos submódulos antes, automaticamente | `git push --recurse-submodules=on-demand` |
| Fazer pull, switch, checkout… recursivos por padrão (clone não) | `git config --global submodule.recurse true` |
| Remover um submódulo | `git submodule deinit -f path/to/sub`<br>`git rm -f path/to/sub`<br>`rm -rf .git/modules/path/to/sub` |

## Armadilhas comuns { #pitfalls }

!!! warning "O HEAD destacado (detached HEAD)"
    `git submodule update` faz checkout do **commit fixado**, não de uma branch, então o submódulo fica em estado de *detached HEAD*. Commits feitos ali não pertencem a nenhuma branch e se perdem com facilidade. Antes de editar, rode `git switch main` (ou a branch que você quiser) dentro do submódulo. Se você já fez commits com o HEAD destacado, salve o trabalho com `git switch -c my-fix` antes de mudar para qualquer outro lugar.

!!! danger "Fazer o push do superprojeto antes do submódulo"
    Se você faz o commit de um novo ponteiro e o push só do superprojeto, os seus colegas recebem um gitlink para um commit que só existe na sua máquina. A atualização deles falha:

    ```text
    fatal: remote error: upload-pack: not our ref 28d0def2c3f5d7814c753cdf5e3ebbe5b1f0e9a4
    fatal: Fetched in submodule path 'api/account', but it did not contain 28d0def2c3f5d7814c753cdf5e3ebbe5b1f0e9a4. Direct fetching of that commit failed.
    ```

    Faça sempre o push do submódulo primeiro, ou deixe o Git conferir isso por você: `git config --global push.recurseSubmodules check` (recusa) ou `on-demand` (faz o push dos submódulos antes).

!!! warning "Desfazer a atualização de um colega"
    Depois de um `git pull` simples, o ponteiro mudou, mas a pasta do submódulo não: `git status` mostra `modified: api/account (new commits)`. Um `git add .` descuidado agora faz o commit do commit **antigo** de volta como ponteiro. Rode `git submodule update` (ou faça o pull com `--recurse-submodules`) antes de colocar arquivos no stage.

- **A pasta vazia**: um clone sem `--recurse-submodules` deixa `api/account/` vazia, e o build ou o `docker compose` falha por falta de arquivos. Escreva o comando de clone no README.
- **A CI também precisa dos submódulos**: o `actions/checkout` não os baixa, a menos que você defina `submodules: true` (ou `recursive`), e um submódulo privado precisa de um token que consiga lê-lo.

## Alternativas { #alternatives }

Submódulos servem quando as partes têm donos e ciclos de release separados, e você quer fixar versões exatas. Muitas vezes, algo mais simples serve melhor:

| Abordagem | Como funciona | Bom quando | Custo |
|:---------|:-------------|:----------|:-----|
| **Submódulo** | Ponteiro para um commit de outro repositório | Repositórios independentes que precisam ser reunidos em versões exatas | Comandos extras; fácil esquecer um passo |
| **Subtree** (`git subtree`) | Copia os arquivos do outro repositório (e, se quiser, o histórico) para uma pasta | Quem usa não deve precisar saber de nada especial | Mandar mudanças de volta para a origem é trabalhoso |
| **Monorepo** | Todos os serviços num único repositório | Uma equipe, mudanças que atravessam serviços, uma só CI | O repositório e a CI crescem; exige regras de responsabilidade |
| **Gerenciador de pacotes** (Maven, npm…) | Publicar um artefato versionado (ex.: no GitHub Packages); quem usa declara uma dependência | Bibliotecas compartilhadas | Lançar uma versão a cada mudança |

Para uma biblioteca Java compartilhada, publicar um artefato Maven costuma ser o mais limpo; para um projeto em equipe que reúne microsserviços, monorepo e submódulos funcionam — escolha um e documente.

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - O superprojeto guarda um **gitlink**: o **hash de um commit** do submódulo (modo `160000`), mais a sua URL em `.gitmodules`. Ele nunca acompanha uma branch.
    - Esse ponteiro explica o fluxo: clone com `--recurse-submodules` (ou `update --init`), e um checkout novo é um **HEAD destacado** no commit fixado.
    - Para mudar um submódulo: **mude para uma branch**, faça o commit, **faça o push do submódulo** e depois **faça o commit e o push do novo ponteiro** no superprojeto — nessa ordem.
    - Deixe o Git garantir a ordem com `push.recurseSubmodules` (`check` ou `on-demand`), e faça pull com `--recurse-submodules`.
    - Considere as alternativas — **monorepo**, **subtree**, um **gerenciador de pacotes** — quando os submódulos trazem mais passos do que valor.

[^book]: [Git Tools — Submodules](https://git-scm.com/book/en/v2/Git-Tools-Submodules){:target="_blank"}, no *Pro Git* (há uma [tradução para o português](https://git-scm.com/book/pt-br/v2/Ferramentas-do-Git-Subm%C3%B3dulos){:target="_blank"}), e as páginas de referência [git-submodule](https://git-scm.com/docs/git-submodule){:target="_blank"} e [gitsubmodules](https://git-scm.com/docs/gitsubmodules){:target="_blank"}.
