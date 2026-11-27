# syntax=docker/dockerfile:1

# ---- build stage: compile with Maven inside a JDK image -------------------
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
COPY src ./src
# the cache mount keeps ~/.m2 between builds: dependencies are downloaded once
RUN --mount=type=cache,target=/root/.m2 mvn -B -q package -DskipTests

# ---- runtime stage: only a JRE and the jar --------------------------------
FROM eclipse-temurin:21-jre
WORKDIR /app
RUN useradd --system --uid 10001 app
COPY --from=build /src/target/app.jar app.jar
USER app
EXPOSE 8082
# use up to 75% of the container's memory limit for the heap
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "app.jar"]
