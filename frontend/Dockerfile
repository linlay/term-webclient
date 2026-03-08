FROM node:22-bookworm-slim AS build

WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-bookworm-slim

WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./ 
RUN npm ci --omit=dev
COPY frontend/server.js ./server.js
COPY --from=build /src/frontend/dist ./dist

ENV HOST=0.0.0.0
ENV PORT=11947
EXPOSE 11947

CMD ["node", "server.js"]
