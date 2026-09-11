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

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
