# Automated Verification Script for FortiDDNS URL Authentication
$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Verificando Endpoint de Produccion: http://easconsulting.fortiddns.com:54321" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$url = "http://easconsulting.fortiddns.com:54321/auth/v1/token"
$jsonBody = '{"email":"admin@easconsulting.com.mx","password":"Nosemeolvida01"}'

try {
    $wc = New-Object System.Net.WebClient
    $wc.Headers.Add("Content-Type", "application/json")
    $wc.Encoding = [System.Text.Encoding]::UTF8
    $responseJson = $wc.UploadString($url, "POST", $jsonBody)

    Write-Host "1. Estado HTTP: 200 OK" -ForegroundColor Green
    if ($responseJson.Contains("access_token") -and $responseJson.Contains('"role":"admin"')) {
        Write-Host "2. Token JWT Generado Exitosamente." -ForegroundColor Green
        Write-Host "3. Respuesta de Autenticacion Recibida Correctamente." -ForegroundColor Green
        Write-Host ""
        Write-Host "RESULTADO: [PASS] La URL de produccion http://easconsulting.fortiddns.com:54321 esta 100% OPERATIVA." -ForegroundColor Green
    } else {
        throw "Respuesta inesperada: $responseJson"
    }
} catch {
    Write-Host "RESULTADO: [FAIL] Error al conectar a http://easconsulting.fortiddns.com:54321 - $_" -ForegroundColor Red
    exit 1
}
