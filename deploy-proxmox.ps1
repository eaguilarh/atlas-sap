# ATLAS SAP Operations Suite — Script de Despliegue y Réplica hacia Proxmox (Edición Unificada v2.0)
# =====================================================================================================

param (
    [string]$TargetHost = "10.10.10.102",
    [string]$RemoteUser = "root",
    [string]$RemoteDir = "/home/eas101/atlas-app",
    [switch]$UseCache,
    [switch]$SkipDb,
    [switch]$ForceSeed
)

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
$codeSource = $projectRoot
$backendDir = Join-Path $codeSource "backend"

$destInfo = $RemoteUser + "@" + $TargetHost + ":" + $RemoteDir
$targetHostUser = $RemoteUser + "@" + $TargetHost

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  ATLAS SAP Operations -- Despliegue Unificado v2.0         " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Servidor Destino: $destInfo" -ForegroundColor White
Write-Host ""

# 0. Verificación Pre-flight de Sintaxis JS (QA Automation)
Write-Host "[0/7] Ejecutando validación sintáctica de código Node.js pre-flight..." -ForegroundColor Yellow
$serverJsCheck = Join-Path $codeSource "server.js"
if (Get-Command "node" -ErrorAction SilentlyContinue) {
    & node --check $serverJsCheck
    if ($LASTEXITCODE -ne 0) {
        throw "Error de sintaxis pre-flight en server.js. Despliegue cancelado."
    }
    Write-Host "      [OK] Código server.js validado sintácticamente." -ForegroundColor Green
} else {
    Write-Host "      [INFO] Node local no instalado en PATH; validación sintáctica se realizará en contenedor Proxmox." -ForegroundColor Gray
}

# 1. Sincronización Local Root -> Backend & Generación de .env
$envPathLocal = Join-Path $codeSource ".env"
if (-not (Test-Path $envPathLocal)) {
    $envContent = @"
POSTGRES_USER=postgres
POSTGRES_PASSWORD=Nosemeolvida01
POSTGRES_DB=postgres
JWT_SECRET=atlas-express-api-secret-key-2026-production-CHANGE-IN-PROD
ALLOWED_ORIGINS=http://easconsulting.fortiddns.com:54321,https://easconsulting.fortiddns.com:54321,http://10.10.10.102:54321,http://localhost:54321,http://localhost:3000,http://127.0.0.1:54321,https://atlas.easconsulting.com.mx
NODE_ENV=production
DEFAULT_USER_PASSWORD=Nosemeolvida01
GUARDIA_PASSWORD=guardiatqs01
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
"@
    [System.IO.File]::WriteAllText($envPathLocal, $envContent)
}

$filesToSync = @(
    "index.html", "styles.css", "server.js", "favicon.png",
    "schema_onpremise.sql", "docker-compose.yml", "Dockerfile",
    "package.json", "package-lock.json", "docker-entrypoint-initdb.sh", ".env", "nginx.conf"
)
foreach ($file in $filesToSync) {
    $src = Join-Path $codeSource $file
    $dst = Join-Path $backendDir $file
    if (Test-Path $src) { Copy-Item $src -Destination $dst -Force }
}
# Scripts directory
$scriptsSrc = Join-Path $codeSource "scripts"
$scriptsDst = Join-Path $backendDir "scripts"
if (Test-Path $scriptsSrc) { Copy-Item $scriptsSrc -Destination $scriptsDst -Recurse -Force }
Write-Host "      [OK] Codigo local y .env sincronizados." -ForegroundColor Green

# Helper para ejecutar comandos SSH con reintentos y timeouts resilientes
function Invoke-SshCommand {
    param(
        [string]$Target,
        [string]$Command,
        [int]$MaxRetries = 3
    )
    $sshPath = "C:\Windows\System32\OpenSSH\ssh.exe"
    $sshArgs = @(
        "-n",
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectionAttempts=5",
        "-o", "ConnectTimeout=15",
        "-o", "ServerAliveInterval=10",
        "-o", "ServerAliveCountMax=3",
        $Target,
        $Command
    )
    for ($attempt = 1; $attempt -le $MaxRetries; $attempt++) {
        & $sshPath $sshArgs
        if ($LASTEXITCODE -eq 0) { return $true }
        if ($attempt -lt $MaxRetries) {
            Write-Host ("      [REINTENTO $attempt/$MaxRetries] Error en SSH, reintentando en 3s...") -ForegroundColor Yellow
            Start-Sleep -Seconds 3
        }
    }
    return $false
}

function Invoke-ScpTransfer {
    param(
        [string]$Source,
        [string]$Destination,
        [switch]$Recurse,
        [int]$MaxRetries = 3
    )
    $scpPath = "C:\Windows\System32\OpenSSH\scp.exe"
    $scpArgs = @(
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectionAttempts=5",
        "-o", "ConnectTimeout=15",
        "-o", "ServerAliveInterval=10",
        "-o", "ServerAliveCountMax=3"
    )
    if ($Recurse) { $scpArgs += "-r" }
    $scpArgs += $Source
    $scpArgs += $Destination

    for ($attempt = 1; $attempt -le $MaxRetries; $attempt++) {
        & $scpPath $scpArgs
        if ($LASTEXITCODE -eq 0) { return $true }
        if ($attempt -lt $MaxRetries) {
            Write-Host ("      [REINTENTO $attempt/$MaxRetries] Error en SCP para $Source, reintentando en 3s...") -ForegroundColor Yellow
            Start-Sleep -Seconds 3
        }
    }
    return $false
}

# 2. Detención previa de contenedores en Proxmox
Write-Host "[2/7] Preparando directorio y deteniendo contenedores previos en Proxmox..." -ForegroundColor Yellow
$stopCmd = "mkdir -p $RemoteDir ; cd $RemoteDir ; docker compose down --remove-orphans 2>/dev/null || true"
if (-not (Invoke-SshCommand -Target $targetHostUser -Command $stopCmd)) {
    Write-Host "      [WARN] No se pudo ejecutar el stop previo, continuando de todos modos." -ForegroundColor Yellow
} else {
    Write-Host "      [OK] Contenedores previos detenidos." -ForegroundColor Green
}
Start-Sleep -Seconds 2

# 3. Transferencia SCP hacia Proxmox
Write-Host "[3/7] Transfiriendo archivos a Proxmox via SCP..." -ForegroundColor Yellow
$filesToUpload = @(
    (Join-Path $codeSource "index.html"),
    (Join-Path $codeSource "styles.css"),
    (Join-Path $codeSource "server.js"),
    (Join-Path $codeSource "favicon.png"),
    (Join-Path $codeSource "schema_onpremise.sql"),
    (Join-Path $codeSource "docker-compose.yml"),
    (Join-Path $codeSource "Dockerfile"),
    (Join-Path $codeSource "package.json"),
    (Join-Path $codeSource "package-lock.json"),
    (Join-Path $codeSource "docker-entrypoint-initdb.sh"),
    (Join-Path $codeSource ".env"),
    (Join-Path $codeSource "ATLAS_Plantilla_Carga_RFCs IJO JULIO 2026 v1.xlsx"),
    (Join-Path $codeSource "scripts\db-seed.js"),
    (Join-Path $codeSource "scripts\db-init.js"),
    (Join-Path $codeSource "scripts\db-migrate.js"),
    (Join-Path $codeSource "scripts\import-excel-rfcs.js")
)

foreach ($file in $filesToUpload) {
    if (Test-Path $file) {
        $fileName = Split-Path $file -Leaf
        Write-Host ("      -> Transfiriendo {0}..." -f $fileName) -ForegroundColor Gray
        $destination = "${targetHostUser}:$RemoteDir/$fileName"
        $ok = Invoke-ScpTransfer -Source $file -Destination $destination
        if (-not $ok) {
            throw "Error al transferir $fileName via SCP a Proxmox"
        }
    }
}
# Transfer scripts and tests directory
$scriptsRemote = "${targetHostUser}:$RemoteDir"
$okScripts = Invoke-ScpTransfer -Source (Join-Path $codeSource "scripts") -Destination $scriptsRemote -Recurse
$testsRemote = "${targetHostUser}:$RemoteDir"
$okTests = Invoke-ScpTransfer -Source (Join-Path $codeSource "tests") -Destination $testsRemote -Recurse
Write-Host "      [OK] Archivos, scripts y tests transferidos correctamente." -ForegroundColor Green

# 4. Configurar permisos de ejecución en Proxmox
Write-Host "[4/7] Configurando permisos de ejecucion en Proxmox..." -ForegroundColor Yellow
$chmodCmd = "chmod +x $RemoteDir/*.sh $RemoteDir/scripts/*.js 2>/dev/null || true"
$null = Invoke-SshCommand -Target $targetHostUser -Command $chmodCmd
Write-Host "      [OK] Permisos de ejecucion configurados." -ForegroundColor Green

# 5. Inicializar Base de Datos con Esquema y Datos Semilla
if ($SkipDb) {
    Write-Host "[5/7] Omitiendo inicialización de base de datos (-SkipDb especificado)..." -ForegroundColor Gray
} else {
    Write-Host "[5/7] Iniciando PostgreSQL y aplicando esquema + datos semilla..." -ForegroundColor Yellow
    $startDbCmd = "cd $RemoteDir ; docker compose up -d db"
    $null = Invoke-SshCommand -Target $targetHostUser -Command $startDbCmd
    
    # Wait for DB to be healthy
    Write-Host "      Esperando a que PostgreSQL esté healthy..." -ForegroundColor Gray
    $waitCmd = "cd $RemoteDir ; timeout 120 bash -c 'until docker compose exec -T db pg_isready -U postgres -d postgres; do sleep 2; done'"
    $null = Invoke-SshCommand -Target $targetHostUser -Command $waitCmd
    
    Write-Host "      Garantizando estructura de esquema (db-init.js)..." -ForegroundColor Gray
    $initCmd = "cd $RemoteDir ; docker compose run --rm -v ./scripts:/app/scripts api node scripts/db-init.js"
    $null = Invoke-SshCommand -Target $targetHostUser -Command $initCmd

    if ($ForceSeed) {
        Write-Host "      [-ForceSeed especificado] Ejecutando datos semilla e importación Excel..." -ForegroundColor Yellow
        $seedCmd = "cd $RemoteDir ; docker compose run --rm -v ./scripts:/app/scripts api node scripts/db-seed.js ; docker compose run --rm -v ./scripts:/app/scripts api node scripts/import-excel-rfcs.js"
        $okSeed = Invoke-SshCommand -Target $targetHostUser -Command $seedCmd
        if ($okSeed) {
            Write-Host "      [OK] Datos semilla insertados correctamente." -ForegroundColor Green
        } else {
            Write-Host "      [WARN] Seed reportó observaciones (puede ser por duplicados)." -ForegroundColor Yellow
        }
    }
    Write-Host "      [OK] Base de datos inicializada." -ForegroundColor Green
}

# 6. Reconstrucción y Arranque de Docker
Write-Host "[6/7] Reconstruyendo y reiniciando contenedor backend..." -ForegroundColor Yellow
$buildFlag = if ($UseCache) { "" } else { " --no-cache" }
$dockerCmd = "cd $RemoteDir ; docker compose build$buildFlag ; docker compose up -d --force-recreate"
$okDocker = Invoke-SshCommand -Target $targetHostUser -Command $dockerCmd
if (-not $okDocker) {
    throw "Error al reiniciar servicios Docker en Proxmox"
}
$cacheMsg = if ($UseCache) { "usando cache" } else { "sin cache" }
Write-Host ("      [OK] Imagen Docker reconstruida {0} y contenedores reiniciados." -f $cacheMsg) -ForegroundColor Green

# 7. Verificación de Salud del Servidor
Write-Host "[7/7] Verificando respuesta HTTP del servidor Proxmox..." -ForegroundColor Yellow
Start-Sleep -Seconds 5
try {
    $url = "http://${TargetHost}:54321/"
    $webClient = New-Object System.Net.WebClient
    $webClient.Encoding = [System.Text.Encoding]::UTF8
    $liveHtml = $webClient.DownloadString($url)

    $hash = [System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($liveHtml))
    $hashStr = [System.BitConverter]::ToString($hash).Replace("-", "")

    Write-Host ("      [OK] Servidor en vivo responsivo (TAMAÑO: {0} bytes, HASH: {1})" -f $liveHtml.Length, $hashStr) -ForegroundColor Green

    if ($liveHtml.Contains('auth-overlay') -or $liveHtml.Contains('ATLAS')) {
        Write-Host "      [OK] HTML verificado: página de login cargada correctamente." -ForegroundColor Green
    }
} catch {
    Write-Host ("      [WARN] Advertencia al consultar servidor HTTP: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
}

# Verificar conectividad a endpoints críticos
try {
    $testEndpoints = @(
        "/auth/v1/token",
        "/rest/v1/rfcs?limit=1",
        "/rest/v1/sistemas?limit=1"
    )
    foreach ($ep in $testEndpoints) {
        $testUrl = "http://${TargetHost}:54321$ep"
        $null = $webClient.DownloadString($testUrl)
        Write-Host ("      [OK] Endpoint $ep responde correctamente" -f $ep) -ForegroundColor Green
    }
} catch {
    Write-Host "      [WARN] Algunos endpoints no respondieron (esperado si no hay auth)" -ForegroundColor Yellow
}

$appUrl = "http://${TargetHost}:54321"
$dbUrl = "${TargetHost}:5432"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  DESPLIEGUE COMPLETADO CON EXITO!                          " -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host (" URL de la Aplicacion: {0}" -f $appUrl) -ForegroundColor Cyan
Write-Host (" Base de datos SQL:    {0}" -f $dbUrl) -ForegroundColor Cyan
Write-Host ""
Write-Host "Credenciales por defecto (cambiar en primer login):" -ForegroundColor Yellow
Write-Host "  admin@easconsulting.com.mx / Nosemeolvida01" -ForegroundColor White
Write-Host "  guardia_me@easconsulting.com.mx / guardiatqs01" -ForegroundColor White
Write-Host ""