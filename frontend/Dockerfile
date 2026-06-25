# Multi-stage Build für Production Frontend
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --legacy-peer-deps

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
