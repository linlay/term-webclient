ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginx:1.27-alpine

FROM ${NODE_IMAGE} AS build

WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM ${NGINX_IMAGE}

COPY frontend/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /src/frontend/dist /usr/share/nginx/html

ENV PORT=11947
ENV BACKEND_ORIGIN=http://127.0.0.1:8080
ENV NGINX_ENVSUBST_FILTER=^(PORT|BACKEND_ORIGIN)$
EXPOSE 11947
