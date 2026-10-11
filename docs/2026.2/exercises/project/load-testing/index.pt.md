
## Testes de carga

Os testes de carga são uma parte importante do desenvolvimento de software, pois ajudam a garantir que sua aplicação possa lidar com o tráfego esperado. Existem várias ferramentas disponíveis para realizar testes de carga, incluindo Apache JMeter, Gatling e Locust.

[Kubernetes - HPA - Increase the load](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale-walkthrough/#increase-load){target="_blank"}

!!! info "A FAZER"

    Faça um teste de carga na sua aplicação Spring Boot. Grave um vídeo do teste de carga, mostrando:
    - O teste de carga em execução;
    - HPA (Horizontal Pod Autoscaler) em execução.

    !!! tip "Dicas"

    - No link do HPA, você encontrará um exemplo de teste de carga. Ele aponta para um Apache httpd, mas você pode adaptá-lo para o seu projeto Spring Boot;
    - Um endereço de exemplo para o teste de carga é: `http://<dns-name>/info`, pois o `gateway` possui um endpoint `/info` que retorna informações sobre a aplicação. Você pode usar esse endpoint para testar a carga da sua aplicação.

    !!! example "Exemplo de HPA"

    Abra três janelas de terminal, uma para cada aba abaixo.


    === "1. Criar o HPA"

        Crie o HPA (Horizontal Pod Autoscaler) para o deployment `gateway`. O HPA vai escalar automaticamente o número de pods do deployment com base no uso de CPU.

        ``` { .bash .copy }
        kubectl autoscale deployment gateway --cpu-percent=50 --min=1 --max=10
        ```

        Verifique o status do HPA:

        ``` { .bash .copy }
        kubectl get hpa                                                       
        NAME      REFERENCE            TARGETS       MINPODS   MAXPODS   REPLICAS   AGE
        gateway   Deployment/gateway   cpu: 1%/50%   1         10        1          66s
        ```

        Acompanhe o status do HPA:

        ``` { .bash .copy }
        watch -n 1 'kubectl get hpa'
        ```

        ---

        Ao final do teste, remova o HPA:

        ``` { .bash .copy }
        kubectl delete hpa gateway
        ```

    === "2. Monitorar os pods"

        Abra outra janela de terminal e monitore os pods do deployment `gateway`:

        ``` { .bash .copy }
        watch -n 1 'kubectl get pods -l app=gateway'
        ```

    === "3. Executar o teste de carga"

        Abra outra janela de terminal e execute o teste de carga contra o deployment `gateway`. Isso simula uma carga alta na aplicação, fazendo o HPA escalar o número de pods do deployment.

        ``` { .bash .copy }
        kubectl run -i --tty load-generator --rm --image=busybox:1.28 --restart=Never -- /bin/sh -c "while sleep 0.01; do wget -q -O- http://gateway/health-check; done"
        ```

        No comando acima, o `wget` é usado para enviar requisições ao endpoint `/info` do deployment `gateway`. O laço `while` continua enviando requisições até você interrompê-lo (por exemplo, pressionando `Ctrl+C`). O intervalo entre as requisições é de 0,01 segundo, o que simula uma carga alta na aplicação. Tente aumentar e diminuir o intervalo para ver como o HPA reage a cargas diferentes.
