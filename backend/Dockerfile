FROM golang:1.26-bookworm AS build

WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN mkdir -p /tmp/go-build
RUN GOCACHE=/tmp/go-build GOFLAGS=-mod=mod go mod download
COPY backend/ /src/
RUN GOCACHE=/tmp/go-build GOFLAGS=-mod=mod go build -o /out/term-web-backend ./cmd/server

FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates tzdata \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /out/term-web-backend /app/term-web-backend

ENV BACKEND_HOST=0.0.0.0
ENV BACKEND_PORT=11946

VOLUME ["/app/data"]
EXPOSE 11946

CMD ["/app/term-web-backend"]
