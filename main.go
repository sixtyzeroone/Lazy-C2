package main

import (
    "log"
    "os"
    "os/signal"
    "syscall"
)

func main() {
    log.SetFlags(log.LstdFlags | log.Lshortfile)

    config := LoadConfig()
    db := InitDB(config)
    defer db.Close()

    server := NewServer(config, db)

    // Handle shutdown
    sigChan := make(chan os.Signal, 1)
    signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

    go func() {
        <-sigChan
        log.Println("🛑 Shutting down server...")
        server.Stop()
    }()

    if err := server.Start(); err != nil {
        log.Fatalf("Server error: %v", err)
    }
}
