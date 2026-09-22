# The bug finder: a real browser that uses ProofLab like a student, on a schedule, so bugs are
# found with nobody online. A Cloud Run JOB (not a service): it runs, finishes, exits - same shape
# as the crawler job, not a thing that listens for requests.
FROM mcr.microsoft.com/playwright:v1.63.0-jammy

WORKDIR /app
COPY package.json run.mjs ./
RUN npm install --omit=dev

RUN useradd --create-home bugfinder
USER bugfinder

CMD ["node", "run.mjs"]
