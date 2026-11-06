# Test suite to verify Login, Password Recovery, and Modal HTML presence
$ErrorActionPreference = 'Stop'

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  EJECUTANDO SUITE DE PRUEBAS DE VERIFICACION CONTINUA" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$baseUrl = "http://easconsulting.fortiddns.com:54321"

# Test 1: HTTP GET Index Page
Write-Host "`n1. Verificando disponibilidad de pagina principal HTTP GET $baseUrl ..." -ForegroundColor Yellow
$htmlContent = Invoke-RestMethod -Uri "$baseUrl/" -Method Get
if ($htmlContent -match 'modal-new-user' -and $htmlContent -match 'modal-recover-password') {
    Write-Host "   [PASS] La pagina HTML incluye los modales modal-new-user y modal-recover-password." -ForegroundColor Green
} else {
    Write-Host "   [FAIL] Los modales no estan presentes en el HTML servido." -ForegroundColor Red
    exit 1
}

# Test 2: Password Recovery API (/auth/v1/recover)
Write-Host "`n2. Verificando API de Recuperacion de Contrasena (/auth/v1/recover) ..." -ForegroundColor Yellow
$recoverBody = @{
    email = "admin@easconsulting.com.mx"
    method = "security_question"
} | ConvertTo-Json

$recoverResp = Invoke-RestMethod -Uri "$baseUrl/auth/v1/recover" -Method Post -ContentType "application/json" -Body $recoverBody
if ($recoverResp.ok -and $recoverResp.code) {
    Write-Host "   [PASS] Codigo de recuperacion generado exitosamente: $($recoverResp.code)" -ForegroundColor Green
} else {
    Write-Host "   [FAIL] La solicitud de recuperacion de contrasena fallo: $($recoverResp | ConvertTo-Json)" -ForegroundColor Red
    exit 1
}

# Test 3: Login Authentication API (/auth/v1/token)
Write-Host "`n3. Verificando API de Autenticacion (/auth/v1/token) ..." -ForegroundColor Yellow
$loginBody = @{
    email = "admin@easconsulting.com.mx"
    password = "Nosemeolvida01"
} | ConvertTo-Json

$loginResp = Invoke-RestMethod -Uri "$baseUrl/auth/v1/token" -Method Post -ContentType "application/json" -Body $loginBody
if ($loginResp.access_token) {
    Write-Host "   [PASS] Login exitoso. Access Token recibido de forma correcta." -ForegroundColor Green
} else {
    Write-Host "   [FAIL] Fallo el inicio de sesion: $($loginResp | ConvertTo-Json)" -ForegroundColor Red
    exit 1
}

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "  RESULTADO FINAL: TODAS LAS PRUEBAS (3/3) PASARON 100%" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
