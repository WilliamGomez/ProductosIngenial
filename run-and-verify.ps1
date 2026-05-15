# =============================================================================
# Votometro - run-and-verify.ps1
# -----------------------------------------------------------------------------
# Reinicia limpio el stack y verifica que el frontend (8080) y el backend
# (7071/api) respondan desde el host de Windows.
#
# Uso:
#   1. Abrir PowerShell en E:\AppsIngenial\Votometro
#   2. (Opcional, si la policy lo pide):
#        Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   3. .\run-and-verify.ps1
# =============================================================================

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

function Write-Step($msg) {
    Write-Host ""
    Write-Host "==> $msg" -ForegroundColor Cyan
}

# 1. Liberar puertos por si quedo algo de una sesion previa.
Write-Step "Liberando puertos 8080, 7071, 1433 si hay procesos colgados..."
foreach ($p in 8080, 7071, 1433) {
    $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -ne 'com.docker.backend' -and $proc.ProcessName -ne 'vpnkit') {
            Write-Host ("  - Mato {0} (PID {1}) escuchando en :{2}" -f $proc.ProcessName, $proc.Id, $p)
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
    }
}

# 2. Limpieza profunda del stack.
Write-Step "docker compose down -v (limpia volumen sqldata y red)..."
docker compose down -v --remove-orphans

# 3. Build + up.
Write-Step "docker compose build (con --pull para refrescar bases)..."
docker compose build --pull

Write-Step "docker compose up -d (arrancando servicios)..."
docker compose up -d

# 4. Estado de contenedores.
Write-Step "docker compose ps"
docker compose ps

# 5. Esperar a que el backend reporte healthy/started (depende de SQL + db-init).
Write-Step "Esperando hasta 240s a que el backend reporte healthy/started..."
$deadline = (Get-Date).AddSeconds(240)
while ((Get-Date) -lt $deadline) {
    $state = docker inspect --format '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' votometro-backend 2>$null
    Write-Host ("  backend: {0}" -f $state)
    if ($state -match '^running/(healthy|n/a)$') { break }
    Start-Sleep -Seconds 5
}

# 6. Logs por servicio.
Write-Step "Tail de logs (ultimas 30 lineas por servicio):"
foreach ($svc in 'database', 'db-init', 'backend', 'frontend') {
    Write-Host ""
    Write-Host "--- $svc ---" -ForegroundColor Yellow
    docker compose logs --tail=30 $svc
}

# 7. Prueba de fuego HTTP.
function Test-Endpoint($url) {
    Write-Host ""
    Write-Host "--> GET $url" -ForegroundColor Cyan
    try {
        $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10 -MaximumRedirection 3
        $code = [int]$resp.StatusCode
        $color = if ($code -ge 200 -and $code -lt 400) { 'Green' } else { 'Yellow' }
        Write-Host ("    HTTP {0} - {1} bytes" -f $code, $resp.RawContentLength) -ForegroundColor $color
        return $true
    } catch [System.Net.WebException] {
        if ($_.Exception.Response) {
            $code = [int]$_.Exception.Response.StatusCode
            Write-Host ("    HTTP {0} (respuesta del servidor, no es down)" -f $code) -ForegroundColor Yellow
            return $true
        }
        Write-Host ("    FALLA: {0}" -f $_.Exception.Message) -ForegroundColor Red
        return $false
    } catch {
        Write-Host ("    FALLA: {0}" -f $_.Exception.Message) -ForegroundColor Red
        return $false
    }
}

Write-Step "Prueba de fuego HTTP"
$front    = Test-Endpoint 'http://localhost:8080/'
$back     = Test-Endpoint 'http://localhost:7071/api'
$backRoot = Test-Endpoint 'http://localhost:7071/'

# 8. Resumen.
Write-Step "RESUMEN"
"{0}  Frontend  http://localhost:8080"     -f $(if ($front)    { '[OK]' } else { '[FAIL]' }) | Write-Host
"{0}  Backend   http://localhost:7071/api" -f $(if ($back)     { '[OK]' } else { '[FAIL]' }) | Write-Host
"{0}  Backend   http://localhost:7071/"    -f $(if ($backRoot) { '[OK]' } else { '[FAIL]' }) | Write-Host

if (-not ($front -and ($back -or $backRoot))) {
    Write-Host ""
    Write-Host "Algun endpoint fallo. Pistas rapidas:" -ForegroundColor Yellow
    Write-Host "  - 'docker compose logs -f backend'   -> ver crash del Functions host"
    Write-Host "  - 'docker compose logs -f db-init'   -> ver si los .sql aplicaron"
    Write-Host "  - 'docker compose ps'                -> ver Up/Exit de cada servicio"
    Write-Host "  - 'Test-NetConnection localhost -Port 7071' -> confirmar binding TCP"
    exit 1
}

Write-Host ""
Write-Host "Listo. Stack arriba y endpoints respondiendo." -ForegroundColor Green
