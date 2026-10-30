Você vai passar boa parte desta disciplina num terminal: `git`, `docker`, `kubectl`, `mvn`. Um shell melhor deixa isso mais rápido e menos sujeito a erros. Esta página monta três camadas:

- **zsh**: um shell, como o bash, com um autocompletar melhor e um grande ecossistema de plugins. É o shell padrão do macOS desde o Catalina (10.15).
- **Oh My Zsh**[^omz]: um framework que gerencia a sua configuração do zsh, com centenas de plugins e temas incluídos.
- **Plugins**: pequenos complementos que resolvem, cada um, um incômodo (veja [abaixo](#plugins)).

## Instalação { #install }

=== ":simple-linux: Linux"

    ``` shell
    sudo apt install zsh
    chsh -s $(which zsh)
    sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
    ```

=== ":simple-apple: macOS"

    O zsh já é o shell padrão, então só falta o Oh My Zsh:

    ``` shell
    sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
    ```

=== ":material-microsoft-windows: Windows (WSL)"

    O zsh e o Oh My Zsh não rodam no PowerShell nem no `cmd`. Use-os dentro do **WSL** (veja [Configuração do ambiente](development-setup.md#docker)): abra o seu terminal do Ubuntu e siga ali os passos do Linux.

    ``` shell
    sudo apt install zsh
    chsh -s $(which zsh)
    sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
    ```

O `chsh` troca o seu shell de login; a mudança vale a partir do próximo terminal que você abrir. O Oh My Zsh também precisa do `git` e do `curl`.

## Plugins { #plugins }

| Plugin | O que ele oferece |
|:-------|:------------------|
| `git` (incluído) | Atalhos curtos para comandos Git comuns: `gst` = `git status`, `gco` = `git checkout`, `gp` = `git push`… |
| `zsh-autosuggestions` | Sugere o resto do comando a partir do seu histórico, em cinza, enquanto você digita; aperte **→** para aceitar. |
| `zsh-syntax-highlighting` | Colore a linha de comando enquanto você digita: um comando que não existe fica vermelho antes de você apertar Enter. |
| `fzf` (incluído, precisa do programa `fzf`) | Busca aproximada (fuzzy): **Ctrl+R** busca no histórico, **Ctrl+T** insere o caminho de um arquivo, **Alt+C** entra numa pasta. |

O `git` e o `fzf` vêm com o Oh My Zsh; os outros dois, e o próprio programa `fzf`, são baixados uma vez:

``` shell
git clone https://github.com/zsh-users/zsh-syntax-highlighting ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting
git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
git clone --depth 1 https://github.com/junegunn/fzf.git ~/.fzf && ~/.fzf/install
```

## Configuração { #configure }

Edite o arquivo `~/.zshrc` na sua pasta pessoal:

``` shell
nano ~/.zshrc
```

Defina o tema e os plugins. Deixe o `zsh-syntax-highlighting` por **último**: ele precisa ser carregado depois dos plugins que mexem na linha de comando.

``` properties title="~/.zshrc"
ZSH_THEME="afowler"
plugins=(
	git
	fzf
	zsh-autosuggestions
	zsh-syntax-highlighting
)
```

Abra um terminal novo (ou rode `source ~/.zshrc`) para aplicar. Outros temas estão listados na wiki do Oh My Zsh[^themes].

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - O **zsh** é o shell, o **Oh My Zsh** gerencia a configuração dele e os **plugins** acrescentam recursos um a um.
    - As sugestões automáticas e a busca aproximada no histórico (**Ctrl+R**) são o que mais poupa digitação; o realce de sintaxe pega erros de digitação antes de você executar.
    - No Windows, rode tudo isso dentro do **WSL**, o mesmo ambiente Linux que o Docker usa.

[^omz]: [Oh My Zsh](https://ohmyz.sh/){:target="_blank"} e o seu [README](https://github.com/ohmyzsh/ohmyzsh){:target="_blank"}.
[^themes]: [Temas do Oh My Zsh](https://github.com/ohmyzsh/ohmyzsh/wiki/Themes){:target="_blank"}.
