Os **submódulos** (submodules) do Git permitem incluir um repositório Git dentro de outro, como um subdiretório. Isso é útil quando o seu projeto depende de bibliotecas externas, componentes compartilhados ou subprojetos separados que devem manter o seu próprio histórico de versões, de forma independente.

O repositório principal é chamado de **superprojeto** (superproject), e os repositórios incluídos são os **submódulos**.

Os submódulos ficam **fixados em um commit específico** (e não em uma branch, por padrão), o que garante dependências muito estáveis e reprodutíveis — mas também significa que eles não se atualizam automaticamente.

### Fonte oficial / melhor ponto de partida
A explicação de referência está no livro oficial do Git:  
https://git-scm.com/book/en/v2/Git-Tools-Submodules

Segue um resumo claro e prático de como usá-los em 2026 (os comandos continuam os mesmos dos últimos anos).

## 1. Adicionando um submódulo

```bash
# From inside your main (superproject) repository
git submodule add https://github.com/username/account.git api/account
#               or ssh:  git@github.com:username/account.git api/account

# You can also specify a custom path
git submodule add https://github.com/chaconinc/order.git api/order
```

Esse comando:
- Clona o repositório na pasta indicada
- Adiciona uma entrada em `.gitmodules` (um arquivo que vai para o commit)
- Coloca no stage uma entrada especial "gitlink" no índice (o ponteiro para o commit do submódulo)

Depois de executá-lo, faça o commit da alteração:

```bash
git commit -m "Add Account and Order as submodules"
```

Agora você tem um novo arquivo `.gitmodules`, parecido com este:

```ini
[submodule "api/account"]
    path = api/account
    url = https://github.com/username/account.git
[submodule "api/order"]
    path = api/order
    url = https://github.com/chaconinc/order.git
```

## 2. Clonando um projeto que contém submódulos

Outras pessoas (ou você, em uma máquina nova) precisam de passos extras:

```bash
git clone --recursive https://github.com/yourname/yourproject.git
```

Isso clona tudo, inclusive todos os submódulos.

**Alternativa** (se você já clonou da forma normal):

```bash
git submodule init
git submodule update
# or more commonly in one line:
git submodule update --init --recursive
```

A flag `--recursive` é muito importante se os seus submódulos tiverem, eles próprios, submódulos.

### 3. Trabalhando dentro de um submódulo / atualizando-o

```bash
cd api/account          # go into the submodule folder

git checkout main        # or whatever branch you want
git pull origin main

# Now you're on a branch and can make changes
# After you're done developing → commit & push inside the submodule
cd ..                    # back to superproject

git add api/account api/order     # record the new commit hash
git commit -m "Update submodules to latest main"
git push
```

### 4. Trazendo atualizações para os submódulos (fluxo mais comum)

Para levar os submódulos até os commits registrados no superprojeto:

```bash
git pull                # normal pull of superproject
git submodule update --init --recursive
```

Para atualizar o superprojeto e todos os submódulos em um único passo (altamente recomendado):

```bash
git pull --recurse-submodules
```

```bash
git submodule update --remote --merge   # or --rebase
# then commit the updated pointer in the superproject
git add .
git commit -m "Update all submodules to latest"
```

### 5. Referência rápida — comandos mais úteis

| O que você quer fazer                        | Comando                                                  |
|----------------------------------------------|----------------------------------------------------------|
| Adicionar um novo submódulo                  | `git submodule add <url> [path]`                         |
| Clonar o repositório + todos os submódulos   | `git clone --recursive <url>`                            |
| Inicializar + baixar os submódulos após um clone normal | `git submodule update --init --recursive`     |
| Atualizar para os commits registrados        | `git submodule update --recursive`                       |
| Fazer pull do superprojeto + atualizar os submódulos | `git pull --recurse-submodules`                  |
| Atualizar os submódulos para a versão mais recente do remoto | `git submodule update --remote [--merge or --rebase]` |
| Executar um comando em cada submódulo        | `git submodule foreach 'git status'`                     |
| Remover um submódulo (Git moderno)           | `git submodule deinit -f path/to/sub`<br>`rm -rf .git/modules/path/to/sub`<br>`git rm -f path/to/sub` |

### Avisos importantes e boas práticas (estilo 2024–2026)

- Os submódulos são **estáticos** de propósito — eles não vão surpreender você mudando sozinhos.
- Hoje, muitas equipes preferem **subtree**, **monorepo**, **gerenciadores de pacotes** (npm, cargo, go modules etc.) ou **Git worktrees** em vez de submódulos, sempre que possível.
- Documente sempre no README como clonar:  
  `git clone --recursive …`  
  ou  
  `git clone … && git submodule update --init --recursive`
- Evite fazer alterações diretamente na pasta do submódulo, a menos que você realmente pretenda contribuir com o repositório de origem (upstream).
- Use `--recursive` quase sempre — submódulos aninhados são comuns.
- Se muita gente reclamar dos submódulos → considere as alternativas.

---

Conteúdo criado pelo [Grok](https://grok.com) e editado para a disciplina.
