FROM denoland/deno:alpine-2.1.4

WORKDIR /app
COPY main.ts verify.ts jwks.ts ./

# Cache dependencies at build time so a cold start is not also a download.
RUN deno cache main.ts

# Runs as a non-root user, told exactly which environment variables it may read
# and exactly which folder it may touch. The buckets are mounted under /mnt by
# Cloud Run, so nothing outside that is reachable even if this code is wrong.
USER deno
CMD ["deno", "run", \
     "--allow-net", \
     "--allow-env=PORT,PRIVATE_BUCKET,PUBLIC_BUCKET,PRIVATE_MOUNT,PUBLIC_MOUNT,ALLOWED_ORIGINS,GCP_PROJECT", \
     "--allow-read=/mnt", \
     "--allow-write=/mnt", \
     "main.ts"]
