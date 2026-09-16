# ProofLab's own code runner. Runs student code for the sandbox tasks and the
# resume coding round.
#
# It exists because every runner used before was a free public service:
# Wandbox (down for every language on 16 Sep 2026 - "Failed to get uid"),
# Godbolt (no Java, JavaScript or PHP) and Glot (never configured). When they
# failed, students could not run code at all.
#
# Isolation, in layers: the Cloud Run service runs as a service account with no
# roles, so there is nothing in the project to reach; each run happens in a
# fresh directory as the unprivileged user "runner", with CPU, file-size and
# process limits and a wall-clock kill; concurrency is one run per instance.

FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates python3 default-jdk-headless nodejs gcc g++ libc6-dev \
      golang-go ruby php-cli \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --shell /usr/sbin/nologin runner

WORKDIR /app
COPY server.py .

# Starts as root only so each run can drop to "runner"; submitted code never
# runs as root.
ENV PYTHONUNBUFFERED=1
CMD ["python3", "/app/server.py"]
