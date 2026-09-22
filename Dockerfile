# Project OS — hardened runtime image.
#
# Threat model this addresses: the app process itself gets compromised (a bad
# dependency, a bug in one of the endpoints in server/index.mjs). The goal is
# that from inside the container, an attacker has no path to anything else on
# the host — no SSH key, no Docker socket, no way to write outside the one
# data directory it's meant to write to.

# ---- build stage: compile the React frontend -------------------------------
FROM node:22-alpine AS build
WORKDIR /src
COPY web/package*.json web/
RUN npm --prefix web ci
COPY web/ web/
RUN npm --prefix web run build

# ---- runtime stage -----------------------------------------------------
FROM node:22-alpine AS runtime

# curl: used by the Docker healthcheck below. tini: reaps child processes this
# app spawns (claude -p, etc) so none of them become orphaned zombies under a
# process that was never designed to be PID 1. Nothing else — no ssh, no git,
# no build tools, no database client: nothing this app needs to reach another
# machine or compile anything at runtime.
RUN apk add --no-cache curl tini \
  && addgroup -S osapp && adduser -S osapp -G osapp -u 10001

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY server/ server/
COPY updater/ updater/
COPY osctl.mjs scaffold.mjs ./
COPY --from=build /src/web/dist web/dist

# projects/ ships only what's meant to be versioned (config.json, public/) —
# data/ and private/ are gitignored and arrive via the bind-mounted volume in
# compose, which lands on top of this at the same path.
COPY projects/ projects/

# Nothing here needs to run as root, and the app writes only under
# /app/projects — a volume, not an image layer — so a read-only root
# filesystem (see compose: read_only: true) still lets the app function while
# leaving everything else on the image unwritable even if the process is compromised.
RUN chown -R osapp:osapp /app
USER osapp

ENV NODE_ENV=production \
    OS_HOST=0.0.0.0 \
    PORT=4317

EXPOSE 4317

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/index.mjs"]
