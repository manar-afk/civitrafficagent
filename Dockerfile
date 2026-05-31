# Step 1: Build the TypeScript source code and React frontend
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json vite.config.js index.html ./
RUN npm ci
COPY src/ ./src
COPY server/ ./server
RUN npm run build

# Step 2: Set up the production runtime
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./
RUN npm ci --only=production

# Copy compiled backend, static client assets, and initial database
COPY --from=builder /app/build ./build
COPY --from=builder /app/dist ./dist
COPY data/ ./data

EXPOSE 8080

CMD ["node", "build/server/index.js"]
