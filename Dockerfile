# --- Build stage -------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
COPY rulesets ./rulesets

RUN npm run build

# --- Runtime stage -------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Where tenant custom rulesets are persisted. Mount a volume here in prod
# so they survive container restarts (see docker-compose.yml).
ENV RULESETS_DIR=/app/data/tenants

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/rulesets ./dist/rulesets

RUN mkdir -p /app/data/tenants

EXPOSE 3000
CMD ["node", "dist/src/api/server.js"]
