# Multi-stage lightweight Alpine build
FROM node:20-alpine AS base

# Install necessary runtime dependencies
WORKDIR /app

# Ensure security: run non-root
ENV NODE_ENV=production
ENV PORT=3055
ENV MAX_FILE_SIZE_MB=150
ENV FILE_TTL_MINUTES=60

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy application source code
COPY server.js ./
COPY public ./public

# Create uploads directory and set permissions for node user
RUN mkdir -p uploads && chown -R node:node /app

USER node

# Expose server port
EXPOSE 3055

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3055/api/config || exit 1

# Start the application
CMD ["node", "server.js"]
