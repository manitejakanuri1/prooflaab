FROM denoland/deno:alpine-2.1.4

WORKDIR /app

COPY . .

RUN deno cache main.ts

USER deno

EXPOSE 8080

CMD ["deno", "run", \
     "--allow-net", \
     "--allow-env=PORT,GOOGLE_API_KEY,AUTH_BRIDGE_URL,POSTGREST_URL,FUNCTIONS_URL,FILES_URL,ACCOUNTS_URL,TRANSCRIBER_URL,SESSION_KEY,ENVIRONMENT,BROWSER_ORIGINS", \
     "main.ts"]
