# ATLAS · SAP Operations & Management Suite

Sistema integral de control de cambios (RFCs), gestión de operaciones SAP, matriz de responsabilidades TQS y gobierno de sistemas para EAS Consulting Group.

- **Repositorio Oficial:** `https://github.com/eaguilarh01/atlas-sap`
- **Versión:** 2.5.5
- **Organización:** EAS Consulting Group
- **Entorno de Producción:** Proxmox VE (Contenedores Docker: Nginx SSL Reverse Proxy, Node.js API, PostgreSQL 16)

---

## 1. Arquitectura del Proyecto

El repositorio está estructurado como un monorepo que alberga tanto el cliente web (*Frontend*) como la capa de servicios y persistencia (*Backend*):

```text
atlas-sap/
│
├── frontend/                                   # Portal Web Cliente SPA
│   ├── .github/workflows/ci.yml                # CI de Frontend
│   ├── tests/frontend-lint.test.js             # Pruebas automatizadas de DOM y sintaxis
│   ├── index.html                              # Núcleo SPA (Vistas reactivas, modales y picklists)
│   ├── styles.css                              # Sistema de diseño corporativo y temas
│   ├── favicon.png                             # Icono oficial
│   ├── package.json                            # Metadatos y scripts
│   └── README.md                               # Documentación específica del frontend
│
├── backend/                                    # API REST y Servicios de Persistencia
│   ├── .github/workflows/ci.yml                # CI de Backend (Tests + Docker build)
│   ├── tests/api.test.js                       # Pruebas de integración y contratos API
│   ├── scripts/                                # Scripts de base de datos, purga y despliegue
│   │   ├── db-init.js                          # Inicialización de tablas y usuarios
│   │   ├── db-seed.js                          # Semillero de sistemas y catálogos
│   │   ├── db-migrate.js                       # Migrador de esquemas
│   │   ├── archive_audit_logs.sql              # Purga y archivo de logs (>90 días)
│   │   └── deploy-rollback.sh                  # Despliegue seguro con healthcheck y rollback
│   ├── server.js                               # API Express con resolver estático multipath
│   ├── Dockerfile                              # Imagen Node.js 20 Alpine
│   ├── docker-compose.yml                      # Orquestación de contenedores (api, db, proxy)
│   ├── docker-entrypoint-initdb.sh             # Inicializador automático de PostgreSQL
│   ├── nginx.conf                              # Proxy reverso SSL con hardening de headers
│   ├── schema_onpremise.sql                    # DDL relacional completo de PostgreSQL
│   ├── .env.example                            # Plantilla de variables de entorno
│   ├── package.json                            # Dependencias y scripts de backend
│   └── README.md                               # Documentación específica del backend
│
├── docs/                                       # Documentación de Arquitectura y Manuales
│   ├── MEMORIA_TECNICA_PROYECTO_ATLAS_SAP.pdf  # Memoria técnica ejecutiva del proyecto
│   ├── PLAN_SEPARACION_FRONTEND_BACKEND_GITHUB.md # Plan maestro y auditoría granular
│   └── diagramas/                              # Diagramas de flujo y arquitectura (.drawio)
│
├── docker-compose.yml                          # Orquestación raíz compatible con producción
├── server.js                                   # Entrypoint raíz sincronizado
├── index.html                                  # Entrada SPA raíz sincronizada
├── styles.css                                  # Estilos raíz sincronizados
├── nginx.conf                                  # Configuración de proxy SSL raíz
├── schema_onpremise.sql                        # Esquema de base de datos raíz
└── .gitignore                                  # Exclusión estricta de secretos y datos sensibles
```

---

## 2. Stack Tecnológico

- **Frontend:** HTML5, CSS3 nativo (CSS custom properties), Vanilla JavaScript ES2022 (SPA reactiva de alto rendimiento sin sobrecarga de frameworks).
- **Backend:** Node.js 20 (Express), JWT (JSON Web Tokens), Zod (validación de esquemas), Helmet (seguridad HTTP y CSP), Express Rate Limit (mitigación de ataques por fuerza bruta).
- **Base de Datos:** PostgreSQL 16 Alpine con esquemas relacionales, triggers de auditoría, particionado lógico y respaldos periódicos.
- **Proxy Reversa y Seguridad:** Nginx Alpine con terminación TLS v1.2/v1.3, compresión Gzip y cabeceras HSTS/CSP.

---

## 3. Roles y Matriz de Control de Acceso (RBAC)

| Rol | Alcance de Permisos |
| :--- | :--- |
| `admin` | Control total del sistema, gestión de usuarios, catálogos, sistemas y configuración global. |
| `tqs_leader` | Gestión de RFCs y solicitudes asignadas a su grupo/sistemas; acceso de lectura a RFCs generales. |
| `fte` | Monitoreo operativo y consulta de RFCs en ejecución y programados. |
| `director` | Acceso a dashboards ejecutivos, analítica de cambios y reportes de cumplimiento. |
| `guardia` | Monitoreo táctico y seguimiento de ventanas de mantenimiento durante guardias operativas. |

---

## 4. Pruebas Automatizadas (QA)

El proyecto cuenta con suites de pruebas automatizadas ejecutables mediante el test runner nativo de Node.js:

```bash
# Ejecutar pruebas del Backend
cd backend && npm test

# Ejecutar pruebas del Frontend
cd frontend && npm test
```

---

## 5. Despliegue en Producción

El entorno opera sobre Proxmox VE (`10.10.10.102:8443`). El despliegue automatizado verifica la disponibilidad mediante el endpoint `/api/health` antes de consolidar el cambio:

```bash
# Ejecutar despliegue con validación y rollback automático
bash backend/scripts/deploy-rollback.sh
```

---
*EAS Consulting Group — ATLAS Operations Suite*
