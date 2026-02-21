
To start the hands-on exercises, we need to set up our environment. This includes installing necessary tools, configuring our workspace, and ensuring we have access to the required resources.

To set up your development environment, check the appendix [Development Setup](../../appendix/development-setup.md).

After that your environment should be ready to start the exercises. We should create a root repository, to made easy to access the other microservices repositories and also the documentation.

## Root Repository

The root repository will serve as the central point for accessing all other microservices repositories and the documentation. It will help in organizing the project structure and managing dependencies efficiently.

To better organize the projet, we propose to create a new organization in GitHub, called something like `<username>-studies`, and then create the root repository inside this organization, as well as the other microservices repositories. This way, we can easily manage access permissions and collaborate with other team members. Also, we can use the project management features of GitHub, such as issues and pull requests, to track progress and coordinate work across the different repositories.

!!! tip "Documentation Hosting"

    Additionally, we can use GitHub Pages to host the documentation for the project.

Steps:

1. Create a new repository called `platform` inside the organization, and then clone it to your local machine. This repository will serve as the root repository for our project.

2. Inside this root repository, we can create a directory structure to organize our microservices and documentation. For example:

    ``` { .tree title="Root Directory Structure"}
    platform/
        api/
        docs/
            index.md
        web/
        docker/
        .gitignore
        README.md
    ```

!!! example "BONUS: MkDocs with Material"

    You can use [MkDocs with Material](https://squidfunk.github.io/mkdocs-material/){target="_blank"} for the documentation, and then host it using GitHub Pages. This will allow us to have a well-structured and visually appealing documentation site that is easily accessible to all team members.

    To set up mkdocs with material, you can copy the configuration from the template repository and customize it according to your project's needs.

    Copy into the root repository the following files from the template repository: [mkdocs.yml](./mkdocs.yml){download="mkdocs.yml"} and [requirements.txt](./requirements.txt){download="requirements.txt"}

    The resulting directory structure will look like this:

    ``` { .tree title="Root Directory Structure"}
    platform/
        api/
        docs/
            index.md
        web/
        docker/
        .gitignore
        README.md
        mkdocs.yml
        requirements.txt
    ```

    After setting up the mkdocs configuration, you can build and serve the documentation locally using the following commands:

    === ":simple-apple: Mac/:simple-linux: Linux"

        ``` bash
        python3 -m venv venv
        source venv/bin/activate
        python3 -m pip install --no-cache-dir -r requirements.txt --upgrade
        mkdocs build
        mkdocs serve
        ```

    === ":material-microsoft-windows: Windows"

        ``` bash
        python -m venv venv
        venv\Scripts\activate
        python -m pip install --no-cache-dir -r requirements.txt --upgrade
        mkdocs build
        mkdocs serve
        ```

    This will start a local development server, and you can access the documentation by navigating to [`http://127.0.0.1:8000`](http://127.0.0.1:8000){target="_blank"} in your web browser.