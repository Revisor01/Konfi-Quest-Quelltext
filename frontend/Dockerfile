# Multi-stage Build für Production Frontend
FROM node:26-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
# Kein --legacy-peer-deps mehr, siehe ci.yml: Der Konflikt kam von
# @eslint/js@10 gegen eslint@9 und ist seit dem Sprung auf ESLint 10 weg.
RUN npm ci

# Copy source
COPY . .

# VITE_API_URL als Build-Arg (Vite bettet env-vars zur Build-Zeit ein)
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

# Build
RUN npm run build

# Production Stage mit Nginx
FROM nginx:alpine

# Copy build files
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Nur fuer die E2E-Umgebung: Dort liegt die API unter einer
# anderen Adresse als die Web-App (localhost:5555 statt 5556), und die scharfe
# CSP liess den Aufruf nicht durch -- jede Anmeldung scheiterte. In Produktion
# teilen sich App und API die Adresse, der Produktionsbau setzt das ARG nicht
# (ci.yml, build-and-push), die Richtlinie bleibt dort unveraendert.
ARG CSP_CONNECT_EXTRA=""
RUN if [ -n "$CSP_CONNECT_EXTRA" ]; then \
      sed -i "s#connect-src 'self'#connect-src 'self' ${CSP_CONNECT_EXTRA}#" /etc/nginx/conf.d/default.conf; \
    fi

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
