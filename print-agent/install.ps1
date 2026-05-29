# FechaConta — Instalador Silencioso do Agente de Impressão
# Uso: powershell -ExecutionPolicy Bypass -File install.ps1 -ServerUrl "https://seusite.com" -AgentSecret "senha"
#
# Parâmetros opcionais para deploy em massa (sem interação):
#   -ServerUrl    URL do servidor FechaConta
#   -AgentSecret  Senha do agente (AGENT_SECRET)
#   -InstallDir   Pasta de instalação (padrão: C:\FechaContaAgente)

param(
  [string]$ServerUrl   = "",
  [string]$AgentSecret = "",
  [string]$InstallDir  = "C:\FechaContaAgente"
)

$ExeName   = "fechaconta-agente.exe"
$AppName   = "FechaContaAgente"
$ConfigFile = Join-Path $InstallDir "config.json"
$ExePath    = Join-Path $InstallDir $ExeName

Write-Host ""
Write-Host "================================================"
Write-Host "  FechaConta — Instalador do Agente de Impressao"
Write-Host "================================================"
Write-Host ""

# ── Cria pasta de instalação ──────────────────────────────────────────────────
if (-not (Test-Path $InstallDir)) {
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  Write-Host "[ok] Pasta criada: $InstallDir"
}

# ── Solicita parâmetros se não foram passados ─────────────────────────────────
if (-not $ServerUrl) {
  $ServerUrl = Read-Host "URL do servidor FechaConta (ex: https://meusite.com)"
}
if (-not $AgentSecret) {
  $AgentSecret = Read-Host "Senha do agente (AGENT_SECRET)"
}

# ── Baixa o executável do servidor ───────────────────────────────────────────
# O servidor serve o .exe em /download/fechaconta-agente.exe
$DownloadUrl = $ServerUrl.TrimEnd('/') + "/download/fechaconta-agente.exe"

Write-Host "[..] Baixando agente de $DownloadUrl ..."
try {
  Invoke-WebRequest -Uri $DownloadUrl -OutFile $ExePath -UseBasicParsing
  Write-Host "[ok] Agente baixado."
} catch {
  Write-Host "[erro] Falha ao baixar. Verifique a URL e se o servidor está acessível."
  Write-Host "       $_"
  exit 1
}

# ── Salva configuração ────────────────────────────────────────────────────────
$config = @{ serverUrl = $ServerUrl; agentSecret = $AgentSecret } | ConvertTo-Json
Set-Content -Path $ConfigFile -Value $config -Encoding utf8
Write-Host "[ok] Configuração salva em $ConfigFile"

# ── Registra no startup do Windows ───────────────────────────────────────────
$regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
Set-ItemProperty -Path $regPath -Name $AppName -Value $ExePath
Write-Host "[ok] Registrado no startup do Windows."

# ── Cria atalho na Área de Trabalho ──────────────────────────────────────────
$desktopPath = [System.Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "FechaConta Agente.lnk"
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $ExePath
$shortcut.WorkingDirectory = $InstallDir
$shortcut.Description = "Agente de Impressão FechaConta"
$shortcut.Save()
Write-Host "[ok] Atalho criado na Área de Trabalho."

# ── Inicia o agente ───────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[ok] Instalação concluída! Iniciando agente..."
Write-Host ""
Start-Process -FilePath $ExePath -WorkingDirectory $InstallDir
