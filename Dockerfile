# Development container for ProofLabAI.
#
# The point of this file is that a second machine needs Docker and nothing else
# — no Node version to match, no npm install that behaves differently on
# Windows than it did here. `docker compose up` and the app is on :8080.
#
# Debian rather than Alpine on purpose: @vitejs/plugin-react-swc ships prebuilt
# native binaries against glibc, and the musl builds have a habit of being the
# thing you spend an afternoon on.
FROM node:22-bookworm-slim

# git is here because the Supabase CLI and some install scripts expect it;
# ca-certificates because everything talks to HTTPS.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies are their own layer, so editing source does not reinstall them.
# npm ci rather than npm install: it installs exactly what package-lock.json
# says, which is the whole reason the second laptop matches this one.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 8080

CMD ["npm", "run", "dev"]
