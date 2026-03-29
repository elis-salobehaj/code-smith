FROM oven/bun:1-alpine AS base

# Install git (for repo cloning) and ripgrep (for search_codebase tool)
RUN apk add --no-cache git ripgrep

WORKDIR /app

# Install production dependencies first (layer-cached unless package.json changes)
COPY package.json bun.lock* ./
RUN bun install --production

# Copy source
COPY src/ ./src/
COPY tsconfig.json ./

EXPOSE 8020

# Default: run the webhook server.
# Override CMD to run the worker process for the BullMQ consumer container:
#   docker run code-smith bun run src/worker.ts
CMD ["bun", "run", "src/index.ts"]
