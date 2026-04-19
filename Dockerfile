FROM node:20-alpine

LABEL maintainer="NimbusFS"
LABEL description="HDFS Cloud Storage SaaS"

# Install system deps
RUN apk add --no-cache curl

WORKDIR /app

# Copy package files and install deps
COPY package*.json ./
RUN npm ci --only=production

# Copy application source
COPY . .

# Create temp upload directory
RUN mkdir -p /tmp/hdfs-cloud-uploads

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

CMD ["node", "server.js"]