You will spend much of this course in a terminal: `git`, `docker`, `kubectl`, `mvn`. A better shell makes that faster and less error-prone. This page sets up three layers:

- **zsh**: a shell, like bash, with better completion and a large plugin ecosystem. It is the default shell on macOS since Catalina (10.15).
- **Oh My Zsh**[^omz]: a framework that manages your zsh configuration, with hundreds of bundled plugins and themes.
- **Plugins**: small add-ons that each solve one annoyance (see [below](#plugins)).

## Install { #install }

=== ":simple-linux: Linux"

    ``` shell
    sudo apt install zsh
    chsh -s $(which zsh)
    sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
    ```

=== ":simple-apple: macOS"

    zsh is already the default shell, so only Oh My Zsh is needed:

    ``` shell
    sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
    ```

=== ":material-microsoft-windows: Windows (WSL)"

    zsh and Oh My Zsh do not run in PowerShell or `cmd`. Use them inside **WSL** (see [Development setup](development-setup.md#docker)): open your Ubuntu terminal and follow the Linux steps there.

    ``` shell
    sudo apt install zsh
    chsh -s $(which zsh)
    sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
    ```

`chsh` changes your login shell; it takes effect in the next terminal you open. Oh My Zsh also needs `git` and `curl`.

## Plugins { #plugins }

| Plugin | What it gives you |
|:-------|:------------------|
| `git` (bundled) | Short aliases for common Git commands: `gst` = `git status`, `gco` = `git checkout`, `gp` = `git push`… |
| `zsh-autosuggestions` | Suggests the rest of the command from your history, in gray, as you type; press **→** to accept it. |
| `zsh-syntax-highlighting` | Colors the command line as you type: a command that does not exist turns red before you press Enter. |
| `fzf` (bundled, needs the `fzf` program) | Fuzzy search: **Ctrl+R** searches your history, **Ctrl+T** inserts a file path, **Alt+C** jumps to a folder. |

`git` and `fzf` come with Oh My Zsh; the other two, and the `fzf` program itself, are downloaded once:

``` shell
git clone https://github.com/zsh-users/zsh-syntax-highlighting ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting
git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
git clone --depth 1 https://github.com/junegunn/fzf.git ~/.fzf && ~/.fzf/install
```

## Configure { #configure }

Edit the file `~/.zshrc` in your home folder:

``` shell
nano ~/.zshrc
```

Set the theme and the plugins. Keep `zsh-syntax-highlighting` **last**: it must be loaded after the plugins that change the command line.

``` properties title="~/.zshrc"
ZSH_THEME="afowler"
plugins=(
	git
	fzf
	zsh-autosuggestions
	zsh-syntax-highlighting
)
```

Open a new terminal (or run `source ~/.zshrc`) to apply. Other themes are listed in the Oh My Zsh wiki[^themes].

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - **zsh** is the shell, **Oh My Zsh** manages its configuration, and **plugins** add features one by one.
    - Autosuggestions and fuzzy history search (**Ctrl+R**) save the most typing; syntax highlighting catches typos before you run them.
    - On Windows, run all of it inside **WSL**, the same Linux environment Docker uses.

[^omz]: [Oh My Zsh](https://ohmyz.sh/){:target="_blank"} and its [README](https://github.com/ohmyzsh/ohmyzsh){:target="_blank"}.
[^themes]: [Oh My Zsh themes](https://github.com/ohmyzsh/ohmyzsh/wiki/Themes){:target="_blank"}.
