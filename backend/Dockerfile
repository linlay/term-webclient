FROM golang:1.26-bookworm AS build

ARG BACKEND_GOPROXY=https://goproxy.cn,https://proxy.golang.org,direct
ARG BACKEND_GOSUMDB=sum.golang.google.cn

ENV GOPROXY=$BACKEND_GOPROXY
ENV GOSUMDB=$BACKEND_GOSUMDB

WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN mkdir -p /tmp/go-build
RUN GOCACHE=/tmp/go-build GOFLAGS=-mod=mod GOPROXY=$GOPROXY GOSUMDB=$GOSUMDB go mod download
COPY backend/ /src/
RUN GOCACHE=/tmp/go-build GOFLAGS=-mod=mod GOPROXY=$GOPROXY GOSUMDB=$GOSUMDB go build -o /out/term-web-backend ./cmd/server

FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates docker.io tzdata \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN mkdir -p /app/data /workspace
COPY --from=build /out/term-web-backend /app/term-web-backend

ENV BACKEND_HOST=0.0.0.0
ENV BACKEND_PORT=11937

VOLUME ["/app/data"]
EXPOSE 11937

CMD ["/app/term-web-backend"]
