FROM node:22-bookworm-slim

WORKDIR /workspace
COPY . .
RUN corepack enable
CMD ["sh", "-lc", "corepack pnpm --dir dapp serve"]
