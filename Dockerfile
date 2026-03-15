FROM oven/bun:1-alpine AS base

# Install git (for repo cloning) and ripgrep (for search_codebase tool)
RUN apk add --no-cache git ripgrep

WORKDIR /app

# Install production dependencies first (layer-cached unless package.json changes)
COPY package.json ./
RUN bun install --production

# Copy source
COPY src/ ./src/
COPY tsconfig.json ./

EXPOSE 8000
CMD ["bun", "run", "src/index.ts"]
