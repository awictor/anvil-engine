FROM node:22-slim

# Install Chromium and dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      libnss3 \
      libxss1 \
      libasound2 \
      libatk-bridge2.0-0 \
      libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

# Set Chrome path for launcher auto-discovery
ENV CHROME_PATH=/usr/bin/chromium
ENV ANVIL_ENGINE_PORT=3000
ENV ANVIL_HOST=0.0.0.0

WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy pre-built dist
COPY dist/ ./dist/

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD node -e "fetch('http://localhost:3000/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/api.js"]
