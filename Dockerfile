# Multi-stage build for Clinical Workflow App

# Stage 1: Build backend
FROM node:20-alpine AS backend-builder
WORKDIR /app
COPY shared-types.ts ./
COPY backend/package*.json ./backend/
RUN cd backend && npm ci
COPY backend/ ./backend/
RUN cd backend && npm run build

# Stage 2: Build frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY shared-types.ts ./
COPY frontend/frontend/package*.json ./frontend/frontend/
RUN cd frontend/frontend && npm ci
COPY frontend/frontend/ ./frontend/frontend/
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN cd frontend/frontend && npm run build

# Stage 3: Production image
FROM node:20-alpine AS production
WORKDIR /app

# Install production dependencies for backend
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

# Copy built backend
COPY --from=backend-builder /app/backend/dist ./backend/dist
COPY --from=backend-builder /app/shared-types.js ./

# Copy built frontend
COPY --from=frontend-builder /app/frontend/frontend/dist ./frontend/frontend/dist

# Install serve for frontend
RUN npm install -g serve

# Create data directory for SQLite
RUN mkdir -p /app/backend/data

# Expose ports
EXPOSE 5001 3000

# Start script
COPY <<EOF /app/start.sh
#!/bin/sh
cd /app/backend && node --enable-source-maps dist/backend/src/server.js &
serve -s /app/frontend/frontend/dist -l 3000
EOF
RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]
