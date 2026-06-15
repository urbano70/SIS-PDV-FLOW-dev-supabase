/**
 * FechaConta — Agente de Impressão Local
 * Interface gráfica via browser em http://127.0.0.1:3456
 *
 * Compilar: npm run build
 * Uso:      fechaconta-agente.exe
 *           fechaconta-agente.exe --uninstall
 */

const net        = require('net');
const http       = require('http');
const { io }     = require('socket.io-client');
const fs         = require('fs');
const path       = require('path');
const os         = require('os');
const { execSync, exec } = require('child_process');

const IS_PKG   = typeof process.pkg !== 'undefined';
const BASE_DIR = IS_PKG ? path.dirname(process.execPath) : __dirname;
const CONFIG_PATH = path.join(BASE_DIR, 'config.json');
const APP_NAME    = 'FechaContaAgente';
const GUI_PORT    = 3456;

// ── Estado global ─────────────────────────────────────────────────────────────
let agentStatus  = 'offline';   // 'offline' | 'connecting' | 'online' | 'error'
let statusMsg    = 'Aguardando configuração.';
let serverSocket = null;
let scanResults  = [];
let isScanRunning = false;

// Código de emparelhamento gerado uma vez por sessão
const PAIRING_CODE = String(Math.floor(100000 + Math.random() * 900000));
let isPaired = false;

// ── Argumentos ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.includes('--uninstall')) { uninstallStartup(); process.exit(0); }

// ── HTML da interface ─────────────────────────────────────────────────────────
function buildHtml(config) {
  const configured = !!config;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FechaConta — Agente de Impressão</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#E4E3E0;color:#141414;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
.card{background:#fff;border-radius:20px;padding:28px;width:100%;max-width:440px;box-shadow:0 4px 24px rgba(0,0,0,.08)}
.logo{display:flex;align-items:center;gap:10px;margin-bottom:24px}
.logo-dot{width:32px;height:32px;background:#141414;border-radius:50%}
.logo-name{font-size:22px;font-style:italic;font-weight:700;font-family:Georgia,serif}
.status-bar{display:flex;align-items:center;gap:10px;background:#f5f5f3;border-radius:12px;padding:12px 16px;margin-bottom:20px}
.status-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;transition:background .3s}
.status-dot.online{background:#22c55e;box-shadow:0 0 6px #22c55e88}
.status-dot.connecting{background:#f59e0b;animation:pulse 1s infinite}
.status-dot.offline,.status-dot.error{background:#ef4444}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.status-text{font-size:13px;font-weight:600;flex:1}
.section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;opacity:.45;margin-bottom:8px}
label{display:block;font-size:12px;font-weight:600;margin-bottom:4px;opacity:.6}
input{width:100%;border:none;background:#f5f5f3;border-radius:10px;padding:10px 14px;font-size:13px;font-weight:600;outline:none;transition:box-shadow .15s}
input:focus{box-shadow:0 0 0 2px #14141440}
.field{margin-bottom:12px}
.btn{width:100%;padding:12px;border-radius:12px;border:none;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;cursor:pointer;transition:opacity .15s;margin-top:4px}
.btn:hover{opacity:.85}
.btn:active{opacity:.7}
.btn-primary{background:#141414;color:#E4E3E0}
.btn-secondary{background:#f5f5f3;color:#141414;margin-top:8px}
.btn-scan{background:#2563eb;color:#fff;margin-top:0}
.btn:disabled{opacity:.4;cursor:not-allowed}
.divider{height:1px;background:#14141415;margin:20px 0}
.printer-list{margin-top:8px;display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto}
.printer-item{display:flex;align-items:center;justify-content:space-between;background:#f5f5f3;border-radius:10px;padding:10px 14px}
.printer-ip{font-family:monospace;font-size:13px;font-weight:700}
.printer-label{font-size:11px;opacity:.5;margin-top:2px}
.copy-btn{font-size:11px;font-weight:700;background:#141414;color:#fff;border:none;border-radius:7px;padding:4px 10px;cursor:pointer}
.copy-btn:hover{opacity:.8}
.empty{text-align:center;padding:20px;opacity:.4;font-size:13px}
.spin{display:inline-block;animation:spin .8s linear infinite;margin-right:6px}
@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
.alert{background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:10px 14px;font-size:12px;color:#92400e;margin-bottom:16px;line-height:1.5}
.pairing-box{background:#141414;border-radius:16px;padding:18px;margin-bottom:20px;text-align:center}
.pairing-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#E4E3E0;opacity:.5;margin-bottom:8px}
.pairing-code{font-family:monospace;font-size:42px;font-weight:900;letter-spacing:.2em;color:#E4E3E0;line-height:1}
.pairing-hint{font-size:10px;color:#E4E3E0;opacity:.4;margin-top:8px;line-height:1.4}
.paired-badge{background:#22c55e20;border:1px solid #22c55e40;border-radius:10px;padding:8px 14px;font-size:12px;color:#15803d;font-weight:600;margin-bottom:16px;text-align:center}
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <div class="logo-dot"></div>
    <span class="logo-name">FechaConta</span>
    <span style="font-size:11px;opacity:.4;margin-left:auto;font-weight:600">Agente de Impressão</span>
  </div>

  <div class="status-bar">
    <div class="status-dot offline" id="dot"></div>
    <span class="status-text" id="statusText">Carregando...</span>
  </div>

  ${!configured ? `
  <div class="alert">Configure a URL do servidor e a senha para conectar o agente.</div>
  <p class="section-title">Configuração</p>
  <div class="field">
    <label>URL do Servidor</label>
    <input id="serverUrl" type="text" placeholder="https://seusite.com ou http://localhost:3001" />
  </div>
  <div class="field">
    <label>Senha do Agente <span style="font-weight:400;opacity:.6">(deixe em branco se não configurada)</span></label>
    <input id="agentSecret" type="password" placeholder="••••••••" />
  </div>
  <button class="btn btn-primary" onclick="saveConfig()">Salvar e Conectar</button>
  ` : `
  <div class="pairing-box">
    <div class="pairing-label">Código de Conexão</div>
    <div class="pairing-code" id="pairingCode">${PAIRING_CODE}</div>
    <div class="pairing-hint">Insira este código no Dashboard → Configurações → Impressoras</div>
  </div>
  <div id="pairedBadge" class="paired-badge" style="display:none">✓ Emparelhado com o sistema</div>
  <p class="section-title">Servidor</p>
  <div style="background:#f5f5f3;border-radius:10px;padding:10px 14px;margin-bottom:16px;font-size:13px;font-weight:600;font-family:monospace">${config.serverUrl}</div>
  <button class="btn btn-secondary" onclick="resetConfig()">Alterar configuração</button>
  `}

  <div class="divider"></div>

  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
    <p class="section-title" style="margin:0">Impressoras na rede</p>
    <button class="btn btn-scan" id="scanBtn" style="width:auto;padding:7px 14px;font-size:11px" onclick="startScan()">
      🔍 Buscar
    </button>
  </div>
  <div id="scanStatus" style="font-size:11px;opacity:.5;margin-bottom:8px;display:none"></div>
  <div class="printer-list" id="printerList">
    <div class="empty">Clique em "Buscar" para escanear a rede.</div>
  </div>
</div>

<script>
let polling = null;

async function loadStatus() {
  try {
    const r = await fetch('/api/status');
    const d = await r.json();
    const dot = document.getElementById('dot');
    const txt = document.getElementById('statusText');
    dot.className = 'status-dot ' + d.status;
    txt.textContent = d.message;
    const badge = document.getElementById('pairedBadge');
    if (badge) badge.style.display = d.paired ? 'block' : 'none';
  } catch {}
}

async function loadScan() {
  try {
    const r = await fetch('/api/scan-results');
    const d = await r.json();
    renderPrinters(d.results, d.running);
  } catch {}
}

function renderPrinters(results, running) {
  const el = document.getElementById('printerList');
  const btn = document.getElementById('scanBtn');
  const status = document.getElementById('scanStatus');

  if (running) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spin">⟳</span> Buscando...';
    status.style.display = 'block';
    status.textContent = 'Escaneando a rede... aguarde.';
  } else {
    btn.disabled = false;
    btn.innerHTML = '🔍 Buscar';
    status.style.display = 'none';
  }

  if (!results.length) {
    el.innerHTML = running
      ? '<div class="empty">Escaneando...</div>'
      : '<div class="empty">Nenhuma impressora encontrada.</div>';
    return;
  }

  el.innerHTML = results.map(p => \`
    <div class="printer-item">
      <div>
        <div class="printer-ip">\${p.ip}</div>
        <div class="printer-label">Porta \${p.port} • Responde ESC/POS</div>
      </div>
      <button class="copy-btn" onclick="copyIp('\${p.ip}')">Copiar IP</button>
    </div>
  \`).join('');
}

function copyIp(ip) {
  navigator.clipboard.writeText(ip).then(() => {
    alert('IP copiado: ' + ip + '\\nCole no campo IP da impressora no Dashboard.');
  });
}

async function startScan() {
  await fetch('/api/scan', { method: 'POST' });
  loadScan();
  const timer = setInterval(async () => {
    const r = await fetch('/api/scan-results');
    const d = await r.json();
    renderPrinters(d.results, d.running);
    if (!d.running) clearInterval(timer);
  }, 1000);
}

async function saveConfig() {
  const serverUrl = document.getElementById('serverUrl').value.trim().replace(/\\/$/, '');
  const agentSecret = document.getElementById('agentSecret').value.trim();
  if (!serverUrl) { alert('Informe a URL do servidor.'); return; }
  await fetch('/api/config', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ serverUrl, agentSecret }) });
  location.reload();
}

async function resetConfig() {
  if (!confirm('Deseja redefinir a configuração?')) return;
  await fetch('/api/config/reset', { method: 'POST' });
  location.reload();
}

loadStatus();
loadScan();
polling = setInterval(() => { loadStatus(); }, 2000);
</script>
</body>
</html>`;
}

// ── Servidor GUI local ────────────────────────────────────────────────────────
function startGui(getConfig) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buildHtml(getConfig()));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: agentStatus, message: statusMsg, paired: isPaired }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/scan-results') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results: scanResults, running: isScanRunning }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/scan') {
      runLocalScan();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/config') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        try {
          const { serverUrl, agentSecret } = JSON.parse(body);
          fs.writeFileSync(CONFIG_PATH, JSON.stringify({ serverUrl, agentSecret }, null, 2));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          // Reconecta com nova config
          setTimeout(() => startAgent({ serverUrl, agentSecret }), 500);
        } catch {
          res.writeHead(400); res.end('{}');
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/config/reset') {
      if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
      if (serverSocket) { serverSocket.disconnect(); serverSocket = null; }
      agentStatus = 'offline';
      statusMsg = 'Aguardando configuração.';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404); res.end('Not found');
  });

  server.listen(GUI_PORT, '127.0.0.1', () => {
    console.log(`[agente] Interface disponível em http://127.0.0.1:${GUI_PORT}`);
    openBrowser(`http://127.0.0.1:${GUI_PORT}`);
  });
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') exec(`start "" "${url}"`);
    else if (process.platform === 'darwin') exec(`open "${url}"`);
    else exec(`xdg-open "${url}"`);
  } catch {}
}

// ── Scan de rede ─────────────────────────────────────────────────────────────
function getLocalNetworkBase() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const parts = iface.address.split('.');
        return parts.slice(0, 3).join('.');
      }
    }
  }
  return '192.168.1';
}

async function probeTcp(ip, port = 9100, timeout = 800) {
  return new Promise(resolve => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok) => { if (!done) { done = true; sock.destroy(); resolve(ok); } };
    sock.setTimeout(timeout);
    sock.on('connect', () => finish(true));
    sock.on('timeout', () => finish(false));
    sock.on('error', () => finish(false));
    sock.connect(port, ip);
  });
}

async function runLocalScan() {
  if (isScanRunning) return;
  isScanRunning = true;
  scanResults = [];
  const base = getLocalNetworkBase();
  console.log(`[scan] Escaneando ${base}.1 — ${base}.254 na porta 9100...`);

  const BATCH = 30;
  for (let start = 1; start <= 254; start += BATCH) {
    const batch = [];
    for (let i = start; i < start + BATCH && i <= 254; i++) {
      const ip = `${base}.${i}`;
      batch.push(probeTcp(ip, 9100).then(ok => ok ? { ip, port: 9100 } : null));
    }
    const results = await Promise.all(batch);
    results.filter(Boolean).forEach(r => {
      scanResults.push(r);
      console.log(`[scan] Impressora encontrada: ${r.ip}:${r.port}`);
    });
  }

  isScanRunning = false;
  console.log(`[scan] Concluído. ${scanResults.length} impressora(s) encontrada(s).`);

  // Reporta para o Dashboard via socket se conectado
  if (serverSocket?.connected) {
    serverSocket.emit('scan_printers_result', { printers: scanResults });
  }
}

// ── Startup Windows ───────────────────────────────────────────────────────────
function installStartup() {
  if (process.platform !== 'win32') return;
  try {
    execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${APP_NAME}" /t REG_SZ /d "${process.execPath}" /f`, { stdio: 'pipe' });
    console.log('[ok] Registrado no startup do Windows.');
  } catch (e) { console.error('[erro] Startup:', e.message); }
}

function uninstallStartup() {
  if (process.platform !== 'win32') return;
  try { execSync(`reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${APP_NAME}" /f`, { stdio: 'pipe' }); }
  catch { console.log('[info] Startup não encontrado.'); }
  console.log('[ok] Removido do startup.');
}

function createDesktopShortcut(serverUrl) {
  const desktop = path.join(os.homedir(), 'Desktop');
  if (!fs.existsSync(desktop)) return;
  try {
    fs.writeFileSync(path.join(desktop, 'FechaConta.url'), `[InternetShortcut]\r\nURL=${serverUrl}/app/dashboard\r\n`, 'utf8');
    fs.writeFileSync(path.join(desktop, 'FechaConta Agente.url'), `[InternetShortcut]\r\nURL=http://127.0.0.1:${GUI_PORT}\r\n`, 'utf8');
    console.log('[ok] Atalhos criados na Área de Trabalho.');
  } catch {}
}

// ── Agente socket.io ──────────────────────────────────────────────────────────
function startAgent({ serverUrl, agentSecret = '' }) {
  if (serverSocket) { try { serverSocket.disconnect(); } catch {} }

  const resolvedUrl = serverUrl.replace(/localhost/g, '127.0.0.1');
  let reconnectDelay = 3000;

  agentStatus = 'connecting';
  statusMsg = `Conectando em ${serverUrl}...`;

  function connect() {
    agentStatus = 'connecting';
    statusMsg = `Conectando em ${serverUrl}...`;
    console.log(`[agente] Conectando em ${resolvedUrl}...`);

    serverSocket = io(resolvedUrl, {
      transports: ['polling', 'websocket'],
      reconnection: false,
    });

    serverSocket.on('connect', () => {
      console.log(`[agente] Conectado (id=${serverSocket.id})`);
      reconnectDelay = 3000;
      serverSocket.emit('printer_agent_register', { secret: agentSecret, pairingCode: PAIRING_CODE });
    });

    serverSocket.on('printer_agent_accepted', () => {
      agentStatus = 'online';
      statusMsg = 'Conectado ao servidor. Aguardando emparelhamento no Dashboard.';
      console.log('[agente] Online. Código de conexão: ' + PAIRING_CODE);
    });

    serverSocket.on('printer_agent_paired', () => {
      isPaired = true;
      statusMsg = 'Emparelhado! Escaneando impressoras...';
      console.log('[agente] Emparelhado com o Dashboard.');
    });

    serverSocket.on('printer_agent_rejected', (reason) => {
      agentStatus = 'error';
      statusMsg = `Registro rejeitado: ${reason}`;
      console.error(`[agente] ${statusMsg}`);
      serverSocket.disconnect();
    });

    serverSocket.on('do_print', ({ ip, port = 9100, data }) => {
      if (!ip || !data?.length) return;
      console.log(`[agente] Imprimindo -> ${ip}:${port}`);
      const client = new net.Socket();
      let finished = false;
      const done = () => { if (!finished) { finished = true; client.destroy(); } };
      client.setTimeout(6000);
      client.connect(port, ip, () => {
        client.write(Buffer.from(data), () => {
          console.log(`[agente] OK ${ip}`);
          serverSocket.emit('printer_agent_result', { success: true, ip });
          setTimeout(done, 300);
        });
      });
      client.on('timeout', () => { serverSocket.emit('printer_agent_result', { success: false, ip, error: 'Timeout' }); done(); });
      client.on('error', (e) => { serverSocket.emit('printer_agent_result', { success: false, ip, error: e.message }); done(); });
    });

    serverSocket.on('scan_printers_request', () => runLocalScan());

    serverSocket.on('disconnect', (reason) => {
      isPaired = false;
      agentStatus = 'offline';
      statusMsg = `Desconectado (${reason}). Reconectando em ${reconnectDelay / 1000}s...`;
      console.warn(`[agente] ${statusMsg}`);
      setTimeout(() => { reconnectDelay = Math.min(reconnectDelay * 2, 30000); connect(); }, reconnectDelay);
    });

    serverSocket.on('connect_error', (err) => {
      agentStatus = 'error';
      statusMsg = `Falha na conexão: ${err.message}`;
      console.error(`[agente] ${statusMsg}`);
      setTimeout(() => { reconnectDelay = Math.min(reconnectDelay * 2, 30000); connect(); }, reconnectDelay);
    });
  }

  connect();
}

// ── Main ──────────────────────────────────────────────────────────────────────
let loadedConfig = null;
if (fs.existsSync(CONFIG_PATH)) {
  try { loadedConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
}

// Instala startup e atalhos na primeira execução
if (loadedConfig && process.platform === 'win32') {
  installStartup();
  createDesktopShortcut(loadedConfig.serverUrl);
}

// Inicia GUI (sempre)
startGui(() => loadedConfig);

// Conecta ao servidor se já configurado
if (loadedConfig) {
  startAgent(loadedConfig);
} else {
  agentStatus = 'offline';
  statusMsg = 'Aguardando configuração.';
}

console.log(`[agente] Interface em http://127.0.0.1:${GUI_PORT} — abrindo browser...`);
