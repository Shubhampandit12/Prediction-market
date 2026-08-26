# Single-image deploy: the backend serves the built frontend directly, so
# there's no separate frontend host and no CORS to configure in production.
# Build from the repo root: `docker build -t prediction-market .`

# ---- Frontend build ----
FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Backend build ----
FROM node:20-alpine AS backend-build
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npx prisma generate
RUN npm run build
# prisma (the CLI, needed for `migrate deploy` at container start) is a
# regular dependency specifically so it survives this prune.
RUN npm prune --omit=dev

# ---- Runtime ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=backend-build /app/node_modules ./node_modules
COPY --from=backend-build /app/dist ./dist
COPY --from=backend-build /app/prisma ./prisma
COPY --from=backend-build /app/package.json ./package.json
COPY --from=frontend-build /app/dist ./public

EXPOSE 3000

# Applies any pending migrations against DATABASE_URL, then starts the server.
# Safe to run on every boot: prisma migrate deploy is idempotent.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
