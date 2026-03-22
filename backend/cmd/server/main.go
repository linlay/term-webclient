package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"term-webclient-go/backend/internal/config"
	"term-webclient-go/backend/internal/server"
)

var (
	appVersion   string
	appGitSHA    string
	appBuildTime string
)

func main() {
	serverAddress := flag.String("server.address", "", "override server bind address")
	serverPort := flag.Int("server.port", 0, "override server bind port")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	if *serverAddress != "" {
		cfg.Server.Address = *serverAddress
	}
	if *serverPort > 0 {
		cfg.Server.Port = *serverPort
	}
	if appVersion != "" {
		cfg.App.Version = appVersion
	}
	if appGitSHA != "" {
		cfg.App.GitSHA = appGitSHA
	}
	if appBuildTime != "" {
		cfg.App.BuildTime = appBuildTime
	}

	app, err := server.New(cfg)
	if err != nil {
		log.Fatalf("build server: %v", err)
	}
	defer app.Close()

	httpServer := &http.Server{
		Addr:              cfg.BindAddr(),
		Handler:           app.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("term-webclient-go backend listening on %s", cfg.BindAddr())
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(ctx); err != nil {
		log.Printf("shutdown http server: %v", err)
	}
}
