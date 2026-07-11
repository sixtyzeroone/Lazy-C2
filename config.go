package main

import (
    "encoding/json"
    "fmt"
    "os"
   
)

type Config struct {
    Host         string `json:"host"`
    Port         int    `json:"port"`
    WebPort      int    `json:"web_port"`
    DatabasePath string `json:"database_path"`
    JWTSecret    string `json:"jwt_secret"`
    NgrokHost    string `json:"ngrok_host,omitempty"`    // Tambahan
    NgrokPort    int    `json:"ngrok_port,omitempty"`    // Tambahan
}

func LoadConfig() *Config {
    config := &Config{
        Host:         "0.0.0.0",
        Port:         4444,
        WebPort:      8080,
        DatabasePath: "c2.db",
        JWTSecret:    "lazyframework-secret-key-2024",
        NgrokHost:    "",
        NgrokPort:    0,
    }

    if data, err := os.ReadFile("config.json"); err == nil {
        if err := json.Unmarshal(data, config); err != nil {
            fmt.Printf("Error parsing config: %v\n", err)
        }
    }

    return config
}

func (c *Config) GetAddress() string {
    return fmt.Sprintf("%s:%d", c.Host, c.Port)
}

func (c *Config) GetWebAddress() string {
    return fmt.Sprintf("%s:%d", c.Host, c.WebPort)
}

func SaveConfig(config *Config) error {
    data, err := json.MarshalIndent(config, "", "    ")
    if err != nil {
        return err
    }
    return os.WriteFile("config.json", data, 0644)
}
