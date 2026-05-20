
## Testes de Carga

Os testes de carga são uma parte importante do desenvolvimento de software, pois ajudam a garantir que sua aplicação possa lidar com o tráfego esperado. Existem várias ferramentas disponíveis para realizar testes de carga, incluindo Apache JMeter, Gatling e Locust.

[Kubernetes - HPA - Increase the load](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale-walkthrough/#increase-load){target="_blank"}

!!! info "TO DO"

    Faça um teste de carga na sua aplicação Spring Boot. Grave um video do teste de carga, mostrando:
    - O teste de carga em execução;
    - HPA (Horizontal Pod Autoscaler) em execução.

    !!! tip "Dicas"

    - No do link do HPA, você encontrará um exemplo de teste de carga. Ele aponta para um apache httpd, mas você pode adaptá-lo para o seu projeto Spring Boot;
    - Um endereço de exemplo para o teste de carga é: `http://<dns-name>/info`. Pois o `gateway` possui um endpoint `/info` que retorna informações sobre a aplicação. Você pode usar esse endpoint para testar a carga da sua aplicação.

    !!! example "Example of HPA"

    Open three terminal windows, one for each tab below.


    === "1. Create the HPA"

        Create the HPA (Horizontal Pod Autoscaler) for the `gateway` deployment. The HPA will automatically scale the number of pods in the deployment based on CPU usage.

        ``` { .bash .copy }
        kubectl autoscale deployment gateway --cpu-percent=50 --min=1 --max=10
        ```

        Check the status of the HPA:

        ``` { .bash .copy }
        kubectl get hpa                                                       
        NAME      REFERENCE            TARGETS       MINPODS   MAXPODS   REPLICAS   AGE
        gateway   Deployment/gateway   cpu: 1%/50%   1         10        1          66s
        ```

        Watch the HPA status:

        ``` { .bash .copy }
        watch -n 1 'kubectl get hpa'
        ```

        ---

        At the end of the test, delete the HPA:

        ``` { .bash .copy }
        kubectl delete hpa gateway
        ```

    === "2. Monitor the Pods"

        Open another terminal window and monitor the pods in the `gateway` deployment:

        ``` { .bash .copy }
        watch -n 1 'kubectl get pods -l app=gateway'
        ```

    === "3. Run the Load Test"

        Open another terminal window and run the load test against the `gateway` deployment. This will simulate a high load on the application, causing the HPA to scale the number of pods in the deployment.

        ``` { .bash .copy }
        kubectl run -i --tty load-generator --rm --image=busybox:1.28 --restart=Never -- /bin/sh -c "while sleep 0.01; do wget -q -O- http://gateway/health-check; done"
        ```

        In the command above, the `wget` command is used to send requests to the `/info` endpoint of the `gateway` deployment. The `while` loop will continue to send requests until you stop it (e.g., by pressing `Ctrl+C`). The interval between requests is set to 0.01 seconds, which simulates a high load on the application. Try to increase and decrease the interval to see how the HPA reacts to different loads.
