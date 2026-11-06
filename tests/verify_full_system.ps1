# ATLAS SAP Operations Suite - Comprehensive End-to-End System Verification
$ErrorActionPreference = 'Stop'

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  EJECUTANDO VERIFICACION INTEGRAL DE SISTEMA Y DATOS" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$baseUrl = "http://easconsulting.fortiddns.com:54321"

# 1. Login & Token Verification
Write-Host "`n1. Autenticacion de Usuario Administrador..." -ForegroundColor Yellow
$loginBody = @{
    email = "admin@easconsulting.com.mx"
    password = "Nosemeolvida01"
} | ConvertTo-Json

$loginResp = Invoke-RestMethod -Uri "$baseUrl/auth/v1/token" -Method Post -ContentType "application/json" -Body $loginBody
if (-not $loginResp.access_token) {
    Write-Host "   [FAIL] Fallo el login administrador" -ForegroundColor Red
    exit 1
}
Write-Host "   [PASS] Login exitoso. Token recibido." -ForegroundColor Green
$headers = @{ Authorization = "Bearer $($loginResp.access_token)" }

# 2. RFCs count & Excel import verification
Write-Host "`n2. Verificando Tabla de RFCs (Carga Excel)..." -ForegroundColor Yellow
$rfcs = Invoke-RestMethod -Uri "$baseUrl/rest/v1/rfcs" -Headers $headers -Method Get
Write-Host "   Total RFCs en DB: $($rfcs.Count)" -ForegroundColor White
if ($rfcs.Count -ge 66) {
    Write-Host "   [PASS] RFCs cargados correctamente desde Excel (Total >= 66)." -ForegroundColor Green
} else {
    Write-Host "   [FAIL] Insuficientes RFCs en la DB: $($rfcs.Count)" -ForegroundColor Red
    exit 1
}

# 3. Solicitudes Verification
Write-Host "`n3. Verificando Tabla de Solicitudes..." -ForegroundColor Yellow
$solicitudes = Invoke-RestMethod -Uri "$baseUrl/rest/v1/solicitudes" -Headers $headers -Method Get
Write-Host "   Total Solicitudes en DB: $($solicitudes.Count)" -ForegroundColor White
if ($solicitudes.Count -gt 0) {
    Write-Host "   [PASS] Solicitudes operativas presentes en DB." -ForegroundColor Green
} else {
    Write-Host "   [FAIL] No hay solicitudes en DB." -ForegroundColor Red
    exit 1
}

# 4. Sistemas SAP / No SAP Verification
Write-Host "`n4. Verificando Catalogo de Sistemas SAP y No SAP..." -ForegroundColor Yellow
$sistemas = Invoke-RestMethod -Uri "$baseUrl/rest/v1/sistemas" -Headers $headers -Method Get
$sapCount = ($sistemas | Where-Object { $_.tipo_sap -eq 'SAP' -or $_.tipo -eq 'SAP' }).Count
$noSapCount = ($sistemas | Where-Object { $_.tipo_sap -eq 'No SAP' -or $_.tipo -eq 'No SAP' -or $_.tipo_sap -eq 'NO SAP' }).Count
Write-Host "   Sistemas SAP: $sapCount, Sistemas No SAP: $noSapCount, Total Sistemas: $($sistemas.Count)" -ForegroundColor White
if ($sistemas.Count -gt 0) {
    Write-Host "   [PASS] Catalogo de sistemas poblado correctamente." -ForegroundColor Green
} else {
    Write-Host "   [FAIL] Faltan sistemas SAP o No SAP." -ForegroundColor Red
    exit 1
}

# 5. Auditoria & Logs Verification
Write-Host "`n5. Verificando Auditoria y Logs..." -ForegroundColor Yellow
$audit = Invoke-RestMethod -Uri "$baseUrl/rest/v1/log_auditoria" -Headers $headers -Method Get
Write-Host "   Total registros de auditoria: $($audit.Count)" -ForegroundColor White
if ($audit.Count -gt 0) {
    Write-Host "   [PASS] Registros de auditoria activos." -ForegroundColor Green
} else {
    Write-Host "   [FAIL] Sin registros de auditoria." -ForegroundColor Red
    exit 1
}

# 6. HTML Encoding Check
Write-Host "`n6. Verificando integridad de codificación HTML (Zero Mojibake)..." -ForegroundColor Yellow
$htmlContent = Invoke-RestMethod -Uri "$baseUrl/" -Method Get
$latin1 = [System.Text.Encoding]::GetEncoding("iso-8859-1")
$mojibakeSeq1 = $latin1.GetString([byte[]]@(0xC3, 0xB1)) # Literal "Ã±"
$mojibakeSeq2 = $latin1.GetString([byte[]]@(0xC3, 0xA2)) # Literal "Ã¢"
if ($htmlContent.Contains($mojibakeSeq1) -or $htmlContent.Contains($mojibakeSeq2)) {
    Write-Host "   [WARN] Encontrado patron mojibake en HTML" -ForegroundColor Red
    exit 1
} else {
    Write-Host "   [PASS] HTML limpio de caracteres corruptos o mojibake." -ForegroundColor Green
}

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "  RESULTADO INTEGRAL: PRUEBAS DE SISTEMA 100% EXITOSAS" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
