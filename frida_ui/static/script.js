// This code is part of Frida-UI (https://github.com/adityatelange/frida-ui)

// --- Global State ---
let appSessions = {}; // { appIdentifier: { sessionId, scriptIds, consoleLog, pollInterval } }
let allApps = []; // List of all apps for the selected device
let selectedApp = null; // Currently selected app
let codeshareQueue = []; // Queue of codeshare URIs to load with next script run
let deviceCache = {}; // Cache for device info including parameters
let monacoEditor = null; // Monaco editor instance

// LocalStorage Keys
const QUEUE_KEY = 'frida-ui-codeshare-queue';
const SEARCH_KEY = 'frida-ui-app-search';
const SELECTED_APP_KEY = 'frida-ui-selected-app';
const SELECTED_DEVICE_KEY = 'frida-ui-selected-device';
const APP_LIST_SCROLL_KEY = 'frida-ui-app-list-scroll';

// DOM Elements
const els = {
    devices: document.getElementById('devices'),
    refreshDevices: document.getElementById('refreshDevices'),
    refreshApps: document.getElementById('refreshApps'),
    connectRemoteBtn: document.getElementById('connectRemoteBtn'),
    disconnectRemoteBtn: document.getElementById('disconnectRemoteBtn'),
    appList: document.getElementById('appList'),
    appSearch: document.getElementById('appSearch'),
    emptyState: document.getElementById('emptyState'),
    sessionView: document.getElementById('sessionView'),
    sessionName: document.getElementById('sessionName'),
    sessionIdentifier: document.getElementById('sessionIdentifier'),
    sessionPid: document.getElementById('sessionPid'),
    attachBtn: document.getElementById('attachBtn'),
    spawnBtn: document.getElementById('spawnBtn'),
    killBtn: document.getElementById('killBtn'),
    detachBtn: document.getElementById('detachBtn'),
    spawnRunBtn: document.getElementById('spawnRunBtn'),
    editorContainer: document.getElementById('editorContainer'),
    toggleEditorBtn: document.getElementById('toggleEditorBtn'),
    scriptArea: document.getElementById('scriptArea'),
    scriptEditor: document.getElementById('scriptEditor'),
    loadFileBtn: document.getElementById('loadFileBtn'),
    loadFileInput: document.getElementById('loadFileInput'),
    loadedFilename: document.getElementById('loadedFilename'),
    sendScript: document.getElementById('sendScript'),
    downloadScriptBtn: document.getElementById('downloadScriptBtn'),
    consoleOutput: document.getElementById('consoleOutput'),
    clearConsoleBtn: document.getElementById('clearConsoleBtn'),
    downloadConsoleBtn: document.getElementById('downloadConsoleBtn'),
    toggleConsoleBtn: document.getElementById('toggleConsoleBtn'),
    remoteForm: document.getElementById('remoteForm'),
    remoteHost: document.getElementById('remoteHost'),
    remotePort: document.getElementById('remotePort'),
    deviceInfo: document.getElementById('deviceInfo'),
    codeshareList: document.getElementById('codeshareList'),
    codeshareUri: document.getElementById('codeshareUri'),
    toggleRemoteBtn: document.getElementById('toggleRemoteBtn'),
    cancelRemoteBtn: document.getElementById('cancelRemoteBtn'),
    addCodeshareBtn: document.getElementById('addCodeshareBtn'),
    loadCodeshareSequenceBtn: document.getElementById('loadCodeshareSequenceBtn')
};

// --- API Endpoints ---
const API = {
    DEVICES: '/api/devices',
    REMOTE_DEVICES: '/api/devices/remote',
    REMOTE_DEVICE: (id) => `/api/devices/remote/${id}`,
    APPS: (devId) => `/api/devices/${devId}/apps`,
    ATTACH: '/api/attach',
    SPAWN: '/api/spawn',
    SPAWN_AND_RUN: '/api/spawn_and_run',
    DETACH: '/api/detach',
    KILL: '/api/kill',
    SCRIPT: '/api/script',
    SESSION_ALIVE: (sessionId) => `/api/session/${sessionId}/alive`,
    SCRIPT_MESSAGES: (scriptId) => `/api/scripts/${scriptId}/messages?clear=true`,
    CODESHARE_LOAD: '/api/codeshare/load'
};

// --- API Helpers ---
async function apiCall(endpoint, method = 'GET', body = null) {
    const opts = { method };
    if (body) {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(body);
    }
    const r = await fetch(endpoint, opts);
    if (!r.ok) {
        let msg = 'Error';
        try { msg = (await r.json()).detail; } catch (e) { msg = await r.text(); }
        throw new Error(msg);
    }
    return r.json();
}

// Escape HTML special characters
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// --- Remote Device Functions ---
function getCurrentAppSession() {
    if (!selectedApp) return null;
    return appSessions[selectedApp.identifier] || null;
}

function ensureAppSession() {
    if (!selectedApp) return null;
    if (!appSessions[selectedApp.identifier]) {
        appSessions[selectedApp.identifier] = {
            sessionId: null,
            scriptIds: [],
            consoleLog: [],
            pollInterval: null
        };
    }
    return appSessions[selectedApp.identifier];
}

/* START Remote Device Management */

// Toggle remote form visibility
function toggleRemoteForm() {
    const form = els.remoteForm;
    const isVisible = form.classList.contains('show');
    if (isVisible) {
        form.classList.remove('show');
    } else {
        form.classList.add('show');
        els.remoteHost.focus();
    }
}

// Close and reset remote form
function closeRemoteForm() {
    els.remoteForm.classList.remove('show');
    els.remoteHost.value = '';
    els.remotePort.value = '27042';
}

// Add a new remote device
async function addRemoteDevice() {
    const host = els.remoteHost.value.trim();
    const port = parseInt(els.remotePort.value) || 27042;
    const btn = els.connectRemoteBtn;

    if (!host) {
        alert('Please enter a host address');
        return;
    }

    setLoading(btn, true, 'Connecting...');
    try {
        logConsole('System', `Connecting to ${host}:${port}...`);
        const result = await apiCall(API.REMOTE_DEVICES, 'POST', { host, port });
        logConsole('System', `Connected to remote device: ${result.name}`);
        closeRemoteForm();
        await loadDevices();
        // Select the newly added device
        els.devices.value = result.id;
        localStorage.setItem(SELECTED_DEVICE_KEY, result.id);
        await loadApps();
    } catch (e) {
        console.error(e);
        alert('Failed to add remote device: ' + e.message);
    } finally {
        setLoading(btn, false);
        updateDisconnectButton();
    }
}

// Check if selected device is remote and show/hide disconnect button
function updateDisconnectButton() {
    const selectedOption = els.devices.options[els.devices.selectedIndex];
    const disconnectBtn = els.disconnectRemoteBtn;
    if (selectedOption && selectedOption.dataset.isRemote === 'true') {
        disconnectBtn.classList.remove('hidden');
    } else {
        disconnectBtn.classList.add('hidden');
    }
}

// Disconnect from selected remote device
async function disconnectRemoteDevice() {
    const deviceId = els.devices.value;
    if (!deviceId) return;
    const btn = els.disconnectRemoteBtn;

    const selectedOption = els.devices.options[els.devices.selectedIndex];
    if (selectedOption.dataset.isRemote !== 'true') {
        alert('Selected device is not a remote device');
        return;
    }

    if (!confirm('Disconnect from this remote device?')) return;

    setLoading(btn, true, 'Disconnecting...');
    try {
        await apiCall(API.REMOTE_DEVICE(deviceId), 'DELETE');
        logConsole('System', 'Disconnected from remote device');
        await loadDevices();
    } catch (e) {
        console.error(e);
        alert('Failed to disconnect: ' + e.message);
    } finally {
        setLoading(btn, false);
    }
}

/* END Remote Device Management */

async function loadDevices() {
    setLoading(els.refreshDevices, true, null);
    try {
        els.devices.innerHTML = '<option disabled selected>Loading devices...</option>';
        const devs = await apiCall(API.DEVICES);

        // Update cache
        deviceCache = {};
        devs.forEach(d => { deviceCache[d.id] = d; });

        els.devices.innerHTML = '';
        if (devs.length === 0) {
            els.devices.innerHTML = '<option disabled selected>No devices found</option>';
            const infoPanel = els.deviceInfo;
            if (infoPanel) infoPanel.innerHTML = '<p>No devices found. Please connect a device or add a remote one.</p>';
        }
        devs.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.id;
            opt.textContent = `${d.name} (${d.type})`;
            opt.dataset.isRemote = d.can_disconnect ? 'true' : 'false';
            els.devices.appendChild(opt);
        });
        // Try to restore selected device
        try {
            const savedDevice = localStorage.getItem(SELECTED_DEVICE_KEY);
            if (savedDevice) {
                const found = Array.from(els.devices.options).find(o => o.value === savedDevice);
                if (found) els.devices.value = savedDevice;
            } else {
                // Fallback to SELECTED_APP_KEY
                const raw = localStorage.getItem(SELECTED_APP_KEY);
                if (raw) {
                    const obj = JSON.parse(raw);
                    if (obj && obj.device) {
                        const found = Array.from(els.devices.options).find(o => o.value === obj.device);
                        if (found) els.devices.value = obj.device;
                    }
                }
            }
        } catch (e) { /* ignore */ }
        updateDisconnectButton();
        if (devs.length > 0) loadApps();
    } catch (e) {
        console.error(e);
        alert('Failed to load devices: ' + e.message);
    } finally {
        setLoading(els.refreshDevices, false);
    }
}

async function loadApps() {
    const btn = els.refreshApps;
    setLoading(btn, true, null);
    const devId = els.devices.value;
    if (!devId) { setLoading(btn, false); return; }

    // Fetch device info in parallel
    updateDeviceInfo(devId);

    // Save scroll position to restore after loading
    const savedScroll = els.appList.scrollTop;

    els.appList.innerHTML = '<div class="status-msg">Loading...</div>';
    els.appSearch.disabled = true;
    try {
        allApps = await apiCall(API.APPS(devId));

        // Update selectedApp state if it exists in the new list
        if (selectedApp) {
            const updatedApp = allApps.find(a => a.identifier === selectedApp.identifier);
            if (updatedApp) {
                selectedApp = updatedApp;
                // Update UI elements that depend on selectedApp
                els.sessionPid.textContent = selectedApp.pid ? `PID: ${selectedApp.pid}` : 'Not Running';
                updateSessionUI();
            }
        }

        // Restore saved scroll to localStorage (overwriting 0 from clear)
        if (savedScroll > 0) {
            localStorage.setItem(APP_LIST_SCROLL_KEY, savedScroll);
        }

        renderApps();
    } catch (e) {
        els.appList.innerHTML = `<div class="error-msg">Error: ${e.message}</div>`;
    } finally {
        setLoading(btn, false);
        els.appSearch.disabled = false;
    }
}

function renderApps() {
    // Save current scroll position
    const scrollTop = els.appList.scrollTop;

    const filter = els.appSearch.value.toLowerCase();
    els.appList.innerHTML = '';

    const filtered = allApps.filter(a =>
        a.name.toLowerCase().includes(filter) ||
        a.identifier.toLowerCase().includes(filter)
    );

    filtered.forEach(app => {
        const div = document.createElement('div');
        div.className = 'app-item';
        if (selectedApp && selectedApp.identifier === app.identifier) div.classList.add('active');
        div.innerHTML = `
                    <div>
                        <span class="app-name">${escapeHtml(app.name)}</span>
                        <span class="app-id">${escapeHtml(app.identifier)}</span>
                    </div>
                    <div>
                        ${app.pid ? '<span class="badge running">Running</span>' : ''}
                    </div>
                `;
        div.onclick = () => selectApp(app);
        els.appList.appendChild(div);
    });

    // Restore scroll position from memory or localStorage
    const savedScroll = scrollTop || parseInt(localStorage.getItem(APP_LIST_SCROLL_KEY) || '0');
    els.appList.scrollTop = savedScroll;
}


function selectApp(app, persist = true) {
    // Stop polling for previous app if any
    if (selectedApp && selectedApp.identifier !== app.identifier) {
        const prevSession = appSessions[selectedApp.identifier];
        if (prevSession && prevSession.pollInterval) {
            clearTimeout(prevSession.pollInterval);
            prevSession.pollInterval = null;
        }
    }

    continueSelectApp(app, persist);
}

function deselectApp() {
    if (!selectedApp) return;

    // Stop polling
    const appSession = appSessions[selectedApp.identifier];
    if (appSession && appSession.pollInterval) {
        clearTimeout(appSession.pollInterval);
        appSession.pollInterval = null;
    }

    selectedApp = null;
    localStorage.removeItem(SELECTED_APP_KEY);

    renderApps(); // update active state

    els.emptyState.classList.remove('hidden');
    els.sessionView.classList.add('hidden');
    els.sessionName.textContent = '';
    els.sessionIdentifier.textContent = '';
    els.sessionPid.textContent = '';
    els.consoleOutput.innerHTML = '';

    // Refresh device info when deselecting
    if (els.devices.value) {
        updateDeviceInfo(els.devices.value);
    }
}

async function updateDeviceInfo(devId) {
    // Render icon from raw byte string
    function _renderIcon(rawByteString) {
        const arr = JSON.parse(rawByteString);
        const bytes = new Uint8ClampedArray(arr);

        if (bytes.length !== 16 * 16 * 4) {
            return null; // Invalid icon size
        }

        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext('2d');
        const imageData = new ImageData(bytes, 16, 16);
        ctx.putImageData(imageData, 0, 0);
        const dataUrl = canvas.toDataURL("image/png");
        canvas.remove(); // Clean up

        return dataUrl;
    }

    const infoPanel = els.deviceInfo;
    if (!infoPanel) return;

    try {
        let info = deviceCache[devId];
        if (!info) return;
        const params = info.parameters || {};

        // Render icon
        let iconDataUrl = null;
        if (info.icon) {
            iconDataUrl = _renderIcon(info.icon);
        }

        let html = `
            <div class="device-info-header">
            <div class="device-info-title">${escapeHtml(info.name)}</div>
            ${iconDataUrl ? `<span class="badge">
                <img src="${iconDataUrl}" alt="icon" class="device-icon" />
            </span>` : ''}
            </div>
            <table class="device-info-table">
            <tr>
                <td>Device ID</td>
                <td>${escapeHtml(info.id)}</td>
            </tr>
        `;

        // Platform & Arch
        if (params.platform) {
            html += `<tr><td>Platform</td><td>${escapeHtml(params.platform)}</td></tr>`;
        }
        if (params.arch) {
            html += `<tr><td>Architecture</td><td>${escapeHtml(params.arch)}</td></tr>`;
        }

        // OS Info
        if (params.os) {
            const os = params.os;
            const osName = os.name || os.id || 'Unknown';
            const osVer = os.version ? ` (v${os.version})` : '';
            html += `<tr><td>Operating System</td><td>${escapeHtml(osName)}${escapeHtml(osVer)}</td></tr>`;
        }

        // API Level
        if (params['api-level']) {
            html += `<tr><td>API Level</td><td>${escapeHtml(String(params['api-level']))}</td></tr>`;
        }

        // Access
        if (params.access) {
            html += `<tr><td>Access</td><td>${escapeHtml(params.access)}</td></tr>`;
        }

        // Other parameters
        const knownKeys = ['platform', 'arch', 'os', 'api-level', 'access'];
        for (const [key, value] of Object.entries(params)) {
            if (!knownKeys.includes(key)) {
                html += `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(typeof value === 'object' ? JSON.stringify(value) : String(value))}</td></tr>`;
            }
        }

        html += `</table>`;
        infoPanel.innerHTML = html;
    } catch (e) {
        console.error('Failed to fetch device info', e);
        infoPanel.innerHTML = '';
    }
}

function continueSelectApp(app, persist) {
    selectedApp = app;
    if (persist) {
        try {
            localStorage.setItem(SELECTED_APP_KEY, JSON.stringify(
                {
                    device: els.devices.value,
                    identifier: app.identifier
                }
            ));
            localStorage.setItem(SELECTED_DEVICE_KEY, els.devices.value);
        } catch (e) { }
    }
    renderApps(); // update active state

    els.emptyState.classList.add('hidden');
    els.sessionView.classList.remove('hidden');
    els.sessionName.textContent = app.name;
    els.sessionIdentifier.textContent = app.identifier;
    els.sessionPid.textContent = app.pid ? `PID: ${app.pid}` : 'Not Running';

    // Restore console logs for this app
    restoreConsoleForApp();

    updateSessionUI();

    // Resume polling if there's an active session
    const appSession = getCurrentAppSession();
    if (appSession && appSession.sessionId) {
        pollMessages();
    }
}

function restoreConsoleForApp() {
    els.consoleOutput.innerHTML = '';
    const appSession = getCurrentAppSession();
    if (appSession && appSession.consoleLog && appSession.consoleLog.length > 0) {
        appSession.consoleLog.forEach(entry => {
            const div = document.createElement('div');
            div.className = 'log-entry';
            div.innerHTML = `<span class="ts">[${entry.time}] ${entry.source}:</span> <span class="data">${escapeHtml(entry.text)}</span>`;
            els.consoleOutput.appendChild(div);
        });
        els.consoleOutput.scrollTop = els.consoleOutput.scrollHeight;
    } else {
        els.consoleOutput.innerHTML = '<div class="status-msg">No console output yet. Run a script or attach to see messages.</div>';
    }
}

// Start a new session for the selected app
function startSession(sid, name, pid) {
    const appSession = ensureAppSession();
    appSession.sessionId = sid;
    appSession.scriptIds = [];

    els.sessionPid.textContent = `PID: ${pid}`;
    updateSessionUI();
    // Start background polling to watch for messages and session liveness
    pollMessages();
}

// Update session-related UI buttons based on current state
function updateSessionUI() {
    const appSession = getCurrentAppSession();
    const hasSession = appSession && appSession.sessionId;

    if (hasSession) {
        els.attachBtn.classList.add('hidden');
        els.spawnBtn.classList.add('hidden');
        els.detachBtn.classList.remove('hidden');
        els.killBtn.classList.add('hidden');
        els.spawnRunBtn.classList.add('hidden');
    } else {
        els.detachBtn.classList.add('hidden');
        els.spawnRunBtn.classList.remove('hidden');
        // Show Attach if it has a PID, otherwise show Spawn
        if (selectedApp && selectedApp.pid) {
            els.attachBtn.classList.remove('hidden');
            els.spawnBtn.classList.add('hidden');
            els.killBtn.classList.remove('hidden');
        } else {
            els.attachBtn.classList.add('hidden');
            els.spawnBtn.classList.remove('hidden');
            els.killBtn.classList.add('hidden');
        }
    }
}

// Set loading state on a button
function setLoading(btn, isLoading, loadingText) {
    if (!btn) return;
    if (isLoading) {
        // Save original text if present
        if (btn.dataset.originalText === undefined) btn.dataset.originalText = btn.textContent;
        // Spinner-only mode when loadingText explicitly null
        if (loadingText === null) {
            btn.classList.add('spinner-only');
        } else {
            btn.classList.remove('spinner-only');
        }
        // If loadingText is provided (non-null/undefined) replace text
        if (loadingText !== undefined && loadingText !== null) {
            btn.textContent = loadingText;
        }
        btn.disabled = true;
        btn.classList.add('btn-loading');
    } else {
        // Restore original text only if we saved one
        if (btn.dataset.originalText !== undefined) btn.textContent = btn.dataset.originalText;
        btn.disabled = false;
        btn.classList.remove('btn-loading');
        btn.classList.remove('spinner-only');
    }
}

/* START Buton Action Handlers */

async function doAttach() {
    if (!selectedApp) return;
    const btn = els.attachBtn;
    setLoading(btn, true, 'Attaching...');
    try {
        const devId = els.devices.value;
        const res = await apiCall(API.ATTACH, 'POST', {
            device_id: devId,
            target: String(selectedApp.pid || selectedApp.identifier)
        });

        // Update app state to running
        selectedApp.pid = res.pid;
        // Update app list UI to show running badge
        const appItem = Array.from(els.appList.children).find(el =>
            el.querySelector('.app-id').textContent === selectedApp.identifier
        );
        if (appItem) {
            const badgeContainer = appItem.children[1];
            badgeContainer.innerHTML = '<span class="badge running">Running</span>';
        }

        startSession(res.session_id, selectedApp.name, res.pid);
        logConsole('System', `Attached to ${selectedApp.name} (session: ${res.session_id}, pid: ${res.pid})`);
    } catch (e) {
        alert(e.message);
        // Clear PID and any session state
        selectedApp.pid = null;
        els.sessionPid.textContent = 'Not Running';
        const appSession = appSessions[selectedApp.identifier];
        if (appSession) {
            appSession.sessionId = null;
            appSession.scriptIds = [];
            if (appSession.pollInterval) {
                clearTimeout(appSession.pollInterval);
                appSession.pollInterval = null;
            }
        }
        updateSessionUI();
        loadApps();
    } finally {
        setLoading(btn, false);
    }
}

async function doSpawn() {
    if (!selectedApp) return;
    const btn = els.spawnBtn;
    setLoading(btn, true, 'Spawning...');
    try {
        const devId = els.devices.value;
        const res = await apiCall(API.SPAWN, 'POST', {
            device_id: devId,
            identifier: selectedApp.identifier
        });

        // Update app state to running
        selectedApp.pid = res.pid;
        // Update app list UI to show running badge
        const appItem = Array.from(els.appList.children).find(el =>
            el.querySelector('.app-id').textContent === selectedApp.identifier
        );
        if (appItem) {
            const badgeContainer = appItem.children[1];
            badgeContainer.innerHTML = '<span class="badge running">Running</span>';
        }

        startSession(res.session_id, selectedApp.name, res.pid);
        logConsole('System', `Spawned and attached to ${selectedApp.name} (session: ${res.session_id}, pid: ${res.pid})`);
    } catch (e) {
        alert(e.message);
    } finally {
        setLoading(btn, false);
    }
}

async function doSpawnAndRun() {
    if (!selectedApp) return;
    const btn = els.spawnRunBtn;
    setLoading(btn, true, 'Spawning...');
    const code = els.scriptArea.value;
    try {
        const devId = els.devices.value;
        const res = await apiCall(API.SPAWN_AND_RUN, 'POST', {
            device_id: devId,
            identifier: selectedApp.identifier,
            script: code,
            codeshare_uris: codeshareQueue
        });

        // Update app state to running
        selectedApp.pid = res.pid;
        // Update app list UI to show running badge
        const appItem = Array.from(els.appList.children).find(el =>
            el.querySelector('.app-id').textContent === selectedApp.identifier
        );
        if (appItem) {
            const badgeContainer = appItem.children[1];
            badgeContainer.innerHTML = '<span class="badge running">Running</span>';
        }

        startSession(res.session_id, selectedApp.name, res.pid);
        const appSession = getCurrentAppSession();
        appSession.scriptIds.push(res.script_id);
        logConsole('System', 'Spawned and script(s) injected from start.');
    } catch (e) {
        alert(e.message);
    } finally {
        setLoading(btn, false);
    }
}

async function detach() {
    const appSession = getCurrentAppSession();
    if (!appSession || !appSession.sessionId) return;
    const btn = els.detachBtn;
    setLoading(btn, true, 'Detaching...');
    try {
        await apiCall(API.DETACH, 'POST', { session_id: appSession.sessionId });
    } catch (e) { console.warn(e); }

    logConsole('System', 'Detached from session');
    appSession.sessionId = null;
    appSession.scriptIds = [];
    if (appSession.pollInterval) {
        clearTimeout(appSession.pollInterval);
        appSession.pollInterval = null;
    }

    updateSessionUI();
    setLoading(btn, false);
}

async function killApp() {
    if (!selectedApp || !selectedApp.pid) return;
    if (!confirm(`Kill process ${selectedApp.name} (PID ${selectedApp.pid})?`)) return;
    const btn = els.killBtn;
    setLoading(btn, true, 'Killing...');
    try {
        await apiCall(API.KILL, 'POST', { device_id: els.devices.value, pid: selectedApp.pid });
        logConsole('System', `Killed ${selectedApp.name} (pid: ${selectedApp.pid})`);
        // Clear PID and any session state
        selectedApp.pid = null;
        els.sessionPid.textContent = 'Not Running';
        const appSession = appSessions[selectedApp.identifier];
        if (appSession) {
            appSession.sessionId = null;
            appSession.scriptIds = [];
            if (appSession.pollInterval) {
                clearTimeout(appSession.pollInterval);
                appSession.pollInterval = null;
            }
        }
        updateSessionUI();
        loadApps();
    } catch (e) {
        alert(e.message);
    } finally {
        setLoading(btn, false);
    }
}

async function runScript() {
    const btn = els.sendScript;
    setLoading(btn, true, 'Running...');
    try {
        const appSession = getCurrentAppSession();
        if (!appSession || !appSession.sessionId) {
            // Auto-attach if possible
            if (selectedApp) {
                if (selectedApp.pid) await doAttach();
                else await doSpawn();
            } else {
                alert("No session active and no app selected.");
                return;
            }
        }

        const code = els.scriptArea.value;
        const currentAppSession = getCurrentAppSession();
        try {
            const res = await apiCall(API.SCRIPT, 'POST', {
                session_id: currentAppSession.sessionId,
                script: code
            });
            currentAppSession.scriptIds.push(res.script_id);
            logConsole('System', 'Script loaded successfully.');
        } catch (e) {
            logConsole('Error', e.message);
        }
    } finally {
        setLoading(btn, false);
    }
}

/* END Buton Action Handlers */


async function pollMessages() {
    const appSession = getCurrentAppSession();
    if (!appSession || !appSession.sessionId) return;

    // Check session liveness
    try {
        const alive = await apiCall(API.SESSION_ALIVE(appSession.sessionId));
        if (!alive.alive) {
            logConsole('System', 'Session ended (process not running)');
            appSession.sessionId = null;
            appSession.scriptIds = [];
            if (appSession.pollInterval) {
                clearTimeout(appSession.pollInterval);
                appSession.pollInterval = null;
            }
            updateSessionUI();
            loadApps();
            return;
        }
    } catch (e) {
        console.warn('Session alive check failed', e);
    }

    if (appSession.scriptIds.length === 0) {
        // nothing to poll; schedule next check
        appSession.pollInterval = setTimeout(pollMessages, 1000);
        return;
    }

    for (const sid of appSession.scriptIds) {
        try {
            const msgs = await apiCall(API.SCRIPT_MESSAGES(sid));
            msgs.forEach(m => {
                const msg = m.message || {};
                // payload may appear in msg.payload or in the binary/data arg depending on message type
                const payload = msg.payload !== undefined ? msg.payload : (m.data !== undefined ? m.data : null);

                if (msg.type === 'send') {
                    // Our console wrapper sends payloads like: { __console: { level: 'log'|'error', payload: [ ...parts ] } }
                    if (payload && payload.__console) {
                        const level = (payload.__console.level || 'log').toUpperCase();
                        const parts = payload.__console.payload || [];
                        const text = parts.join(' ');
                        logConsole(level, text);
                    } else {
                        const text = (typeof payload === 'string') ? payload : JSON.stringify(payload);
                        logConsole('Script', text);
                    }
                } else if (msg.type === 'log') {
                    const text = payload !== null ? ((typeof payload === 'string') ? payload : JSON.stringify(payload)) : JSON.stringify(msg);
                    logConsole('Log', text);
                } else if (msg.type === 'error') {
                    const desc = msg.description || JSON.stringify(msg);
                    const stack = msg.stack || '';
                    logConsole('Error', desc + '\n' + stack);
                } else {
                    logConsole('Msg', JSON.stringify(m));
                }
            });
        } catch (e) {
            console.warn('Poll error for ' + sid, e);
            // If fetching messages fails repeatedly it's possible the session died; double-check liveness
            try {
                const aliveCheck = await apiCall(API.SESSION_ALIVE(appSession.sessionId));
                if (!aliveCheck.alive) {
                    logConsole('System', 'Session ended (process not running)');
                    appSession.sessionId = null;
                    appSession.scriptIds = [];
                    if (appSession.pollInterval) {
                        clearTimeout(appSession.pollInterval);
                        appSession.pollInterval = null;
                    }
                    updateSessionUI();
                    loadApps();
                    return;
                }
            } catch (ee) { /* ignore */ }
        }
    }

    if (appSession.sessionId) {
        appSession.pollInterval = setTimeout(pollMessages, 1000);
    }
}

function logConsole(source, text) {
    const time = new Date().toLocaleTimeString();

    // Store in app's log history
    const appSession = ensureAppSession();
    if (appSession) {
        appSession.consoleLog.push({ time, source, text });
    }

    // Clear empty state message if present
    const emptyMsg = els.consoleOutput.querySelector('.status-msg');
    if (emptyMsg) {
        els.consoleOutput.innerHTML = '';
    }

    // Display in console
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerHTML = `<span class="ts">[${time}] ${source}:</span> <span class="data">${escapeHtml(text)}</span>`;
    els.consoleOutput.appendChild(div);
    els.consoleOutput.scrollTop = els.consoleOutput.scrollHeight;
}
// Download current console output as a .txt file
function downloadConsole() {
    const text = els.consoleOutput.innerText || '';
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (selectedApp && selectedApp.identifier) ? selectedApp.identifier.replace(/[^\w.-]/g, '_') : 'console';
    const ts = new Date().toISOString().replace(/[:]/g, '-').split('.')[0];
    a.href = url;
    a.download = `${safeName}-${ts}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

// Download current editor script as a .js file
function downloadScript() {
    // Prefer Monaco editor content if available
    const code = (typeof monacoEditor !== 'undefined' && monacoEditor) ? monacoEditor.getValue() : (els.scriptArea && els.scriptArea.value ? els.scriptArea.value : '');
    const safeName = (selectedApp && selectedApp.identifier) ? selectedApp.identifier.replace(/[^\w.-]/g, '_') : 'noapp';
    const ts = new Date().toISOString().replace(/[:]/g, '-').split('.')[0];

    const blob = new Blob([code], { type: 'application/javascript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}-${ts}.js`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

/* START CodeShare Queue Logic */

function renderCodeshareQueue() {

    // Restore codeshare queue from localStorage
    try {
        const saved = localStorage.getItem(QUEUE_KEY);
        if (saved) codeshareQueue = JSON.parse(saved);
    } catch (e) { /* ignore */ }

    const list = els.codeshareList;
    list.innerHTML = '';

    if (codeshareQueue.length === 0) {
        list.innerHTML = '<div class="status-msg">No scripts in queue. Add a CodeShare URI above.</div>';
        return;
    }

    codeshareQueue.forEach((uri, index) => {
        const div = document.createElement('div');
        div.className = 'codeshare-item';

        const span = document.createElement('span');
        span.textContent = uri;
        span.className = 'codeshare-uri';

        const controls = document.createElement('div');
        controls.className = 'codeshare-controls';

        const upBtn = document.createElement('button');
        upBtn.textContent = '⬆';
        upBtn.className = 'icon-btn';
        upBtn.title = 'Move up';
        upBtn.setAttribute('aria-label', 'Move up');
        upBtn.onclick = () => moveCodeshare(index, -1);

        const downBtn = document.createElement('button');
        downBtn.textContent = '⬇';
        downBtn.className = 'icon-btn';
        downBtn.title = 'Move down';
        downBtn.setAttribute('aria-label', 'Move down');
        downBtn.onclick = () => moveCodeshare(index, 1);

        const delBtn = document.createElement('button');
        delBtn.textContent = '✖';
        delBtn.className = 'icon-btn btn-delete';
        delBtn.title = 'Remove from queue';
        delBtn.setAttribute('aria-label', 'Remove from queue');
        delBtn.onclick = () => removeCodeshare(index);

        controls.appendChild(upBtn);
        controls.appendChild(downBtn);
        controls.appendChild(delBtn);

        div.appendChild(span);
        div.appendChild(controls);
        list.appendChild(div);
    });
}

function saveCodeshareQueue() {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(codeshareQueue)); } catch (e) { console.warn('Failed to save codeshare queue', e); }
}

function addCodeshare() {
    const input = els.codeshareUri;
    let uri = input.value.trim();
    if (!uri) return;

    if (uri.startsWith("https://") && !uri.includes("codeshare.frida.re")) {
        alert("Invalid CodeShare URI. Must be a codeshare.frida.re URL or owner/slug format.");
        return;
    }

    // Clean up URI if full URL is passed
    if (uri.startsWith("https://codeshare.frida.re/")) {
        uri = uri.replace("https://codeshare.frida.re/", "");
    }

    // Remove leading/trailing slashes and leading @
    uri = uri.replace(/^\/+|\/+$/g, '').replace(/^@+/, '');

    const parts = uri.split("/");
    if (parts.length != 2) {
        alert("Invalid CodeShare URI. Expected format: owner/project-slug");
        return;
    }

    if (codeshareQueue.includes(uri)) {
        input.value = '';
        return;
    }

    codeshareQueue.push(uri);
    input.value = '';
    saveCodeshareQueue();
    renderCodeshareQueue();
}

function removeCodeshare(index) {
    codeshareQueue.splice(index, 1);
    saveCodeshareQueue();
    renderCodeshareQueue();
}

function moveCodeshare(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= codeshareQueue.length) return;
    const item = codeshareQueue.splice(index, 1)[0];
    codeshareQueue.splice(newIndex, 0, item);
    saveCodeshareQueue();
    renderCodeshareQueue();
}

async function loadCodeshareSequence() {
    const appSession = getCurrentAppSession();
    if (!appSession || !appSession.sessionId) {
        // Try auto-attach if app selected
        if (selectedApp) {
            if (selectedApp.pid) await doAttach();
            else await doSpawn();
        } else {
            alert('Attach to a session first');
            return;
        }
    }
    if (codeshareQueue.length === 0) return;

    const currentAppSession = getCurrentAppSession();
    logConsole('System', 'Loading CodeShare sequence...');
    for (const uri of codeshareQueue) {
        try {
            logConsole('System', `Fetching ${uri}...`);
            const res = await apiCall(API.CODESHARE_LOAD, 'POST', { session_id: currentAppSession.sessionId, uri });
            currentAppSession.scriptIds.push(res.script_id);
            logConsole('System', `Loaded ${uri}`);
        } catch (e) {
            logConsole('Error', `Failed to load ${uri}: ${e.message}`);
        }
    }
}

/* END CodeShare Queue Logic */

// Monaco Editor integration
function loadMonaco() {
    return new Promise((resolve, reject) => {
        if (window.require && window.monaco) return resolve();
        const loader = document.createElement('script');
        loader.src = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.40.0/min/vs/loader.min.js';
        loader.onload = () => {
            // Configure AMD loader to use CDN path
            require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.40.0/min/vs' } });
            require(['vs/editor/editor.main'], () => resolve(), reject);
        };
        loader.onerror = reject;
        document.head.appendChild(loader);
    });
}

function setupMonacoEditor() {
    if (!els.scriptEditor) return;
    loadMonaco().then(() => {
        monacoEditor = monaco.editor.create(els.scriptEditor, {
            value: els.scriptArea.value || '',
            language: 'javascript',
            automaticLayout: true,
            minimap: { enabled: false },
            fontSize: 13,
            theme: 'vs-dark',
            scrollBeyondLastLine: false,
        });
        // Sync Monaco -> textarea
        monacoEditor.getModel().onDidChangeContent(() => {
            const text = monacoEditor.getValue();
            const ta = els.scriptArea;
            if (ta) ta.value = text;
            updateEditorHint();
        });
        // Show the Monaco editor and hide the fallback textarea
        const ta = els.scriptArea;
        try {
            els.scriptEditor.classList.remove('hidden');
            if (ta) ta.classList.add('hidden');
        } catch (err) { /* ignore */ }

        updateEditorHint();
    }).catch(e => {
        console.warn('Failed to load Monaco editor', e);
        // Ensure fallback textarea is visible
        const ta = els.scriptArea;
        try {
            if (ta) ta.classList.remove('hidden');
            els.scriptEditor.classList.add('hidden');
        } catch (err) { /* ignore */ }
        try { logConsole('System', 'Monaco editor failed to load; falling back to plain textarea'); } catch (err) { /* log might not be ready */ }
    });
}

// Expandable Console Mode
function setConsoleMode(enabled) {
    const consoleEl = document.getElementById('consoleContainer');
    const btn = els.toggleConsoleBtn;

    if (enabled) {
        consoleEl.dataset.savedHeight = consoleEl.style.height || '';
        consoleEl.dataset.savedFlex = consoleEl.style.flex || '';
        consoleEl.style.height = '';
        consoleEl.style.flex = '1 1 100%';
    } else {
        if ('savedHeight' in consoleEl.dataset) {
            consoleEl.style.height = consoleEl.dataset.savedHeight;
            delete consoleEl.dataset.savedHeight;
        }
        if ('savedFlex' in consoleEl.dataset) {
            consoleEl.style.flex = consoleEl.dataset.savedFlex;
            delete consoleEl.dataset.savedFlex;
        }
    }

    document.body.classList.toggle('console-only', enabled);
    btn.setAttribute('aria-pressed', String(enabled));
    btn.textContent = enabled ? '🗗' : '🗖';
    btn.title = enabled ? 'Exit Expanded Console' : 'Expand Console';
    btn.setAttribute('aria-label', enabled ? 'Exit Expanded Console' : 'Expand Console');
}

function toggleConsoleMode() {
    const enabled = !document.body.classList.contains('console-only');
    setConsoleMode(enabled);
}

// Expandable Editor Mode
function setEditorMode(enabled) {
    const editorEl = document.getElementById('editorContainer');
    const btn = els.toggleEditorBtn;

    if (enabled) {
        editorEl.dataset.savedHeight = editorEl.style.height || '';
        editorEl.dataset.savedFlex = editorEl.style.flex || '';
        editorEl.style.height = '';
        editorEl.style.flex = '1 1 100%';
    } else {
        if ('savedHeight' in editorEl.dataset) {
            editorEl.style.height = editorEl.dataset.savedHeight;
            delete editorEl.dataset.savedHeight;
        }
        if ('savedFlex' in editorEl.dataset) {
            editorEl.style.flex = editorEl.dataset.savedFlex;
            delete editorEl.dataset.savedFlex;
        }
    }

    document.body.classList.toggle('editor-only', enabled);
    btn.setAttribute('aria-pressed', String(enabled));
    btn.textContent = enabled ? '🗗' : '🗖';
    btn.title = enabled ? 'Exit Expanded Editor' : 'Expand Editor';
    btn.setAttribute('aria-label', enabled ? 'Exit Expanded Editor' : 'Expand Editor');
}

function toggleEditorMode() {
    const enabled = !document.body.classList.contains('editor-only');
    setEditorMode(enabled);
}

// --- Resizing Logic ---
function setupResizer(resizerId, targetId, direction, property, invert = false, minSize = 50, maxSize = null) {
    const resizer = document.getElementById(resizerId);
    const target = document.getElementById(targetId);
    if (!resizer || !target) return;

    let startPos, startSize;

    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        resizer.classList.add('resizing');
        startPos = direction === 'v' ? e.clientY : e.clientX;

        if (property === 'flex-basis') {
            const flexStyle = window.getComputedStyle(target).flexBasis;
            startSize = parseInt(flexStyle) || target.offsetHeight;
        } else {
            startSize = direction === 'v' ? target.offsetHeight : target.offsetWidth;
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    function onMouseMove(e) {
        const currentPos = direction === 'v' ? e.clientY : e.clientX;
        const delta = currentPos - startPos;
        let newSize = invert ? startSize - delta : startSize + delta;

        if (newSize < minSize) newSize = minSize;
        if (maxSize && newSize > maxSize) newSize = maxSize;

        if (property === 'flex-basis') {
            target.style.flex = `0 0 ${newSize}px`;
        } else {
            target.style[property] = `${newSize}px`;
            if (targetId === 'editorContainer' || targetId === 'consoleContainer') target.style.flex = 'none';
        }
    }

    function onMouseUp() {
        resizer.classList.remove('resizing');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        localStorage.setItem(`size-${targetId}`, target.style[property] || target.style.flex);
    }

    const savedSize = localStorage.getItem(`size-${targetId}`);
    if (savedSize) {
        if (property === 'flex-basis') target.style.flex = savedSize;
        else {
            target.style[property] = savedSize;
            if (targetId === 'editorContainer' || targetId === 'consoleContainer') target.style.flex = 'none';
        }
    }
}


// Restore search string from localStorage
if (localStorage.getItem(SEARCH_KEY)) {
    els.appSearch.value = localStorage.getItem(SEARCH_KEY);
}

// Setup resizers
setupResizer('sidebarResizer', 'sidebar', 'h', 'width', false, 200, 600);
setupResizer('editorResizer', 'editorContainer', 'v', 'height', false, 100, 800);
setupResizer('consoleResizer', 'consoleContainer', 'v', 'height', true, 50, 600);

/* START Event Listeners Setup */

// Global Shortcuts
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const remoteForm = els.remoteForm;
        if (remoteForm && remoteForm.classList.contains('show')) {
            closeRemoteForm();
        } else if (document.body.classList.contains('editor-only')) {
            setEditorMode(false);
        } else if (document.body.classList.contains('console-only')) {
            setConsoleMode(false);
        } else if (selectedApp) {
            deselectApp();
        }
    }
});
// App search input
els.appSearch.oninput = function () {
    localStorage.setItem(SEARCH_KEY, els.appSearch.value);
    // Reset scroll when filtering
    localStorage.setItem(APP_LIST_SCROLL_KEY, '0');
    renderApps();
}
// Save scroll position to localStorage
els.appList.addEventListener('scroll', function () {
    localStorage.setItem(APP_LIST_SCROLL_KEY, els.appList.scrollTop);
});
// Refresh devices button
els.refreshDevices.onclick = loadDevices;
els.devices.onchange = () => {
    localStorage.setItem(SELECTED_DEVICE_KEY, els.devices.value);
    updateDisconnectButton();
    loadApps();
};
// Add/disconnect remote device
els.toggleRemoteBtn.onclick = toggleRemoteForm;
els.connectRemoteBtn.onclick = addRemoteDevice;
els.cancelRemoteBtn.onclick = closeRemoteForm;
els.disconnectRemoteBtn.onclick = disconnectRemoteDevice;
// Enter key in remote inputs
els.remoteHost.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addRemoteDevice(); } });
els.remotePort.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addRemoteDevice(); } });
// Refresh apps list button
els.refreshApps.onclick = loadApps;
els.attachBtn.onclick = doAttach;
els.spawnBtn.onclick = doSpawn;
els.killBtn.onclick = killApp;
els.detachBtn.onclick = detach;
els.spawnRunBtn.onclick = doSpawnAndRun;
els.sendScript.onclick = runScript;
// Clear console
if (els.clearConsoleBtn) els.clearConsoleBtn.onclick = () => {
    const appSession = getCurrentAppSession();
    if (appSession) {
        appSession.consoleLog = [];
    }
    els.consoleOutput.innerHTML = '<div class="status-msg">No console output yet. Run a script or attach to see messages.</div>';
};
// Download console
if (els.downloadConsoleBtn) els.downloadConsoleBtn.onclick = downloadConsole;
// Download script
if (els.downloadScriptBtn) els.downloadScriptBtn.onclick = downloadScript;
// Load file into editor
if (els.loadFileBtn && els.loadFileInput) {
    els.loadFileBtn.onclick = () => els.loadFileInput.click();
    els.loadFileInput.onchange = async (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        try {
            const text = await f.text();
            els.scriptArea.value = text;
            if (monacoEditor) monacoEditor.setValue(text);
            if (els.loadedFilename) {
                els.loadedFilename.textContent = f.name;
                els.loadedFilename.classList.remove('hidden');
            }
            logConsole('System', `Loaded file: ${f.name}`);
            updateEditorHint();
        } catch (err) {
            logConsole('Error', `Failed to read file: ${err.message}`);
        }
    };

    if (els.editorContainer) els.editorContainer.addEventListener('dragenter', (ev) => { ev.preventDefault(); if (els.scriptArea) els.scriptArea.classList.add('dragover'); if (els.scriptEditor) els.scriptEditor.classList.add('dragover'); });
    if (els.editorContainer) els.editorContainer.addEventListener('dragover', (ev) => { ev.preventDefault(); if (els.scriptArea) els.scriptArea.classList.add('dragover'); if (els.scriptEditor) els.scriptEditor.classList.add('dragover'); });
    if (els.editorContainer) els.editorContainer.addEventListener('dragleave', (ev) => { ev.preventDefault(); if (els.scriptArea) els.scriptArea.classList.remove('dragover'); if (els.scriptEditor) els.scriptEditor.classList.remove('dragover'); });
    if (els.editorContainer) els.editorContainer.addEventListener('drop', async (ev) => {
        ev.preventDefault();
        if (els.scriptArea) els.scriptArea.classList.remove('dragover');
        if (els.scriptEditor) els.scriptEditor.classList.remove('dragover');
        const files = ev.dataTransfer && ev.dataTransfer.files;
        if (!files || files.length === 0) return;
        const f = files[0];
        try {
            const text = await f.text();
            els.scriptArea.value = text;
            if (monacoEditor) monacoEditor.setValue(text);
            if (els.loadedFilename) {
                els.loadedFilename.textContent = f.name;
                els.loadedFilename.classList.remove('hidden');
            }
            logConsole('System', `Loaded file via drag-and-drop: ${f.name}`);
            updateEditorHint();
        } catch (err) {
            logConsole('Error', `Failed to read dropped file: ${err.message}`);
        }
    });

    // Show hint when editor is empty; hide it on input or dragover
    function updateEditorHint() {
        if (!els.scriptArea) return;
        if (els.scriptArea.value && els.scriptArea.value.trim().length > 0) {
            if (els.editorContainer) els.editorContainer.classList.add('has-content');
        } else {
            if (els.editorContainer) els.editorContainer.classList.remove('has-content');
            if (els.loadedFilename) {
                els.loadedFilename.textContent = '';
                els.loadedFilename.classList.add('hidden');
            }
        }
    }
    els.scriptArea.addEventListener('input', updateEditorHint);
    // initialize hint state
    updateEditorHint();
}
// CodeShare listeners
els.addCodeshareBtn.onclick = addCodeshare;
els.loadCodeshareSequenceBtn.onclick = loadCodeshareSequence;
els.codeshareUri.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCodeshare(); } });
// Bind console toggle
els.toggleConsoleBtn.addEventListener('click', toggleConsoleMode);
// Bind editor toggle
els.toggleEditorBtn.addEventListener('click', toggleEditorMode);

/* END Event Listeners Setup */


// Init
loadDevices();
renderCodeshareQueue();
setupMonacoEditor();
