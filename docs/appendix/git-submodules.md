A Git **submodule** is a Git repository placed inside another repository as a subdirectory, with its own independent history[^book]. The outer repository is the **superproject**. In this course the typical case is a project that assembles several microservices, each in its own repository (`account`, `order`, `gateway`…), into one place where a single `docker compose up` or a single CI pipeline can see them all.

This page answers one question: **what does the superproject actually store**, and how does that explain every command — and every surprise — of the submodule workflow?

## The mental model: a pointer to a commit { #mental-model }

The superproject does **not** copy the submodule's files, and it does **not** follow a branch. It stores two things:

- in the file **`.gitmodules`**: *where* to clone the submodule from (its path and URL);
- in its own tree, at the submodule's path: a **gitlink**, the **hash of one commit** of the submodule.

``` diagram
flowchart LR
    subgraph sup ["superproject: store (branch main)"]
        readme["README.md<br/>compose.yaml"]
        gm[".gitmodules<br/>path = api/account<br/>url = …/account.git"]
        link["api/account<br/>gitlink: 12174e7"]:::comp
    end
    subgraph acc ["submodule repository: account"]
        c1["commit a91f3c0"] --> c2["commit 12174e7"]:::tech
        c2 --> c3["commit 83eff0b"]
        br(["branch main"]) -.-> c3
    end
    gm -.->|"where to clone from"| acc
    link ==>|"pins exactly this commit"| c2
```

The `account` team can keep committing to `main`: the superproject still points to `12174e7` until someone in the superproject **commits a new pointer**. That is why submodules are reproducible (a checkout of the superproject always gets the same code) and why they never update by themselves. You can see the gitlink directly — mode `160000` means "a commit of another repository":

```bash
git ls-tree HEAD api/account
# 160000 commit 12174e72e52d514b6256f51f42dee36897ef5261	api/account
```

## Adding a submodule { #add }

```bash
# From inside the superproject
git submodule add https://github.com/username/account.git api/account
#               or ssh:  git@github.com:username/account.git api/account

git submodule add https://github.com/username/order.git api/order
```

Each `git submodule add`:

- clones the repository into the given folder;
- adds an entry to `.gitmodules`, a file you commit;
- stages the gitlink, the pointer to the commit currently checked out in the submodule.

Commit both, like any other change:

```bash
git commit -m "Add account and order as submodules"
```

The new `.gitmodules` looks like this:

```ini
[submodule "api/account"]
    path = api/account
    url = https://github.com/username/account.git
[submodule "api/order"]
    path = api/order
    url = https://github.com/username/order.git
```

## The workflow, step by step { #workflow }

Follow one change from a fresh clone to a teammate's machine. Watch two things: what is in `api/account/` at each step, and which repository each push goes to.

``` diagram-sim
sequenceDiagram
    actor You
    participant W as your clone
    participant S as store repo (GitHub)
    participant A as account repo (GitHub)
    actor T as teammate
    You->>S: git clone …/store.git (no --recurse-submodules)
    S-->>W: files + gitlink 12174e7, but api/account/ is empty
    You->>W: git submodule update --init
    W->>A: clone account, check out 12174e7
    A-->>W: api/account at 12174e7, detached HEAD
    You->>W: cd api/account, git switch main, edit, commit 83eff0b
    W->>A: git push (the submodule first)
    You->>W: cd ../.., git add api/account, git commit
    Note over W: gitlink 12174e7 → 83eff0b
    W->>S: git push (then the superproject)
    T->>S: git pull --recurse-submodules
    S-->>T: gitlink 83eff0b, so api/account is checked out at 83eff0b
```

The same steps as commands:

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

`--recursive` matters when submodules have submodules of their own. `git diff --submodule=log` shows which submodule commits a pointer change brings in, before you commit it.

## Getting updates { #updates }

Two different questions, two different commands:

- **"Give me the commits the superproject points to"** (after someone else bumped a pointer):

    ```bash
    git pull --recurse-submodules
    # if the pull brought a new submodule, also: git submodule update --init --recursive
    ```

- **"Move the pointers to the newest commit of each submodule's branch"** (you are the one bumping):

    ```bash
    git submodule update --remote --merge   # or --rebase
    # then commit the new pointers in the superproject
    git add api/account api/order
    git commit -m "Bump submodules to latest main"
    ```

## Quick reference { #reference }

| What you want to do | Command |
|:--------------------|:--------|
| Add a new submodule | `git submodule add <url> [path]` |
| Clone the repo and all submodules | `git clone --recurse-submodules <url>` |
| Init and fetch the submodules after a normal clone | `git submodule update --init --recursive` |
| Check out the commits the superproject records | `git submodule update --recursive` |
| Pull the superproject and update the submodules | `git pull --recurse-submodules` |
| Move the submodules to the latest remote commit | `git submodule update --remote [--merge or --rebase]` |
| See each submodule's commit (`-` = not initialized, `+` = differs from the pointer) | `git submodule status` |
| Run a command in every submodule | `git submodule foreach 'git status'` |
| Refuse to push a pointer whose commit is not on a remote | `git push --recurse-submodules=check` |
| Push the submodules first, automatically | `git push --recurse-submodules=on-demand` |
| Make pull, switch, checkout… recurse by default (not clone) | `git config --global submodule.recurse true` |
| Remove a submodule | `git submodule deinit -f path/to/sub`<br>`git rm -f path/to/sub`<br>`rm -rf .git/modules/path/to/sub` |

## Common pitfalls { #pitfalls }

!!! warning "The detached HEAD"
    `git submodule update` checks out the **pinned commit**, not a branch, so the submodule is in a *detached HEAD* state. Commits made there belong to no branch and are easy to lose. Before editing, run `git switch main` (or the branch you want) inside the submodule. If you already committed on a detached HEAD, save the work with `git switch -c my-fix` before switching anywhere else.

!!! danger "Pushing the superproject before the submodule"
    If you commit a new pointer and push only the superproject, your teammates get a gitlink to a commit that exists only on your machine. Their update fails:

    ```text
    fatal: remote error: upload-pack: not our ref 28d0def2c3f5d7814c753cdf5e3ebbe5b1f0e9a4
    fatal: Fetched in submodule path 'api/account', but it did not contain 28d0def2c3f5d7814c753cdf5e3ebbe5b1f0e9a4. Direct fetching of that commit failed.
    ```

    Always push the submodule first, or let Git check it for you: `git config --global push.recurseSubmodules check` (refuses) or `on-demand` (pushes the submodules first).

!!! warning "Undoing a teammate's bump"
    After a plain `git pull`, the pointer moved but the submodule folder did not: `git status` shows `modified: api/account (new commits)`. A careless `git add .` now commits the **old** commit back as the pointer. Run `git submodule update` (or pull with `--recurse-submodules`) before staging.

- **The empty folder**: a clone without `--recurse-submodules` leaves `api/account/` empty, so the build or `docker compose` fails on missing files. Write the clone command in the README.
- **CI needs the submodules too**: `actions/checkout` does not fetch them unless you set `submodules: true` (or `recursive`), and a private submodule needs a token that can read it.

## Alternatives { #alternatives }

Submodules fit when the pieces have separate owners and release cycles, and you want to pin exact versions. Often something simpler fits better:

| Approach | How it works | Good when | Cost |
|:---------|:-------------|:----------|:-----|
| **Submodule** | Pointer to a commit of another repository | Independent repos that must be assembled at exact versions | Extra commands; easy to forget a step |
| **Subtree** (`git subtree`) | Copies the other repository's files (and optionally its history) into a folder | Consumers should not need to know anything special | Pushing changes back upstream is clumsy |
| **Monorepo** | All services in one repository | One team, changes that cross services, one CI | The repository and the CI grow; needs ownership rules |
| **Package manager** (Maven, npm…) | Publish a versioned artifact (e.g. to GitHub Packages); consumers declare a dependency | Shared libraries | Release a version for every change |

For a shared Java library, publishing a Maven artifact is usually the cleanest; for a team project that assembles microservices, a monorepo or submodules both work — pick one and document it.

## Key takeaways { #key-takeaways }

!!! takeaways ""

    - The superproject stores a **gitlink**: the **hash of one commit** of the submodule (mode `160000`), plus its URL in `.gitmodules`. It never follows a branch.
    - That pointer explains the workflow: clone with `--recurse-submodules` (or `update --init`), and a fresh checkout is a **detached HEAD** at the pinned commit.
    - To change a submodule: **switch to a branch**, commit, **push the submodule**, then **commit and push the new pointer** in the superproject — in that order.
    - Let Git guard the order with `push.recurseSubmodules` (`check` or `on-demand`), and pull with `--recurse-submodules`.
    - Consider the alternatives — **monorepo**, **subtree**, a **package manager** — when submodules add more steps than value.

[^book]: [Git Tools — Submodules](https://git-scm.com/book/en/v2/Git-Tools-Submodules){:target="_blank"}, in *Pro Git*, and the reference pages [git-submodule](https://git-scm.com/docs/git-submodule){:target="_blank"} and [gitsubmodules](https://git-scm.com/docs/gitsubmodules){:target="_blank"}.
