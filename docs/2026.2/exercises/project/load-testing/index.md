
## Load Testing

Load tests are an important part of software development, as they help ensure that your application can handle the expected traffic. Several tools are available to run load tests, including Apache JMeter, Gatling and Locust.

[Kubernetes - HPA - Increase the load](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale-walkthrough/#increase-load){target="_blank"}

!!! info "TO DO"

    Run a load test on your Spring Boot application. Record a video of the load test, showing:
    - The load test running;
    - The HPA (Horizontal Pod Autoscaler) running.

    !!! tip "Tips"

    - In the HPA link, you will find an example of a load test. It targets an Apache httpd, but you can adapt it to your Spring Boot project;
    - An example address for the load test is: `http://<dns-name>/info`, since the `gateway` has an `/info` endpoint that returns information about the application. You can use this endpoint to load test your application.

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
