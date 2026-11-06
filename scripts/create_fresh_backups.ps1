# Script de Respaldos Integrales (BD PostgreSQL + Aplicativo)
$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$backupsDir = Join-Path $PSScriptRoot "..\backups"
if (-not (Test-Path $backupsDir)) {
    New-Item -ItemType Directory -Path $backupsDir -Force | Out-Null
}

$dbBackupFile = Join-Path $backupsDir "ATLAS_PostgreSQL_DB_Backup_$timestamp.sql"
$codeBackupFile = Join-Path $backupsDir "ATLAS_Project_Code_Backup_$timestamp.zip"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  ATLAS SAP Operations -- Generando Respaldos Actuales     " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Respaldo de Base de Datos desde Proxmox
Write-Host "`n[1/2] Extrayendo dump PostgreSQL desde Proxmox..." -ForegroundColor Yellow
$sshPath = "C:\Windows\System32\OpenSSH\ssh.exe"
& $sshPath -o StrictHostKeyChecking=no root@10.10.10.102 "docker exec -i atlas_postgres pg_dump -U postgres postgres" > $dbBackupFile
if (Test-Path $dbBackupFile) {
    $size = (Get-Item $dbBackupFile).Length
    Write-Host "  ✅ Base de Datos SQL respaldada: $dbBackupFile ($size bytes)" -ForegroundColor Green
}

# 2. Respaldo de Código Fuente (.zip)
Write-Host "`n[2/2] Generando empaquetado Zip del aplicativo..." -ForegroundColor Yellow
$projectRoot = Join-Path $PSScriptRoot ".."
$filesToZip = @(
    (Join-Path $projectRoot "index.html"),
    (Join-Path $projectRoot "styles.css"),
    (Join-Path $projectRoot "server.js"),
    (Join-Path $projectRoot "package.json"),
    (Join-Path $projectRoot "Dockerfile"),
    (Join-Path $projectRoot "docker-compose.yml"),
    (Join-Path $projectRoot "schema_onpremise.sql"),
    (Join-Path $projectRoot "scripts"),
    (Join-Path $projectRoot ".env")
)
Compress-Archive -Path $filesToZip -DestinationPath $codeBackupFile -Force
if (Test-Path $codeBackupFile) {
    $zipSize = (Get-Item $codeBackupFile).Length
    Write-Host "  ✅ Código Fuente Zip respaldado: $codeBackupFile ($zipSize bytes)" -ForegroundColor Green
}

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "  RESPALDOS COMPLETADOS CON ÉXITO                         " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
