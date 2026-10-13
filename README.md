## Setup

Para utilizar o código deste repositório, siga as instruções a seguir:

Crie um ambiente virtual do Python (o Zensical requer Python 3.10 ou superior):

``` shell
python3.12 -m venv env
```

Ative o ambiente virtual (**você deve fazer isso sempre que for executar algum script deste repositório**):

``` shell
source ./env/bin/activate
```

Instale as dependências com:

``` shell
pip3 install -r requirements.txt
```

## Deployment

O material utiliza o [Zensical](https://zensical.org/) para gerar a documentação (configuração em `zensical.toml`). Para visualizar a documentação, execute o comando:

``` shell
zensical-i18n serve
```

O site tem dois idiomas, gerados pelo [zensical-i18n](https://github.com/hsandmann/zensical-i18n): inglês (padrão) e português do Brasil. Cada página `X.md` pode ter a tradução `X.pt.md` ao lado. Para gerar os dois idiomas e para visualizar a versão em português:

``` shell
zensical-i18n build
zensical-i18n serve --lang pt
```

A publicação no GitHub Pages é feita pelo CI a cada push na `main`: ele executa `zensical-i18n build --clean` (inglês em `site/`, português em `site/pt/`) e publica a pasta `site/` no branch `gh-pages`.
