# Step 1: Build the TypeScript source code
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src
RUN npm run build

# Step 2: Set up the production runtime
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./
# Install production dependencies only
RUN npm ci --only=production

# Copy compiled files and initial database
COPY --from=builder /app/build ./build
COPY data/ ./data

# Cloud Run defaults to exposing port 8080
EXPOSE 8080

CMD ["node", "build/index.js"]
