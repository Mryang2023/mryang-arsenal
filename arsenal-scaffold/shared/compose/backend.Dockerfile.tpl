# 后端镜像：多阶段构建，构建器自带 Maven 与 JDK，宿主机无需装任何工具。
# 基础镜像按需换内网源；离线环境把 FROM 行换成私有仓库地址即可。
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /build
# 先只拷 pom 拉依赖：源码改动不会打穿依赖层缓存
COPY pom.xml .
RUN mvn -q -B dependency:go-offline || true
COPY src ./src
RUN mvn -q -B -DskipTests package

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /build/target/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
