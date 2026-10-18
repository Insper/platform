## Setup

Para utilizar o código deste repositório, siga as instruções a seguir:

O projeto usa o [uv](https://docs.astral.sh/uv/) para gerenciar o Python e as dependências (`pyproject.toml` e `uv.lock`). Instale o uv uma vez:

``` shell
curl -LsSf https://astral.sh/uv/install.sh | sh    # ou: brew install uv
```

Crie o ambiente (`.venv/`, com o Python 3.12 de `.python-version`) e instale as dependências travadas no `uv.lock`:

``` shell
uv sync
```

Não é preciso ativar o ambiente: rode os comandos com `uv run`. Para adicionar uma dependência, use `uv add <pacote>` (atualiza o `pyproject.toml` e o `uv.lock`).

## Deployment

O material utiliza o [Zensical](https://zensical.org/) para gerar a documentação (configuração em `zensical.toml`). Para visualizar a documentação, execute o comando:

``` shell
uv run zensical-i18n serve
```

O site tem dois idiomas, gerados pelo [zensical-i18n](https://github.com/hsandmann/zensical-i18n): inglês (padrão) e português do Brasil. Cada página `X.md` pode ter a tradução `X.pt.md` ao lado. Para gerar os dois idiomas e para visualizar a versão em português:

``` shell
uv run zensical-i18n build
uv run zensical-i18n serve --lang pt
```

A publicação no GitHub Pages é feita pelo CI a cada push na `main`: ele executa `uv sync --frozen` e `uv run zensical-i18n build --clean` (inglês em `site/`, português em `site/pt/`) e publica a pasta `site/` no branch `gh-pages`.
