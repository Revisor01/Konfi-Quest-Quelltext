# Backend-Image: nur was zur Laufzeit gebraucht wird.
#
# Bis dahin: Vollimage node:*-bookworm mit g++, make, python3, git; darin
# `npm install --omit=dev && npm install pg`. Das zweite `npm install` ohne
# Schalter holte alle Dev-Abhaengigkeiten wieder herein (vitest, nodemon,
# supertest) und nahm `pg` in der jeweils neuesten Version statt der aus dem
# Lockfile. `COPY . .` ohne .dockerignore brachte tests/ samt dem
# Produktions-Schema-Dump (tests/schema/prod-schema.sql) ins oeffentlich
# lesbare Image. Gemessen: 1,92 GB, 319 Module, 253 Testdateien.
#
# Jetzt zwei Stufen:
#   1. abhaengigkeiten: `npm ci --omit=dev` -- genau das Lockfile, bricht ab,
#      wenn package.json und Lockfile auseinanderlaufen. Im Vollimage, damit
#      ein natives Modul ohne passendes Prebuild (bcrypt) hier notfalls
#      kompiliert werden kann; der Compiler bleibt in dieser Stufe.
#   2. Laufzeit: das schlanke Image, node_modules aus Stufe 1, der Code ohne
#      Tests und Doku (backend/.dockerignore).

FROM node:26-bookworm AS abhaengigkeiten
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM node:26-bookworm-slim
WORKDIR /app

# Kein curl: Der Stack prueft backend, backend2 und backend-test
# seitdem wie dieses Image mit `node healthcheck.js`.
# Bis dahin wurde curl
# eigens fuer den Healthcheck des Stacks nachinstalliert.

COPY --from=abhaengigkeiten /app/node_modules ./node_modules
COPY . .

# Git-Commit-SHA fuer /api/status (vom CI via --build-arg gesetzt)
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

# Geschrieben wird nur unter /app/uploads (Unterordner und Zwischenlager legt
# createApp.js beim Start an). Ohne Mount (E2E, lokal) gilt der Besitz hier;
# mit Mount der am Host. Der Code unter /app gehoert root und bleibt fuer den
# Prozess nur lesbar.
RUN groupadd --system --gid 10001 konfi \
  && useradd --system --uid 10001 --gid 10001 --no-create-home \
     --home-dir /app --shell /usr/sbin/nologin konfi \
  && mkdir -p /app/uploads && chown 10001:10001 /app/uploads

USER 10001:10001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js || exit 1

EXPOSE 5000

CMD ["node", "server.js"]
