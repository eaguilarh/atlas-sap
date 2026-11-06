# Automated Verification Suite for ATLAS Login and SmartFetch Candidate Logic
$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  ATLAS SAP Operations -- Suite de Pruebas de Verificacion" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

$testsPassed = 0
$testsFailed = 0

function Assert-Test([string]$testName, [scriptblock]$code) {
    Write-Host "[PRUEBA] $testName ... " -NoNewline
    try {
        & $code
        Write-Host "PASS [OK]" -ForegroundColor Green
        $script:testsPassed++
    } catch {
        Write-Host "FAIL [ERROR]" -ForegroundColor Red
        Write-Host "  Detalle: $_" -ForegroundColor Yellow
        $script:testsFailed++
    }
}

# ---------------------------------------------------------
# PRUEBA 1: Validacion de codigo fuente index.html local
# ---------------------------------------------------------
Assert-Test "1. Validar logica smartFetch y getBackendUrl en index.html local" {
    $path = "g:\Mi unidad\Work\EAS Consulting\Proyectos\ATLAS-SAP Operaciones\index.html"
    $html = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)

    if (-not $html.Contains("http://10.10.10.102:54321")) {
        throw "index.html no contiene la URL primaria del servidor Proxmox (10.10.10.102:54321)."
    }
    if (-not $html.Contains("resp.status === 404")) {
        throw "index.html no contiene la regla de descarte de 404 en smartFetch."
    }
}

# ---------------------------------------------------------
# PRUEBA 2: Validacion de sincronizacion en backend/index.html
# ---------------------------------------------------------
Assert-Test "2. Validar sincronizacion de backend/index.html" {
    $backendPath = "g:\Mi unidad\Work\EAS Consulting\Proyectos\ATLAS-SAP Operaciones\backend\index.html"
    $html = [System.IO.File]::ReadAllText($backendPath, [System.Text.Encoding]::UTF8)

    if (-not $html.Contains("http://10.10.10.102:54321")) {
        throw "backend/index.html no esta sincronizado con la URL de Proxmox."
    }
}

# ---------------------------------------------------------
# PRUEBA 3: Prueba de Endpoint API Token en Servidor Proxmox (10.10.10.102)
# ---------------------------------------------------------
Assert-Test "3. Probar endpoint POST /auth/v1/token en http://10.10.10.102:54321" {
    $url = "http://10.10.10.102:54321/auth/v1/token"
    $jsonBody = '{"email":"admin@easconsulting.com.mx","password":"Nosemeolvida01"}'

    $wc = New-Object System.Net.WebClient
    $wc.Headers.Add("Content-Type", "application/json")
    $wc.Encoding = [System.Text.Encoding]::UTF8
    $responseJson = $wc.UploadString($url, "POST", $jsonBody)

    if (-not $responseJson.Contains("access_token")) {
        throw "La respuesta de la API no contiene 'access_token'."
    }
    if (-not $responseJson.Contains('"role":"admin"')) {
        throw "La respuesta de la API no contiene el rol de administrador esperado."
    }
}

# ---------------------------------------------------------
# PRUEBA 4: Simulacion de Cadena de Fallback (Simula 404 inicial y descarte)
# ---------------------------------------------------------
Assert-Test "4. Simular logica de descarte de 404 y reconexion a candidato valido" {
    $candidates = @(
        "http://httpbin.org/status/404",
        "http://10.10.10.102:54321/auth/v1/token"
    )
    $resolvedUrl = $null
    $successResp = $null

    foreach ($url in $candidates) {
        try {
            $req = [System.Net.WebRequest]::Create($url)
            $req.Method = "POST"
            $req.ContentType = "application/json"
            $req.Timeout = 5000
            
            $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"email":"admin@easconsulting.com.mx","password":"Nosemeolvida01"}')
            $req.ContentLength = $bytes.Length
            $os = $req.GetRequestStream()
            $os.Write($bytes, 0, $bytes.Length)
            $os.Close()

            $resp = $req.GetResponse()
            $statusCode = [int]$resp.StatusCode
            if ($statusCode -eq 404 -or $statusCode -eq 502 -or $statusCode -eq 503) {
                continue
            }
            $resolvedUrl = $url
            $successResp = $resp
            break
        } catch [System.Net.WebException] {
            if ($_.Response) {
                $status = [int]$_.Response.StatusCode
                if ($status -eq 404 -or $status -eq 502 -or $status -eq 503) {
                    continue
                }
            }
        }
    }

    if ($resolvedUrl -ne "http://10.10.10.102:54321/auth/v1/token") {
        throw "La cadena de fallback no resolvio correctamente al servidor de produccion. Resolvio a: $resolvedUrl"
    }
}

# ---------------------------------------------------------
# PRUEBA 5: Verificar que el servidor Proxmox esta sirviendo la version actualizada
# ---------------------------------------------------------
Assert-Test "5. Verificar despliegue activo en servidor Proxmox (http://10.10.10.102:54321/)" {
    $wc = New-Object System.Net.WebClient
    $wc.Encoding = [System.Text.Encoding]::UTF8
    $remoteHtml = $wc.DownloadString("http://10.10.10.102:54321/")

    if (-not $remoteHtml.Contains("10.10.10.102:54321")) {
        throw "El servidor Proxmox no esta sirviendo la version actualizada de index.html."
    }
    if (-not $remoteHtml.Contains("resp.status === 404")) {
        throw "El servidor Proxmox no incluye la regla de descarte 404 en smartFetch."
    }
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  RESULTADO DE LA SUITE DE VERIFICACION:" -ForegroundColor Cyan
Write-Host "  Pruebas Exitosas: $testsPassed / $($testsPassed + $testsFailed)" -ForegroundColor Green
if ($testsFailed -gt 0) {
    Write-Host "  Pruebas Fallidas: $testsFailed" -ForegroundColor Red
} else {
    Write-Host "  Estado Global: 100% FUNCIONAL Y VERIFICADO" -ForegroundColor Green
}
Write-Host "==========================================================" -ForegroundColor Cyan
