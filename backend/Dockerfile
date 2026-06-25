FROM node:20-bookworm

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install Node.js dependencies including pg
RUN npm install --omit=dev && npm install pg

# Copy application files
COPY . .

# Git-Commit-SHA fuer /api/status (vom CI via --build-arg gesetzt)
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

# Create uploads directory
RUN mkdir -p /app/uploads

# Set proper permissions
RUN chmod +x /app/server.js

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js || exit 1

# Expose port
EXPOSE 5000

# Start the server (now PostgreSQL by default)
CMD ["node", "server.js"]