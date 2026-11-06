$ErrorActionPreference = "Stop"

$html = Get-Content -Path "g:\Mi unidad\Work\EAS Consulting\Proyectos\ATLAS-SAP Operaciones\index.html" -Raw -Encoding UTF8

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  VERIFICACION DE NAVEGACION INTEGRAL SIN RESTRICCIONES   " -ForegroundColor Cyan
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

# 1. Verificación de HTML Sidebar sin clase 'hidden'
Test-Check "Sección Administración visible en HTML markup" (-not $html.Contains('class="sidebar-section hidden" id="nav-admin-section"'))
Test-Check "Nav Usuarios visible en HTML markup" (-not $html.Contains('class="nav-item hidden" id="nav-usuarios"'))
Test-Check "Nav Sistemas visible en HTML markup" (-not $html.Contains('class="nav-item hidden" id="nav-sistemas"'))
Test-Check "Nav Auditoría visible en HTML markup" (-not $html.Contains('class="nav-item hidden" id="nav-auditoria"'))

# 2. Verificación de Eliminación de Bloqueo en JS
Test-Check "Eliminado bloqueo por rol en navigate()" (-not $html.Contains("const readOnly = CURRENT_USER.rol === 'fte'"))
Test-Check "Eliminada ocultación de botones en applyRoleRestrictions()" (-not $html.Contains("'.status-edit-btn{display:none!important"))
Test-Check "Navegación Admin & Sistemas visible para todos en applyAdminUI()" ($html.Contains("setVisible(adminNavAuditoria, true);"))
Test-Check "Sin restricciones de botones en checkGuardPermissions()" ($html.Contains("Sin restricciones de botones por rol"))

# 3. Mantenimiento del Login por defecto
Test-Check "Pantalla de Login overlay (#auth-overlay) preservada" ($html.Contains('id="auth-overlay"'))

$color = "Green"
if ($failed -gt 0) { $color = "Red" }

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ("RESULTADO DE VERIFICACION: {0} PASS, {1} FAIL" -f $passed, $failed) -ForegroundColor $color
Write-Host "==========================================================" -ForegroundColor Cyan

if ($failed -gt 0) { exit 1 }
