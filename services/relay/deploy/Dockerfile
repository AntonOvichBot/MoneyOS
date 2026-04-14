FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/gasless/package.json ./packages/gasless/package.json
COPY services/relay/package.json ./services/relay/package.json

RUN npm ci --workspace=packages/gasless --workspace=services/relay

COPY packages/gasless ./packages/gasless
COPY services/relay ./services/relay

RUN npm run build --workspace=packages/gasless \
  && npm run build --workspace=services/relay

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/gasless ./packages/gasless
COPY --from=build /app/services/relay ./services/relay

ENV MONEYOS_RELAY_HOST=0.0.0.0
ENV MONEYOS_RELAY_PORT=8787

EXPOSE 8787

CMD ["node", "services/relay/dist/server.js"]
