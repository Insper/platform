
## EKS Setup

Amazon Elastic Kubernetes Service (EKS) is a managed service that makes it easy to run Kubernetes on AWS without having to install and operate your own Kubernetes control plane or worker nodes. EKS takes care of the high availability and scalability of the Kubernetes control plane, letting you focus on deploying and managing your applications.

[EKS](https://docs.aws.amazon.com/latest/userguide/getting-started.html){target="_blank"}

!!! danger "Usage Cost"

    The cost of using EKS can vary depending on the region and the services used. It is important to monitor costs and optimize resource usage to avoid surprises on the bill. You can use the AWS pricing calculator to estimate your project's costs.

    **CAUTION**: the EC2 instance type is one of the main factors affecting the cost of EKS. Larger, more powerful instances cost more, while smaller, less powerful instances cost less. In addition, the use of extra resources, such as block storage and load balancers, can also increase costs[^1].


!!! info "TO DO"

    Create an EKS cluster and deploy the Spring Boot application to the cluster. You can use the AWS CLI or the AWS console to create and manage your EKS cluster.

    To implement the database, you can use Amazon RDS (Relational Database Service) or Amazon DynamoDB, depending on your project's needs. 

!!! tip "Roadmap"

    **This roudmap is not complete and may not cover all the steps you need to take to configure your AWS environment. It is a good start to help you understand the steps you need to take to configure your AWS environment. You can find more information about each step in the AWS documentation.**

    Create an AWS account and configure the AWS CLI. You can use the AWS CLI to manage your AWS services from the command line.
    
    === "1. Create EKS Role"

        ![](role/01.png){ width=100% }
        ![](role/02.png){ width=100% }
        ![](role/03.png){ width=100% }

    === "2. Create a VPC"

        Overview of the VPC:

        ``` mermaid-sim
        flowchart TB
        subgraph Region
            direction LR
            subgraph Zone A
            direction LR
            subgraph subpri1["Subnet Private"]
                direction TB
                poda1["pod 1"]
                poda2["pod 2"]
                poda3["pod 3"]
            end
            subgraph subpub1["Subnet Public"]
                loadbalancea["Load Balance"]
            end
            end
            subgraph Zone B
            direction LR
            subgraph subpri2["Subnet Private"]
                direction TB
                podb1["pod 1"]
                podb2["pod 2"]
                podb3["pod 3"]
            end
            subgraph subpub2["Subnet Public"]
                loadbalanceb["Load Balance"]
            end
            end
            User --> loadbalancea
            loadbalancea --> poda1
            loadbalancea --> poda2
            loadbalancea --> poda3
            User --> loadbalanceb
            loadbalanceb --> podb1
            loadbalanceb --> podb2
            loadbalanceb --> podb3
        end
        ```

        Create a VPC with the following configuration, including 2 public and 2 private subnets. The public subnets will be used for the load balancers, and the private subnets will be used for the pods. The VPC should be created in the same region as the EKS cluster.

        To create the VPC, use the AWS CloudFormation with the template file: [amazon-eks-vpc-private-subnets.yaml](amazon-eks-vpc-private-subnets.yaml){: download="amazon-eks-vpc-private-subnets.yaml"} (download it and upload it as a CloudFormation template).

        ![](vpc/01.png){ width=100% }
        ![](vpc/02.png){ width=100% }
        ![](vpc/03.png){ width=100% }


    === "3. Create EKS Cluster"

        ![](cluster/01.png){ width=100% }
        ![](cluster/02.png){ width=100% }
        ![](cluster/03.png){ width=100% }

        !!! warning "Pay Attention"
    
            The EKS cluster will take a few minutes to be created. You can check the status of the cluster in the AWS console. Once the cluster is created, you can access it using the AWS CLI or kubectl.
        
            Notice that there no nodes on cluster also, because only the Control Pane had been created, there is no exist a node for the worker nodes.

    === "4. Create a Role for the Node Group"

        ![](nodegroup-role/01.png){ width=100% }

        ---

        Add Permissions to the role:

        - AmazonEKS_CNI_Policy
        - AmazonEKSWorkerNodePolicy
        - AmazonEC2ContainerRegistryReadOnly

        ---

        ![](nodegroup-role/02.png){ width=100% }
        ![](nodegroup-role/03.png){ width=100% }


    === "5. Define the Node Group"

        ![](nodegroup/01.png){ width=100% }
        ![](nodegroup/02.png){ width=100% }

        **Define the Configuration of machine type**

        ![](nodegroup/03.png){ width=100% }

        Only private subnets:

        ![](nodegroup/04.png){ width=100% }


    === "6. Access the EKS Cluster"

        [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html){target="_blank"}

        On terminal, after that it had been set up the aws cli.

        ``` shell
        aws configure
        ```

        See the configuration that was set up:

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

        Set up the kube-config to point to the remote aws eks cluster.

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

        !!! tip "Nice commands"

        ``` bash
        kubectl config get-contexts
        ```

        ``` bash
        kubectl config set-context [NAME]
        ```

[^1]: [AWS Pricing Calculator](https://calculator.aws/#/){target="_blank"}
