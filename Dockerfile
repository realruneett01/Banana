# ==========================================
# Stage 1: Build Frontend Assets
# ==========================================
FROM node:20-bookworm-slim AS frontend-builder
WORKDIR /app

# Copy root workspace configurations and package files
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

# Install frontend dependencies
RUN npm ci --workspace=frontend

# Copy frontend source code
COPY frontend ./frontend

# Build frontend production bundle
# VITE_API_URL defaults to empty string so API requests use the current origin in production
ARG VITE_API_URL=""
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build --workspace=frontend

# ==========================================
# Stage 2: Production Runtime with KiCad CLI (Universal KiCad 10.x & 7+ Compatible)
# ==========================================
# Defaults to KiCad nightly (includes bleeding-edge KiCad 10.x/11.x CLI, backward-compatible with 7.x, 8.x, 9.x)
ARG KICAD_VERSION=nightly
FROM kicad/kicad:${KICAD_VERSION}

USER root

# Install system dependencies, Git, and Node.js 20 LTS
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    ca-certificates \
    build-essential \
    python3 \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Verify system installations
RUN kicad-cli --version && node -v && npm -v && git --version

WORKDIR /app

# Production environment variables
ENV NODE_ENV=production
ENV PORT=5000
ENV KICAD_CLI_PATH=/usr/bin/kicad-cli

# Copy package manifests for workspace resolution
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

# Install production dependencies for backend
RUN npm ci --workspace=backend --omit=dev

# Copy backend source code
COPY backend ./backend

# Copy built frontend assets from builder stage
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Set up user 1000 and directories for Hugging Face Spaces & security
RUN (id -u 1000 >/dev/null 2>&1 || useradd -m -u 1000 user) && \
    mkdir -p /app/temp_storage /home/user/.config/kicad /home/user/.cache/kicad && \
    chown -R 1000:1000 /app /home/user && \
    chmod -R 775 /app /home/user

USER 1000
ENV HOME=/home/user

# Expose default port (Render will dynamically supply PORT at runtime)
EXPOSE 5000

# Start Express server (serves API and production frontend)
CMD ["node", "backend/src/server.js"]
