#!/usr/bin/env bash
# ============================================================
# ATLAS SAP Operations Suite — Automated Deploy & Rollback
# ============================================================

set -euo pipefail

DEPLOY_DIR="/home/eas101/atlas-app"
BACKUP_DIR="${DEPLOY_DIR}/backups/deploy_$(date +%Y%m%d_%H%M%S)"
HEALTH_URL="http://127.0.0.1:54321/api/health"
MAX_ATTEMPTS=15
SLEEP_INTERVAL=2

echo "=== INICIANDO DESPLIEGUE SEGURO ATLAS ==="

mkdir -p "${BACKUP_DIR}"
echo "[1/4] Creando respaldo de seguridad en ${BACKUP_DIR}..."
cp -a "${DEPLOY_DIR}/server.js" "${BACKUP_DIR}/" || true
cp -a "${DEPLOY_DIR}/index.html" "${BACKUP_DIR}/" || true
cp -a "${DEPLOY_DIR}/styles.css" "${BACKUP_DIR}/" || true
cp -a "${DEPLOY_DIR}/nginx.conf" "${BACKUP_DIR}/" || true

echo "[2/4] Recargando servicios..."
cd "${DEPLOY_DIR}"
docker compose restart api proxy

echo "[3/4] Verificando salud del servicio (Health Check)..."
SUCCESS=0
for i in $(seq 1 ${MAX_ATTEMPTS}); do
    if curl -s -f -o /dev/null "${HEALTH_URL}"; then
        echo "Health check exitoso en intento ${i}."
        SUCCESS=1
        break
    fi
    echo "Esperando a que la API responda (intento ${i}/${MAX_ATTEMPTS})..."
    sleep ${SLEEP_INTERVAL}
done

if [ ${SUCCESS} -eq 1 ]; then
    echo "[4/4] DESPLIEGUE FINALIZADO CON ÉXITO."
    exit 0
else
    echo "ALERTA: El Health Check falló tras ${MAX_ATTEMPTS} intentos."
    echo "Iniciando rollback automático..."
    cp -a "${BACKUP_DIR}/server.js" "${DEPLOY_DIR}/"
    cp -a "${BACKUP_DIR}/index.html" "${DEPLOY_DIR}/"
    cp -a "${BACKUP_DIR}/styles.css" "${DEPLOY_DIR}/"
    cp -a "${BACKUP_DIR}/nginx.conf" "${DEPLOY_DIR}/"
    docker compose restart api proxy
    echo "Rollback completado. El entorno ha sido restaurado al estado anterior."
    exit 1
fi
