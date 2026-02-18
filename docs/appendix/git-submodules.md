Git **submodules** allow you to include one Git repository inside another as a subdirectory. This is useful when your project depends on external libraries, shared components, or separate sub-projects that should maintain their own independent version history.

The main repository is called the **superproject**, and the included repositories are **submodules**.

Submodules are **pinned to a specific commit** (not a branch by default), which gives very stable and reproducible dependencies — but it also means they don't update automatically.

### Official / Best Starting Point
The canonical explanation is in the official Git book:  
https://git-scm.com/book/en/v2/Git-Tools-Submodules

Here is a clear, practical summary of how to use them in 2026 (commands are still the same as in recent years).

## 1. Adding a submodule

```bash
# From inside your main (superproject) repository
git submodule add https://github.com/username/account.git api/account
#               or ssh:  git@github.com:username/account.git api/account

# You can also specify a custom path
git submodule add https://github.com/chaconinc/order.git api/order
```

This does:
- Clones the repository into the specified folder
- Adds an entry to `.gitmodules` (a file that gets committed)
- Stages a special "gitlink" entry in the index (the submodule commit pointer)

After running this, commit the change:

```bash
git commit -m "Add Account and Order as submodules"
```

You now have a new file `.gitmodules` looking something like this:

```ini
[submodule "api/account"]
    path = api/account
    url = https://github.com/username/account.git
[submodule "api/order"]
    path = api/order
    url = https://github.com/chaconinc/order.git
```

## 2. Cloning a project that contains submodules

Other people (or you on a new machine) need extra steps:

```bash
git clone --recursive https://github.com/yourname/yourproject.git
```

This clones everything, including all submodules.

**Alternative** (if you already cloned normally):

```bash
git submodule init
git submodule update
# or more commonly in one line:
git submodule update --init --recursive
```

The `--recursive` flag is very important if your submodules contain submodules themselves.

### 3. Working inside / updating a submodule

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

### 4. Pulling updates to submodules (most common workflow)

To bring submodules up to the commits recorded in the superproject:

```bash
git pull                # normal pull of superproject
git submodule update --init --recursive
```

If you want to update submodules to latest remote (and record new commits):

```bash
git submodule update --remote --merge   # or --rebase
# then commit the updated pointer in the superproject
git add .
git commit -m "Update all submodules to latest"
```

### 5. Quick reference — most useful commands

| What you want to do                          | Command                                                  |
|----------------------------------------------|----------------------------------------------------------|
| Add new submodule                            | `git submodule add <url> [path]`                         |
| Clone repo + all submodules                  | `git clone --recursive <url>`                            |
| Init + fetch submodules after normal clone   | `git submodule update --init --recursive`                |
| Update to recorded commits                   | `git submodule update --recursive`                       |
| Update submodules to latest remote           | `git submodule update --remote [--merge or --rebase]`    |
| Run command in every submodule               | `git submodule foreach 'git status'`                     |
| Remove a submodule (modern Git)              | `git submodule deinit -f path/to/sub`<br>`rm -rf .git/modules/path/to/sub`<br>`git rm -f path/to/sub` |

### Important Warnings & Best Practices (2024–2026 style)

- Submodules are intentionally **static** — they won't surprise you by changing.
- Many teams now prefer **subtree**, **monorepo**, **package managers** (npm, cargo, go modules, etc.), or **Git worktrees** instead of submodules when possible.
- Always document in README how to clone:  
  `git clone --recursive …`  
  or  
  `git clone … && git submodule update --init --recursive`
- Avoid making changes directly in the submodule folder unless you really intend to contribute upstream.
- Use `--recursive` almost always — nested submodules are common.
- If many people complain about submodules → consider alternatives.

---

Content created by [Grok](https://grok.com) and edited for the course.