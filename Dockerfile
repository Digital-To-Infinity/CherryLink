# Build API or worker separately: docker build --build-arg SERVICE=api -t cherrylink-api .
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm install --no-audit --no-fund
RUN npm run build
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app /app
ARG SERVICE=api
ENV CHERRYLINK_SERVICE=$SERVICE NODE_ENV=production
EXPOSE 3001
CMD ["sh","-c","exec node apps/$CHERRYLINK_SERVICE/dist/index.js"]
