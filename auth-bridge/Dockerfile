# The token bridge. Deno, because the rest of the project's server code is Deno
# and this shares its idioms.
FROM denoland/deno:alpine-2.1.4

WORKDIR /app

# Copy first and cache the dependency graph, so a code change does not refetch.
COPY jwks.ts verify.ts main.ts ./
RUN deno cache main.ts

# Never root.
USER deno

EXPOSE 8080

# --allow-net is needed for two things only: serving, and fetching Google's
# public keys. No file access, no subprocesses, no environment beyond what is
# listed - so a compromise here cannot read secrets it was not given.
CMD ["deno", "run", "--allow-net", "--allow-env=PORT,TOKEN_TTL,ALLOWED_ORIGINS,PGRST_JWT_SECRET,GCP_PROJECT,POSTGREST_URL", "main.ts"]
