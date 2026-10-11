## Configuração do EKS

O Amazon Elastic Kubernetes Service (EKS) é um serviço gerenciado que facilita a execução do Kubernetes na AWS sem a necessidade de instalar e operar seu próprio plano de controle ou nós de trabalho do Kubernetes. O EKS cuida da alta disponibilidade e escalabilidade do plano de controle do Kubernetes, permitindo que você se concentre em implantar e gerenciar seus aplicativos.

[EKS](https://docs.aws.amazon.com/latest/userguide/getting-started.html){target="_blank"}

!!! danger "Custo de uso"

    O custo de uso do EKS pode variar dependendo da região e dos serviços utilizados. É importante monitorar os custos e otimizar o uso dos recursos para evitar surpresas na fatura. Você pode usar a calculadora de preços da AWS para estimar os custos do seu projeto.

    **CUIDADO**: o tipo de instância EC2 é um dos principais fatores que afetam o custo do EKS. Instâncias maiores e mais poderosas custam mais, enquanto instâncias menores e menos poderosas custam menos. Além disso, o uso de recursos adicionais, como armazenamento em bloco e balanceadores de carga, também pode aumentar os custos[^1].


!!! info "A FAZER"

    Crie um cluster EKS e faça o deploy da aplicação Spring Boot no cluster. Você pode usar a AWS CLI ou o console da AWS para criar e gerenciar seu cluster EKS.

    Para implementar a base de dados, você pode usar o Amazon RDS (Relational Database Service) ou o Amazon DynamoDB, dependendo das necessidades do seu projeto. 

!!! tip "Roteiro"

    **Este roteiro não é completo e pode não cobrir todos os passos necessários para configurar o seu ambiente AWS. Ele é um bom começo para ajudar você a entender os passos para configurar o seu ambiente AWS. Você encontra mais informações sobre cada passo na documentação da AWS.**

    Crie uma conta na AWS e configure a AWS CLI. Com a AWS CLI, você gerencia os seus serviços AWS pela linha de comando.
    
    === "1. Criar a role do EKS"

        ![](role/01.png){ width=100% }
        ![](role/02.png){ width=100% }
        ![](role/03.png){ width=100% }

    === "2. Criar uma VPC"

        Visão geral da VPC:

        ``` mermaid-sim
        flowchart TB
        subgraph Region["Região"]
            direction LR
            subgraph Zona A
            direction LR
            subgraph subpri1["Sub-rede privada"]
                direction TB
                poda1["pod 1"]
                poda2["pod 2"]
                poda3["pod 3"]
            end
            subgraph subpub1["Sub-rede pública"]
                loadbalancea["Balanceador de carga"]
            end
            end
            subgraph Zona B
            direction LR
            subgraph subpri2["Sub-rede privada"]
                direction TB
                podb1["pod 1"]
                podb2["pod 2"]
                podb3["pod 3"]
            end
            subgraph subpub2["Sub-rede pública"]
                loadbalanceb["Balanceador de carga"]
            end
            end
            User["Usuário"] --> loadbalancea
            loadbalancea --> poda1
            loadbalancea --> poda2
            loadbalancea --> poda3
            User --> loadbalanceb
            loadbalanceb --> podb1
            loadbalanceb --> podb2
            loadbalanceb --> podb3
        end
        ```

        Crie uma VPC com a configuração a seguir, incluindo 2 sub-redes públicas e 2 sub-redes privadas. As sub-redes públicas serão usadas pelos balanceadores de carga, e as privadas, pelos pods. A VPC deve ser criada na mesma região do cluster EKS.

        Para criar a VPC, use o AWS CloudFormation com o arquivo de template: [amazon-eks-vpc-private-subnets.yaml](amazon-eks-vpc-private-subnets.yaml){: download="amazon-eks-vpc-private-subnets.yaml"} (baixe-o e faça o upload como template do CloudFormation).

        ![](vpc/01.png){ width=100% }
        ![](vpc/02.png){ width=100% }
        ![](vpc/03.png){ width=100% }


    === "3. Criar o cluster EKS"

        ![](cluster/01.png){ width=100% }
        ![](cluster/02.png){ width=100% }
        ![](cluster/03.png){ width=100% }

        !!! warning "Atenção"
    
            O cluster EKS leva alguns minutos para ser criado. Você pode acompanhar o status do cluster no console da AWS. Depois que o cluster for criado, você pode acessá-lo pela AWS CLI ou pelo kubectl.
        
            Note também que o cluster ainda não tem nós: apenas o plano de controle (control plane) foi criado, e ainda não existe nenhum nó de trabalho (worker node).

    === "4. Criar uma role para o node group"

        ![](nodegroup-role/01.png){ width=100% }

        ---

        Adicione as permissões à role:

        - AmazonEKS_CNI_Policy
        - AmazonEKSWorkerNodePolicy
        - AmazonEC2ContainerRegistryReadOnly

        ---

        ![](nodegroup-role/02.png){ width=100% }
        ![](nodegroup-role/03.png){ width=100% }


    === "5. Definir o node group"

        ![](nodegroup/01.png){ width=100% }
        ![](nodegroup/02.png){ width=100% }

        **Defina a configuração do tipo de máquina**

        ![](nodegroup/03.png){ width=100% }

        Somente sub-redes privadas:

        ![](nodegroup/04.png){ width=100% }


    === "6. Acessar o cluster EKS"

        [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html){target="_blank"}

        No terminal, depois de configurar a AWS CLI:

        ``` shell
        aws configure
        ```

        Veja a configuração definida:

        ``` shell
        aws configure list
        ```
        <!-- termynal -->
        ``` shell
        > aws configure list
            Name                    Value             Type    Location
            ----                    -----             ----    --------
        profile                <not set>             None    None
        access_key     ****************TTNI shared-credentials-file    
        secret_key     ****************zAJ1 shared-credentials-file    
            region                us-east-2      config-file    ~/.aws/config
        ```

        Configure o kube-config para apontar para o cluster EKS remoto na AWS.

        ``` shell
        aws eks update-kubeconfig --name eks-store
        ```
        <!-- termynal -->
        ``` shell
        > aws eks update-kubeconfig --name eks-store
        Added new context arn:aws:eks:us-east-2:058264361068:cluster/eks-store to /Users/sandmann/.kube/config
        >
        >
        > kubectl get pods
        No resources found in default namespace.
        >
        >
        > kubectl get nodes
        No resources found
        >
        ```        

        !!! tip "Comandos úteis"

        ``` bash
        kubectl config get-contexts
        ```

        ``` bash
        kubectl config set-context [NAME]
        ```

[^1]: [AWS Pricing Calculator](https://calculator.aws/#/){target="_blank"}
