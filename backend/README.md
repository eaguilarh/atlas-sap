# ATLAS · SAP Operations Suite (Backend API)

Servidor API REST, orquestación de base de datos PostgreSQL y proxy inverso de **ATLAS · SAP Operations & Management Suite**.

- **Repositorio:** `https://github.com/eaguilarh/atlas-sap` (Directorio: `backend/`)
- **Organización:** EAS Consulting Group
- **Versión:** 2.5.5

---

## 1. Arquitectura y Componentes

El backend está orquestado mediante contenedores Docker:

- **`atlas_backend`**: Node.js 20 Express REST API con JWT, Helmet, Rate Limiting y validación Zod.
- **`atlas_postgres`**: Base de datos relacional PostgreSQL 16 Alpine con esquemas de RFCs, auditoría, SLD y logs.
- **`atlas_nginx`**: Reverse Proxy TLSv1.2/1.3 con terminación SSL en puerto 8443, compresión gzip y headers HSTS/CSP.

```text
atlas-backend/
├── server.js                   # Entrypoint del servidor REST Express y lógica de negocio
├── Dockerfile                  # Contenedor optimizado de Node.js 20 Alpine
├── docker-compose.yml          # Orquestación de servicios (api, db, proxy)
├── nginx.conf                  # Configuración segura Nginx Reverse Proxy
├── schema_onpremise.sql        # DDL completo de base de datos PostgreSQL
├── docker-entrypoint-initdb.sh # Inicializador automático de base de datos
├── scripts/
│   ├── db-init.js              # Inicializador de datos y usuarios base
│   ├── db-seed.js              # Poblador de sistemas y catálogos
│   ├── db-migrate.js           # Migrador de esquemas
│   ├── archive_audit_logs.sql  # Script de purga y particionado de logs (>90 días)
│   └── deploy-rollback.sh      # Despliegue automatizado con rollback por healthcheck
├── tests/
│   └── api.test.js             # Suite de pruebas unitarias y de integración
├── .github/
│   └── workflows/
│       └── ci.yml              # Pipeline CI de GitHub Actions
├── .env.example                # Plantilla de variables de entorno
├── package.json                # Dependencias del backend
└── .gitignore                  # Reglas de seguridad estrictas (sin secretos)
```

---

## 2. Configuración de Entorno

Copie la plantilla de variables de entorno y configure los secretos antes de iniciar:

```bash
cp .env.example .env
```

Variables esenciales requeridas:
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- `JWT_SECRET`
- `ALLOWED_ORIGINS`
- `PORT` (por defecto: `54321`)

---

## 3. Despliegue con Docker Compose

```bash
# Levantar servicios en segundo plano
docker compose up -d --build

# Verificar estado de los contenedores
docker compose ps

# Verificar logs del backend
docker compose logs -f api
```

---

## 4. Pruebas y Validación

```bash
# Ejecutar verificación de sintaxis
node --check server.js

# Ejecutar pruebas automatizadas
npm test
```

---

## 5. Endpoints de Verificación

- `GET /api/health`: Healthcheck del servicio para balanceadores y CI/CD.
- `POST /auth/v1/token`: Autenticación y expedición de tokens JWT.

