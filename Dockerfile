FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY backend/Nexora.csproj backend/
RUN dotnet restore backend/Nexora.csproj
COPY backend/ backend/
RUN dotnet publish backend/Nexora.csproj -c Release -o /app/backend --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app/backend
COPY --from=build /app/backend ./
COPY real.html style.css backend-client.js /app/
COPY docs/bots.html /app/docs/bots.html
ENV ASPNETCORE_URLS=http://+:8080
ENV ConnectionStrings__Nexora="Data Source=/data/nexora.db"
RUN mkdir -p /data && chown -R $APP_UID:$APP_UID /data
USER $APP_UID
EXPOSE 8080
ENTRYPOINT ["dotnet", "Nexora.dll"]
