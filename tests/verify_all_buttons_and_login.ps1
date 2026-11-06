$ErrorActionPreference = "Stop"

$html = Get-Content -Path "g:\Mi unidad\Work\EAS Consulting\Proyectos\ATLAS-SAP Operaciones\index.html" -Raw -Encoding UTF8

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  VERIFICACION DE FLUJO DE LOGIN Y NAVEGACION COMPLETA    " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$passed = 0
$failed = 0

function Test-Check($name, $condition) {
    if ($condition) {
        $script:passed++
        Write-Host ("[PASS] {0}" -f $name) -ForegroundColor Green
    } else {
        $script:failed++
        Write-Host ("[FAIL] {0}" -f $name) -ForegroundColor Red
    }
}

# 1. Overlay de Autenticacion Inicial
Test-Check "Pantalla de Login overlay por defecto (#auth-overlay)" ($html.Contains('id="auth-overlay"'))
Test-Check "Formulario de Login (#auth-login-form)" ($html.Contains('id="auth-login-form"'))
Test-Check "Campo Correo (#auth-email)" ($html.Contains('id="auth-email"'))
Test-Check "Campo Password (#auth-password)" ($html.Contains('id="auth-password"'))
Test-Check "Boton Iniciar Sesion (#auth-login-btn)" ($html.Contains('id="auth-login-btn"'))

# 2. Funciones de Control Auth
Test-Check "Funcion showAuthOverlay()" ($html.Contains('function showAuthOverlay('))
Test-Check "Funcion hideAuthOverlay()" ($html.Contains('function hideAuthOverlay('))
Test-Check "Funcion doLogin()" ($html.Contains('async function doLogin('))
Test-Check "Funcion doLogout()" ($html.Contains('async function doLogout('))

# 3. Flujo de Navegacion Completa tras Login
Test-Check "Navegacion a Dashboard (navigate('dashboard'))" ($html.Contains("navigate('dashboard')"))
Test-Check "Navegacion a Alertas (navigate('alertas'))" ($html.Contains("navigate('alertas')"))
Test-Check "Navegacion a VOBO (navigate('vobo'))" ($html.Contains("navigate('vobo')"))
Test-Check "Navegacion a Solicitudes (navigate('solicitudes'))" ($html.Contains("navigate('solicitudes')"))
Test-Check "Navegacion a Nuevo RFC (navigate('nuevo'))" ($html.Contains("navigate('nuevo')"))
Test-Check "Navegacion a Nueva Solicitud (navigate('nueva-solicitud'))" ($html.Contains("navigate('nueva-solicitud')"))
Test-Check "Navegacion a Usuarios (navigate('usuarios'))" ($html.Contains("navigate('usuarios')"))
Test-Check "Navegacion a Sistemas (navigate('sistemas'))" ($html.Contains("navigate('sistemas')"))
Test-Check "Navegacion a Auditoria (navigate('auditoria'))" ($html.Contains("navigate('auditoria')"))

# 4. Modales y Chatbot
Test-Check "Chatbot Drawer (ai-copilot-drawer)" ($html.Contains('id="ai-copilot-drawer"'))
Test-Check "Modal Registro Usuario (modal-new-user)" ($html.Contains('id="modal-new-user"'))

$color = "Green"
if ($failed -gt 0) { $color = "Red" }

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ("RESULTADO DE PRUEBAS: {0} PASS, {1} FAIL" -f $passed, $failed) -ForegroundColor $color
Write-Host "==========================================================" -ForegroundColor Cyan

if ($failed -gt 0) { exit 1 }
