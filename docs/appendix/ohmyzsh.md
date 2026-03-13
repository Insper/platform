
Install:

=== ":simple-linux: Linux"

    ``` shell
    sudo apt install zsh
    chsh -s $(which zsh)
    sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
    ```

=== ":simple-apple: MacOS"

    ``` shell
    brew install zsh
    chsh -s $(which zsh)
    sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
    ```

Plugins:

``` shell
git clone https://github.com/zsh-users/zsh-syntax-highlighting ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting
git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
git clone --depth 1 https://github.com/junegunn/fzf.git ~/.fzf && ~/.fzf/install
```

Edit the file `~/.zshrc` at home's folder:

``` shell
nano ~/.zshrc
```


``` properties title="~/.zshrc"
ZSH_THEME="afowler"
plugins=(
	git
	zsh-syntax-highlighting
	zsh-autosuggestions
	fzf
)
```



[^1]: [Oh My Zsh](https://ohmyz.sh/){target='_blank'}