# The content crawler, with agent-reach and the tools it sets up.
#
# Runs as a Cloud Run job, started weekly by Cloud Scheduler. It replaced a
# GitHub Actions run so that the whole platform lives in one Google project.
#
# agent-reach is installed from GitHub, not PyPI: the package called
# "agent-reach" on PyPI is a different project by a different author. It is
# pinned to one commit so a push to their main branch cannot change what runs
# against the database. To upgrade, read the diff, then change AGENT_REACH_REF.

FROM denoland/deno:bin-2.9.6 AS deno
FROM node:22-slim AS node

FROM python:3.12-slim

ARG AGENT_REACH_REF=da5044d26fc6adddb6554d5679c94ac22e76e428
ARG GH_VERSION=2.63.0
ARG MCPORTER_VERSION=0.13.13

# yt-dlp needs a JavaScript runtime to read YouTube today; deno works without
# extra configuration, which is why agent-reach recommends it over Node.
# yt-dlp refuses deno older than 2.3 and then reports no runtime at all.
COPY --from=deno /deno /usr/local/bin/deno

# Node carries mcporter, which is how agent-reach reaches Exa's web search.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm  && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx  && npm install -g "mcporter@${MCPORTER_VERSION}"  && npm cache clean --force

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git \
 && curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" \
      | tar -xz -C /tmp \
 && mv "/tmp/gh_${GH_VERSION}_linux_amd64/bin/gh" /usr/local/bin/gh \
 && rm -rf /tmp/gh_* /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir \
      "agent-reach @ git+https://github.com/Panniantong/Agent-Reach.git@${AGENT_REACH_REF}" \
 && pip install --no-cache-dir -r requirements.txt

COPY *.py ./

# Nothing here needs root, and the job only talks to the network.
RUN useradd --create-home crawler
USER crawler

# Exa's public MCP endpoint needs no key. Configured for this user, which is the
# scope agent-reach's doctor reads.
RUN mcporter config add exa https://mcp.exa.ai/mcp --scope home

# agent-reach's doctor prints Chinese; without this, Cloud Logging shows "????".
ENV PYTHONIOENCODING=utf-8 LANG=C.UTF-8

CMD ["python", "crawl.py"]
