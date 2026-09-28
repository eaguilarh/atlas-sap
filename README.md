# ATLAS — SAP Operations Suite

Sistema de control de RFCs y Operaciones SAP para el equipo de EAS Consulting.

## Stack Tecnológico

- **Frontend:** HTML5 + JavaScript ES2020 ( Vanilla SPA ) + CSS3
- **Backend:** Node.js Express API Gateway + PostgreSQL (OnPremise / Proxmox)
- **Persistencia:** Base de datos relacional PostgreSQL con autenticación JWT y control de acceso por roles (RBAC)

## Roles y Permisos

| Rol | Permisos |
|-----|----------|
| `admin` | Lectura y escritura total, gestión de usuarios y sistemas |
| `tqs_leader` | Escribe sus propios RFCs, lee todos |
| `fte` | Solo lectura — todos los sistemas |
| `director` | Solo lectura — acceso a dashboards ejecutivos |
| `guardia` | Vista de monitoreo operativo |

## Estructura del Repositorio

```
ATLAS-codigo-fuente-2026-07-23/
├── index.html              # Portal principal SPA
├── styles.css              # Sistema de estilos y diseño
├── schema_onpremise.sql    # Esquema completo de PostgreSQL OnPremise
├── backend/                # Servidor Express API Gateway (server.js)
└── README.md
```

## Administración de Sistemas y Carga Masiva

- **Gestión de Sistemas:** Módulo dedicado para dar de alta nuevos sistemas SAP, editar nombres/dueños existentes (con actualización en cascada a todos los RFCs vinculados), transferir entre TQS Leaders y eliminar sistemas sin RFCs.
- **Carga Masiva (Excel):** Ingesta masiva mediante la plantilla `ATLAS_Plantilla_Carga_RFCs IJO JULIO 2026 v1.xlsx` (hasta 2,000 registros con previsualización y validación de campos de inicio y fin).

## Flujo de Operación

1. TQS o Administrador registra/edita sistemas y RFCs en el portal o vía Carga Masiva Excel.
2. Portal → PostgreSQL API Gateway (sincronización en tiempo real)
3. Exportación a CSV para MS Project (formato MPP con priorización)

---
*EAS Consulting — Operación SAP*
