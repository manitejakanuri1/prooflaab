FROM denoland/deno:alpine-2.1.4

WORKDIR /app

# Both trees are copied because the functions live where Supabase expects them
# and the router reaches across into that folder. Keeping them in one place
# would mean Supabase could no longer deploy the same files - and during the
# changeover both platforms must be able to run them.
COPY functions-service/ ./functions-service/
COPY supabase/functions/ ./supabase/functions/

# Fetch every remote import at build time. A cold start should not also be a
# download from esm.sh, and a network wobble should break the build rather than
# the service.
RUN deno cache --allow-import functions-service/main.ts || true
RUN for f in supabase/functions/*/index.ts; do deno cache --allow-import "$f" || exit 1; done

USER deno
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", \
     "--allow-import", "functions-service/main.ts"]
