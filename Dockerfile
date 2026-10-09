# PANDOX ODA CONNECT — production image
# Uses node:sqlite (built-in), so Node 22+ is required.
FROM node:22-slim

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy source
COPY . .

# Runtime directories
RUN mkdir -p /app/data /app/uploads

# SQLite database lives here — mount a Railway Volume at /app/data for persistence

EXPOSE 3000

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/pandox.db \
    UPLOAD_DIR=/app/uploads

CMD ["node", "server.js"]