/**
 * FechaConta — Agente de Impressão Local
 * Serviço de background — sem interface local.
 * Gerencie impressoras no Dashboard: Configurações → Impressoras.
 *
 * Compilar: npm run build
 * Uso:      fechaconta-agente.exe
 *           fechaconta-agente.exe --uninstall
 */

const net        = require('net');
const { io }     = require('socket.io-client');
const fs         = require('fs');
const path       = require('path');
const os         = require('os');
const { execSync, exec } = require('child_process');

const IS_PKG   = typeof process.pkg !== 'undefined';
const BASE_DIR = IS_PKG ? path.dirname(process.execPath) : __dirname;
const CONFIG_PATH  = path.join(BASE_DIR, 'config.json');
const CACHE_PATH   = path.join(BASE_DIR, 'printers_cache.json');
const APP_NAME     = 'FechaContaAgente';

// ── Configuração padrão (embutida no exe) ────────────────────────────────────
const DEFAULT_SERVER_URL = 'https://fechaconta.app';

const args = process.argv.slice(2);
const logFile = path.join(BASE_DIR, 'agente.log');

// Captura erros não tratados e grava em log ao lado do exe
process.on('uncaughtException', (err) => {
  try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ERRO: ${err.stack}\n`); } catch {}
});
process.on('unhandledRejection', (err) => {
  try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] REJEIÇÃO: ${err}\n`); } catch {}
});

let agentStatus  = 'offline';
let statusMsg    = 'Aguardando configuração.';
let serverSocket = null;
let scanResults  = [];
let isScanRunning = false;

if (args.includes('--uninstall')) { uninstallStartup(); process.exit(0); }

// Oculta a janela do console via Win32 API (necessário pois pkg compila como subsistema console)
if (process.platform === 'win32') {
  const pid = process.pid;
  setTimeout(() => {
    exec(
      `powershell -NoProfile -WindowStyle Hidden -Command ` +
      `"$p=Get-Process -Id ${pid} -EA SilentlyContinue;` +
      `if($p -and $p.MainWindowHandle -ne 0){` +
      `Add-Type -Name W -Namespace W -MemberDefinition '[DllImport(\\"user32.dll\\")] public static extern bool ShowWindow(IntPtr h,int n);';` +
      `[W.W]::ShowWindow($p.MainWindowHandle,0)}"`,
      { windowsHide: true }
    );
  }, 800);
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

async function probeTcp(ip, port = 9100, timeout = 600) {
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

// Portas comuns de impressoras de rede
// 9100 = RAW/JetDirect (ESC/POS, HP, Epson, Bematech...)
// 9101/9102 = portas RAW alternativas
// 515  = LPD/LPR (impressoras de rede legadas)
// 631  = IPP (CUPS / impressoras modernas)
// 6101 = Zebra ZPL
// 4000 = Epson TM série via rede
const PRINTER_PORTS = [9100, 9101, 9102, 515, 631, 6101, 4000];

// Lista impressoras instaladas no Windows via wmic/PowerShell (cobre USB, rede, virtuais)
function getWindowsPrinters() {
  if (process.platform !== 'win32') return [];
  try {
    const raw = execSync(
      'wmic printer get Name,PortName,PrinterStatus /format:csv 2>nul',
      { encoding: 'utf8', timeout: 8000, windowsHide: true }
    );
    const lines = raw.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('Node,'));
    const printers = lines.map(line => {
      const parts = line.split(',');
      if (parts.length < 3) return null;
      const name = (parts[1] || '').trim();
      const portName = (parts[2] || '').trim();
      const statusCode = (parts[3] || '').trim();
      if (!name) return null;
      const statusMap = { '3': 'Pronta', '4': 'Imprimindo', '5': 'Atenção', '6': 'Erro', '7': 'Offline' };
      return { localName: name, portName, status: statusMap[statusCode] || 'Instalada' };
    }).filter(Boolean);
    const skip = /pdf|xps|fax|onenote|microsoft|send to|adobe|bullzip|foxit|doPDF|cutepdf|novapdf/i;
    return printers.filter(p => !skip.test(p.localName));
  } catch (e1) {
    try {
      const raw = execSync(
        'powershell -NoProfile -Command "Get-Printer | Where-Object {$_.Type -ne \'Local\' -or $_.PortName -notmatch \'PORTPROMPT|NUL|FILE|XPS|PDF\'} | Select-Object Name,PortName,PrinterStatus | ConvertTo-Csv -NoTypeInformation" 2>nul',
        { encoding: 'utf8', timeout: 10000, windowsHide: true }
      );
      const lines = raw.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('"Name"'));
      return lines.map(line => {
        const parts = line.replace(/"/g, '').split(',');
        const name = (parts[0] || '').trim();
        const portName = (parts[1] || '').trim();
        const status = (parts[2] || 'Instalada').trim();
        return name ? { localName: name, portName, status } : null;
      }).filter(Boolean);
    } catch {
      return [];
    }
  }
}

function loadScanCache() {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      const data = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
      if (Array.isArray(data.results)) return data.results;
    }
  } catch {}
  return null;
}

function saveScanCache(results) {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify({ results, ts: Date.now() }, null, 2), 'utf8');
  } catch {}
}

async function runLocalScan(background = false) {
  if (isScanRunning) return;
  isScanRunning = true;

  // Scan explícito (solicitado pelo Dashboard) sempre parte do zero
  if (!background) scanResults = [];

  console.log('[scan] Listando impressoras instaladas no Windows...');
  const winPrinters = getWindowsPrinters();
  const freshResults = [...winPrinters];
  winPrinters.forEach(p => console.log(`[scan] Windows: ${p.localName} (${p.portName})`));
  console.log(`[scan] ${winPrinters.length} impressora(s) Windows encontrada(s).`);

  const base = getLocalNetworkBase();
  console.log(`[scan] Escaneando ${base}.1 — ${base}.254 nas portas ${PRINTER_PORTS.join(', ')}...`);

  const BATCH = 20;
  for (let start = 1; start <= 254; start += BATCH) {
    const batch = [];
    for (let i = start; i < start + BATCH && i <= 254; i++) {
      const ip = `${base}.${i}`;
      const portProbes = PRINTER_PORTS.map(port =>
        probeTcp(ip, port).then(ok => ok ? { ip, port } : null)
      );
      batch.push(
        Promise.all(portProbes).then(results => {
          const found = results.filter(Boolean);
          return found.length > 0 ? found[0] : null;
        })
      );
    }
    const results = await Promise.all(batch);
    results.filter(Boolean).forEach(r => {
      freshResults.push(r);
      console.log(`[scan] Rede: ${r.ip}:${r.port}`);
    });
  }

  scanResults = freshResults;
  isScanRunning = false;
  console.log(`[scan] Concluído. ${scanResults.length} impressora(s) no total.`);
  saveScanCache(scanResults);

  // Só envia resultado ao servidor se foi solicitado pelo Dashboard (não background)
  if (!background && serverSocket?.connected) {
    serverSocket.emit('scan_printers_result', { printers: scanResults });
  }
}

// ── Startup Windows ───────────────────────────────────────────────────────────
function installStartup() {
  if (process.platform !== 'win32') return;
  try {
    const vbsPath = path.join(BASE_DIR, 'FechaContaAgente.vbs');
    const exeSafe = process.execPath.replace(/"/g, '""');
    fs.writeFileSync(vbsPath, `CreateObject("WScript.Shell").Run Chr(34) & "${exeSafe}" & Chr(34), 0, False\n`, 'utf8');
    execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${APP_NAME}" /t REG_SZ /d "wscript.exe \\"${vbsPath.replace(/"/g, '\\"')}\\"" /f`, { stdio: 'pipe' });
    console.log('[ok] Registrado no startup via VBS: ' + vbsPath);
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
    console.log('[ok] Atalho criado na Área de Trabalho.');
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
      serverSocket.emit('printer_agent_register', { secret: agentSecret });
    });

    serverSocket.on('printer_agent_accepted', () => {
      agentStatus = 'online';
      statusMsg = 'Agente conectado e pronto. Acesse o Dashboard → Impressoras para buscar impressoras.';
      console.log('[agente] Conectado e pronto para uso.');
    });

    serverSocket.on('printer_agent_rejected', (reason) => {
      agentStatus = 'error';
      statusMsg = `Registro rejeitado: ${reason}`;
      console.error(`[agente] ${statusMsg}`);
      serverSocket.disconnect();
    });

    serverSocket.on('do_print', ({ ip, port = 9100, localName, data }) => {
      if (!data?.length) return;

      if (localName) {
        console.log(`[agente] Imprimindo via spooler Windows -> "${localName}"`);
        const tmpBin = path.join(os.tmpdir(), `fc_print_${Date.now()}.bin`);
        const tmpPs  = path.join(os.tmpdir(), `fc_ps_${Date.now()}.ps1`);
        try {
          fs.writeFileSync(tmpBin, Buffer.from(data));

          // ── Método 1: PowerShell + winspool.drv (raw print sem precisar de compartilhamento) ──
          const escapedName = localName.replace(/'/g, "''");
          const escapedBin  = tmpBin.replace(/'/g, "''");
          // Monta o script PS1 via concatenação para evitar conflito com template literals ($var)
          const psLines = [
            'Add-Type -TypeDefinition @"',
            'using System;',
            'using System.Runtime.InteropServices;',
            'public class FcRaw {',
            '    [StructLayout(LayoutKind.Sequential)]',
            '    public class DI {',
            '        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;',
            '        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;',
            '        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;',
            '    }',
            '    [DllImport("winspool.drv", EntryPoint="OpenPrinterA")] public static extern bool Open(string n, out IntPtr h, IntPtr d);',
            '    [DllImport("winspool.drv")] public static extern bool ClosePrinter(IntPtr h);',
            '    [DllImport("winspool.drv", EntryPoint="StartDocPrinterA")] public static extern int StartDoc(IntPtr h, int l, [In] DI di);',
            '    [DllImport("winspool.drv")] public static extern bool EndDocPrinter(IntPtr h);',
            '    [DllImport("winspool.drv")] public static extern bool StartPagePrinter(IntPtr h);',
            '    [DllImport("winspool.drv")] public static extern bool EndPagePrinter(IntPtr h);',
            '    [DllImport("winspool.drv")] public static extern bool WritePrinter(IntPtr h, IntPtr b, int c, out int w);',
            '}',
            '"@ -Language CSharp',
            '$h = [IntPtr]::Zero',
            `if (-not [FcRaw]::Open('${escapedName}', [ref]$h, [IntPtr]::Zero)) { throw "Impressora nao encontrada: ${escapedName}" }`,
            `$bytes = [System.IO.File]::ReadAllBytes('${escapedBin}')`,
            '$di = New-Object FcRaw+DI; $di.pDocName = "FechaConta"; $di.pDataType = "RAW"',
            '[FcRaw]::StartDoc($h, 1, $di) | Out-Null',
            '[FcRaw]::StartPagePrinter($h) | Out-Null',
            '$ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)',
            '[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)',
            '$w = 0',
            '[FcRaw]::WritePrinter($h, $ptr, $bytes.Length, [ref]$w) | Out-Null',
            '[System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)',
            '[FcRaw]::EndPagePrinter($h) | Out-Null',
            '[FcRaw]::EndDocPrinter($h) | Out-Null',
            '[FcRaw]::ClosePrinter($h) | Out-Null',
          ];
          fs.writeFileSync(tmpPs, psLines.join('\r\n'), 'utf8');
          try {
            execSync(
              `powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${tmpPs}"`,
              { windowsHide: true, stdio: 'pipe', timeout: 15000 }
            );
            console.log(`[agente] OK winspool "${localName}"`);
            serverSocket.emit('printer_agent_result', { success: true, localName });
            return;
          } catch (psErr) {
            console.warn(`[agente] winspool falhou (${psErr.message}), tentando via porta TCP...`);
          }

          // ── Método 2: detecta IP da porta da impressora e imprime via TCP ──
          const winPrinters = getWindowsPrinters();
          const found = winPrinters.find(p => p.localName === localName);
          if (found?.portName) {
            const ipMatch = found.portName.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
            if (ipMatch) {
              const printerIp = ipMatch[1];
              console.log(`[agente] Tentando TCP ${printerIp}:9100 via porta "${found.portName}"...`);
              const client2 = new net.Socket();
              let fin2 = false;
              const done2 = () => { if (!fin2) { fin2 = true; client2.destroy(); } };
              client2.setTimeout(6000);
              client2.connect(9100, printerIp, () => {
                client2.write(Buffer.from(data), () => {
                  console.log(`[agente] OK TCP porta ${printerIp}`);
                  serverSocket.emit('printer_agent_result', { success: true, localName });
                  setTimeout(done2, 300);
                });
              });
              client2.on('timeout', () => { serverSocket.emit('printer_agent_result', { success: false, localName, error: 'Timeout TCP' }); done2(); });
              client2.on('error', e3 => { serverSocket.emit('printer_agent_result', { success: false, localName, error: e3.message }); done2(); });
              return;
            }
          }

          // ── Método 3: copia para a porta USB diretamente (ex: USB001) ──
          const portName = found?.portName || '';
          if (/^USB\d+$/i.test(portName)) {
            try {
              execSync(`copy /b "${tmpBin}" "\\\\.\\${portName}"`, { windowsHide: true, stdio: 'pipe' });
              console.log(`[agente] OK porta USB "${portName}"`);
              serverSocket.emit('printer_agent_result', { success: true, localName });
              return;
            } catch (usbErr) {
              console.warn(`[agente] porta USB falhou: ${usbErr.message}`);
            }
          }

          // ── Fallback final: erro com diagnóstico útil ──
          const detail = found ? `portName="${found.portName}"` : 'impressora não encontrada no sistema';
          const msg = `Não foi possível imprimir em "${localName}" (${detail}). Verifique se a impressora está ligada e instalada corretamente.`;
          console.error(`[agente] ${msg}`);
          serverSocket.emit('printer_agent_result', { success: false, localName, error: msg });
        } finally {
          try { fs.unlinkSync(tmpBin); } catch {}
          try { fs.unlinkSync(tmpPs); } catch {}
        }
        return;
      }

      if (!ip) return;
      console.log(`[agente] Imprimindo via TCP -> ${ip}:${port}`);
      const client = new net.Socket();
      let finished = false;
      const done = () => { if (!finished) { finished = true; client.destroy(); } };
      client.setTimeout(6000);
      client.connect(port, ip, () => {
        client.write(Buffer.from(data), () => {
          console.log(`[agente] OK TCP ${ip}`);
          serverSocket.emit('printer_agent_result', { success: true, ip });
          setTimeout(done, 300);
        });
      });
      client.on('timeout', () => { serverSocket.emit('printer_agent_result', { success: false, ip, error: 'Timeout' }); done(); });
      client.on('error', (e) => { serverSocket.emit('printer_agent_result', { success: false, ip, error: e.message }); done(); });
    });

    serverSocket.on('scan_printers_request', () => runLocalScan(false));

    serverSocket.on('disconnect', (reason) => {
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

if (!loadedConfig) {
  loadedConfig = { serverUrl: DEFAULT_SERVER_URL, agentSecret: '' };
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(loadedConfig, null, 2)); } catch {}
  console.log(`[agente] Primeira execução — usando URL padrão: ${DEFAULT_SERVER_URL}`);
}

const cachedPrinters = loadScanCache();
if (cachedPrinters && cachedPrinters.length > 0) {
  scanResults = cachedPrinters;
  console.log(`[agente] ${cachedPrinters.length} impressora(s) carregada(s) do cache.`);
}

if (process.platform === 'win32') {
  installStartup();
  createDesktopShortcut(loadedConfig.serverUrl);
}

startAgent(loadedConfig);

// Varredura em background (atualiza cache; não envia ao servidor)
setTimeout(() => runLocalScan(true), 3000);
