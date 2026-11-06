# Plan de Separación Modular (Frontend/Backend), Publicación en GitHub y Memoria Técnica de ATLAS v3.0

**Proyecto:** ATLAS · SAP Operations Suite (EAS Consulting Group / KOF)  
**Destinatario:** Soporte TI  
**Fecha:** 04 de Noviembre de 2026  
**Documento:** PLAN_SEPARACION_FRONTEND_BACKEND_GITHUB.md  
**Diagrama Draw.io Asociado:** `8_arquitectura_onpremise_atlas_v3.drawio`  

---

## 1. Respuestas Puntuales y Dictamen Técnico

### 1.1. ¿El proyecto seguiría trabajando tal como lo estamos haciendo en este momento o ya estaríamos apuntando a GitHub?
El proyecto en producción **continuará operando exactamente igual y sin interrupciones**. La adopción de GitHub no altera la ejecución en caliente en la máquina virtual de Proxmox (`10.10.10.102`), sino que establece a GitHub como la **fuente de la verdad canónica (Single Source of Truth)**.

Se implementa en dos etapas:
1. **Etapa 1 (Inmediata / Híbrida):** El código se respalda, versiona y audita en GitHub. Las ramas `main` (producción) y `develop` (desarrollo/staging) controlan los cambios. El despliegue hacia Proxmox se realiza mediante sincronización controlada sin downtime.
2. **Etapa 2 (Automatizada / CI/CD):** Mediante GitHub Actions o un Webhook seguro en Proxmox, cada *pull request* aprobado y fusionado en `main` actualiza los contenedores Docker de forma desatendida, eliminando las transferencias manuales por SCP.

### 1.2. ¿Cuánto tiempo nos llevaría hacer esa separación?
La reestructuración se ejecuta en **un tiempo estimado de 4 a 6 horas de trabajo técnico**, desglosado en tres fases:

| Fase | Alcance Técnico | Tiempo Estimado | Riesgo Operativo |
| :--- | :--- | :--- | :--- |
| **Fase 1: Monorepo Modular** | Reorganización de carpetas (`frontend/`, `backend/`, `deploy/`, `docs/`), ajuste de rutas estáticas en `server.js` y volúmenes de `docker-compose.yml`. | 2 a 3 horas | Nulo (se valida localmente antes de tocar el servidor). |
| **Fase 2: Publicación en GitHub** | Sanitización de secretos (`.gitignore`), creación del repositorio corporativo privado, commit inicial y publicación de ramas `main` y `develop`. | 1 a 2 horas | Nulo (control de versiones puramente declarativo). |
| **Fase 3: Sincronización Proxmox** | Actualización de la estructura en `/home/eas101/atlas-app/` y verificación de recarga en caliente de Nginx y Node. | 1 hora | Cero downtime (recarga mediante `nginx -s reload`). |
| **TOTAL** | **Implementación completa y verificada** | **4 a 6 horas** | **Controlado al 100%** |

### 1.3. ¿Cuál sería la documentación a considerar que se tiene que elaborar?
El proyecto contará con un marco documental completo de nivel corporativo:
1. **Memoria Técnica Integral de Arquitectura (este documento y `MEMORIA_TECNICA_ATLAS_V3.md`):** Topología, modelos de datos, seguridad, reglas de negocio.
2. **README Principal del Repositorio (`README.md`):** Guía de instalación, clonado, variables de entorno y comandos operativos.
3. **Documentación del Frontend (`frontend/README.md`):** Catálogo de componentes SPA, gestión de estado en memoria (`DB_CACHE`, `SOL_RECORDS`), diseño visual y picklists.
4. **Referencia de la API Backend (`backend/README.md` o especificación OpenAPI):** Catálogo de endpoints PostgREST, validaciones Zod, autenticación JWT y roles.
5. **Guía de Operación y DevOps (`DEVOPS_PROXMOX.md`):** Mantenimiento de contenedores Docker, gestión de certificados SSL, túnel FortiGate DDNS y respaldos con `pg_dump`.
6. **Bitácora de Versiones (`CHANGELOG.md`):** Historial riguroso de releases, correcciones y nuevas funcionalidades.

### 1.4. ¿Podemos generar esa estructura de Frontend y Backend sin afectar lo que tenemos actualmente o si se tendría que transformar completamente todo el proyecto? ¿Qué implicaciones tendríamos?
**Se puede generar la estructura modular de inmediato SIN TRANSFORMAR NI ROMPER el proyecto actual.**

No es necesario reescribir la aplicación en un framework distinto (como React, Angular o Next.js) de forma precipitada, lo cual implicaría semanas de desarrollo y riesgo de fallas operativas. La estrategia óptima es adoptar una **Arquitectura de Monorepo Modular**:
- **Física:** Los archivos de interfaz se ubican en `frontend/` y los de lógica de servidor en `backend/`.
- **Lógica:** El backend sigue sirviendo los archivos estáticos de forma ultra-rápida vía Express / Nginx, manteniendo intacta la compatibilidad con todos los usuarios actuales.

#### Implicaciones Técnicas a Gestionar:
1. **Ajuste de rutas estáticas en `server.js`:** Express deberá apuntar a `../frontend/` o `./frontend/` para servir `index.html`, `styles.css` y `favicon.png`.
2. **Ajuste de volúmenes en `docker-compose.yml`:** Actualizar los bind mounts del contenedor `atlas_backend` para reflejar las carpetas `frontend/` y `backend/`.
3. **Sanitización estricta de Secretos en `.gitignore`:** Impedir la subida de `.env`, claves privadas SSL (`privkey.pem`), archivos `.xlsx` con datos confidenciales y dumps SQL a GitHub.

---

## 2. Memoria Técnica del Proyecto ATLAS v3.0

### 2.1. Propósito y Alcance del Sistema
ATLAS (SAP Operations Suite) es la plataforma centralizada de gestión operativa y gobernanza de cambios para los sistemas SAP de Coca-Cola FEMSA (KOF), operada por EAS Consulting Group. Administra el ciclo de vida completo de:
- **RFCs (Request For Change):** Gestión de ventanas de mantenimiento, infraestructura (OnPremise vs Azure/Cloud), validaciones de VOBO, aprobación de coordinadores KOF, horarios con plan de retorno, seguimiento de ejecución y bitácora técnica.
- **Solicitudes de Servicio y Requerimientos:** Control de folios técnicos, asignación de responsables TQS, seguimiento de action items y auditoría cronológica de cambios de estatus.
- **Matriz de Responsabilidades y Sistemas SAP:** Asignación de TQS Líderes titulares y backups por sistema, catálogo de criticidad y monitoreo de guardia operativa.

### 2.2. Stack Tecnológico

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        ARQUITECTURA ATLAS v3.0                         │
├───────────────────┬────────────────────────────────────────────────────┤
│ Capa              │ Tecnologías / Herramientas                         │
├───────────────────┼────────────────────────────────────────────────────┤
│ Frontend          │ Single Page Application (HTML5, Vanilla JS ES6+,   │
│                   │ CSS3 Grid/Flexbox, Design System KOF/EAS,          │
│                   │ SheetJS / XLSX para exportación, Chart.js).        │
├───────────────────┼────────────────────────────────────────────────────┤
│ Backend API       │ Node.js v20 LTS, Express 4.19, Zod (Validación),   │
│                   │ JWT (Autenticación), Helmet & RateLimit (Seguridad),│
│                   │ PostgREST-Compatible Router, In-Memory RAM Cache.  │
├───────────────────┼────────────────────────────────────────────────────┤
│ Base de Datos     │ PostgreSQL 16 Alpine, Connection Pooling (pg.Pool),│
│                   │ Extensiones UUID, Constraints relacionales,        │
│                   │ Transacciones ACID y soft-deletes (deleted_at).    │
├───────────────────┼────────────────────────────────────────────────────┤
│ Infraestructura   │ Proxmox VE (VM Debian/Ubuntu 10.10.10.102),        │
│                   │ Docker Compose, Nginx Alpine (Reverse Proxy SSL).  │
├───────────────────┼────────────────────────────────────────────────────┤
│ Red y Perímetro   │ FortiGate Firewall, DDNS easconsulting.fortiddns.com│
│                   │ Puertos 8443 (HTTPS Web) y 54321 (REST API).       │
└───────────────────┴────────────────────────────────────────────────────┘
```

### 2.3. Esquema de Base de Datos y Entidades Principales

1. **`public.rfcs`:**
   - `id (UUID PK)`, `ticket (VARCHAR)`, `tipo (RFC/Cambio)`, `ambiente (PRD/QAS/DEV)`, `infraestructura (OnPremise/Azure/Ambos)`.
   - `fecha`, `fecha_fin`, `fecha_fin_retorno`, `hora_inicio`, `hora_fin`, `hora_fin_retorno`.
   - `sistema_name`, `sistema_grupo`, `sid`, `promotor`, `coordinador_kof`.
   - `descripcion`, `observaciones`, `status`.
   - `owner_id (FK tqs_users)`, `tqs_ids (UUID[])`.
   - `created_at`, `updated_at`, `deleted_at`.
2. **`public.solicitudes`:**
   - `id (UUID PK)`, `ticket (VARCHAR)`, `tipo (Requerimiento/Incidente/Permiso)`.
   - `origen`, `fecha_inicio`, `descripcion`, `sistema_sap`, `ambiente`, `responsable`.
   - `estatus`, `tqs_ids (UUID[])`, `action_items (JSONB)`, `bitacora (JSONB)`.
   - `estatus_historial (JSONB)`: Historial de transiciones con fecha, autor y estados.
   - `owner_id (FK tqs_users)`, `created_at`, `updated_at`.
3. **`public.tqs_users`:**
   - `id (UUID PK)`, `nombre`, `email`, `rol (admin/director/tqs_leader/guardia)`.
   - `sistemas (TEXT[])`, `activo (BOOLEAN)`, `created_at`.
4. **`public.sistemas`:**
   - `id (UUID PK)`, `nombre`, `sistema`, `owner_id (FK)`, `backup_id (FK)`, `criticidad`.
5. **`public.audit_log`:**
   - `id (UUID PK)`, `user_id`, `user_email`, `action`, `table_name`, `record_id`, `details`, `timestamp`.

### 2.4. Seguridad y Control de Acceso (RBAC)
- **Token JWT:** Firma criptográfica con expiración y verificación obligatoria en cabecera `Authorization: Bearer <token>`.
- **Roles:**
  - `admin`: Control total operativo, gestión de usuarios y purga de auditoría.
  - `director`: Visibilidad global, tableros ejecutivos y lectura integral de reportes.
  - `tqs_leader`: Registro, edición y ejecución de RFCs y Solicitudes en sus sistemas asignados.
  - `guardia`: Monitoreo de ventanas activas, bitácora de guardia y alertas en vivo.
- **Reglas Operativas Blindadas en Backend:**
  - Bloqueo de reprogramación: Un RFC en estado de ejecución (`En Ejecución`, `En Proceso`) no puede ser reprogramado.
  - Exclusión de cuentas administrativas en asignación operativa de TQS.
  - Formato estricto de horas (`HH:mm`) y fechas normalizadas en ISO.

---

## 3. Estructura del Repositorio Propuesta (Monorepo Modular)

```text
atlas-sap-operaciones/
├── .github/
│   └── workflows/
│       ├── test-and-lint.yml       # Integración continua (validación sintáctica y pruebas)
│       └── deploy-proxmox.yml      # Despliegue automatizado por SSH/Webhook
├── frontend/                       # CAPA DE PRESENTACIÓN (CLIENTE)
│   ├── index.html                  # Shell SPA y vistas modulares de ATLAS
│   ├── styles.css                  # Hoja de estilos del Design System KOF/EAS
│   ├── favicon.png                 # Isotipo y branding
│   └── assets/                     # Plantillas Excel y recursos estáticos
├── backend/                        # CAPA DE SERVICIOS Y API
│   ├── server.js                   # API REST Express + PostgREST Engine
│   ├── package.json                # Dependencias (Zod, pg, express, helmet, etc.)
│   ├── Dockerfile                  # Contenedor de Node.js v20
│   ├── src/                        # Módulos TypeScript / ES Modules futuros
│   └── tests/                      # Pruebas unitarias y de integración
├── database/                       # PERSISTENCIA Y MIGRACIONES
│   ├── schema_onpremise.sql        # DDL completo de PostgreSQL
│   ├── docker-entrypoint-initdb.sh # Script de inicialización de contenedor
│   └── migrations/                 # Scripts incrementales versionados
├── deploy/                         # INFRAESTRUCTURA Y DESPLIEGUE PROXMOX
│   ├── docker-compose.yml          # Orquestador (db, api, proxy)
│   ├── nginx.conf                  # Proxy reverso SSL y compresión
│   ├── certs/                      # Certificados SSL (excluidos de Git)
│   └── deploy-proxmox.ps1          # Script de despliegue automatizado
├── docs/                           # MEMORIA TÉCNICA Y DIAGRAMAS
│   ├── PLAN_SEPARACION_FRONTEND_BACKEND_GITHUB.md
│   ├── 8_arquitectura_onpremise_atlas_v3.drawio
│   └── manuales/                   # Manuales de Administrador, TQS y Dirección
├── .gitignore                      # Filtro estricto anti-fugas de secretos
└── README.md                       # Documento maestro del repositorio
```

---

## 4. Diagrama de Arquitectura Draw.io

Se ha generado el archivo formal **`8_arquitectura_onpremise_atlas_v3.drawio`** en la raíz del proyecto, listo para ser abierto en Diagrams.net / Draw.io o en la extensión de VS Code / Antigravity.

### Representación Conceptual del Flujo:
```text
[ NAVEGADORES WEB / USUARIOS ]
  (TQS Leaders, Coordinadores KOF, Dirección, Guardia)
              │
              ▼ HTTPS (Puerto WAN:8443)
[ FORTIGATE FIREWALL & DDNS ]
  (easconsulting.fortiddns.com)
              │
              ▼ Forward Local
[ PROXMOX VM: 10.10.10.102 / NGINX SSL PROXY (atlas_nginx) ]
  (Terminación SSL TLS 1.3 / Certificados EAS CA)
              │
              ▼ HTTP Proxy Pass (Puerto Interno 54321)
[ BACKEND API: EXPRESS (atlas_backend) ]
  ├── Middlewares: Helmet, CORS, RateLimiting, JWT Auth
  ├── Enrutador PostgREST Compatible (/rest/v1, /auth/v1)
  ├── Validador Zod & Reglas de Negocio
  ├── In-Memory RAM Cache (0 ms)
  └── Mapeador Estático -> [ FRONTEND SPA (index.html / styles.css) ]
              │
              ▼ Conexión Pool TCP (Puerto 5432)
[ POSTGRESQL 16 (atlas_postgres) ]
  └── Tablas: rfcs, solicitudes, tqs_users, sistemas, audit_log
              ▲
              │ git push / GitHub Actions
[ GITHUB PRIVATE REPOSITORY ]
  └── Ramas: main (producción) / develop (staging)
```

---

## 5. Plan de Ejecución Paso a Paso (Checklist Seguro)

```markdown
- [ ] Paso 1: Aprobación formal del presente plan por parte de Soporte TI.
- [ ] Paso 2: Creación de ramas en Git local (`main` y `develop`).
- [ ] Paso 3: Reorganización física de archivos en carpetas `frontend/`, `backend/`, `database/`, `deploy/` y `docs/`.
- [ ] Paso 2: Creación de los repositorios en GitHub:
      - Frontend: https://github.com/eaguilarh01/atlas-frontend
      - Backend: https://github.com/eaguilarh/atlas-backend
- [ ] Paso 3: Reorganización física de archivos en carpetas `frontend/` y `backend/`.
- [ ] Paso 4: Ajuste de rutas relativas en `server.js` y bind mounts en `docker-compose.yml`.
- [ ] Paso 5: Verificación de `.gitignore` para garantizar cero fugas de contraseñas, tokens o llaves privadas.
- [ ] Paso 6: Creación del repositorio privado en GitHub bajo la organización EAS Consulting.
- [ ] Paso 7: Vinculación de remoto (`git remote add origin ...`) y primer `git push -u origin main`.
- [ ] Paso 8: Despliegue sincronizado en la máquina virtual Proxmox (`10.10.10.102`) y verificación funcional de extremo a extremo sin downtime.
- [ ] Paso 6: Vinculación de remotos (`git remote add origin ...`) y push inicial en ambas cuentas de GitHub.
- [ ] Paso 7: Despliegue sincronizado en la máquina virtual Proxmox (`10.10.10.102`) y verificación funcional de extremo a extremo sin downtime.
```

---

## 6. Auditoría Técnica Granular Multidisciplinaria

### 6.1. Perfil QA & Testing (Aseguramiento de Calidad)
| ID | Hallazgo Detectado | Severidad | Impacto Operativo | Plan de Mitigación / Corrección |
| :--- | :--- | :---: | :--- | :--- |
| **QA-01** | Ausencia de suite automatizada de pruebas unitarias y E2E para el frontend. | **Alta** | Riesgo de regresión silenciosa en formularios complejos al modificar scripts compartidos. | Implementar pruebas funcionales con Playwright para flujos críticos: alta de RFC, aprobación de VOBO, creación de solicitudes y conmutación de vista Todos / TQS. |
| **QA-02** | Dependencia de fallback a memoria (`DB_CACHE`) ante fallos transitorios de red sin notificación clara al usuario. | **Media** | Posible pérdida de sincronización de datos si la red experimenta microcortes. | Incorporar mecanismo de reintentos exponenciales con Circuit Breaker en cliente `smartFetch` y bandera visual de estado de sincronización. |
| **QA-03** | Cobertura insuficiente de casos límite en parseo de fechas internacionales y zonas horarias (IST vs CST). | **Media** | Desalineación de horas de ventana de mantenimiento cuando los correos origen provienen de soporte global en India (IST). | Diseñar batería de pruebas de integración con fixtures reales de correos `.eml` y `.msg` en `backend/tests/`. |

### 6.2. Perfil UX / UI (Experiencia e Interfaz de Usuario)
| ID | Hallazgo Detectado | Severidad | Impacto Operativo | Plan de Mitigación / Corrección |
| :--- | :--- | :---: | :--- | :--- |
| **UX-01** | Archivo `index.html` monolítico de gran envergadura (más de 29,000 líneas). | **Media** | Complejidad cognitiva en mantenimiento y mayor tiempo de indexación en entornos de desarrollo. | Modularizar en componentes ES Modules (`.mjs` / `.js`) para separar la lógica de modales, vistas y utilerías comunes. |
| **UX-02** | Selectores multiselect con listeners globales que pueden desfasarse en recargas dinámicas. | **Media** | Inconsistencia entre etiquetas seleccionadas y checkboxes visibles tras edición de registros. | Estandarizar componentes de selección desacoplados con sincronización bidireccional mediante `CustomEvent`. |
| **UX-03** | Legibilidad de badges de criticidad y estados en monitores con bajo contraste o modo oscuro. | **Baja** | Dificultad para operadores de guardia en turnos nocturnos para distinguir alertas críticas de advertencias. | Ajustar la paleta de tokens CSS `:root` asegurando un contraste mínimo de 4.5:1 conforme a WCAG 2.1 AA. |

### 6.3. Perfil CI / CD (Integración y Despliegue Continuo)
| ID | Hallazgo Detectado | Severidad | Impacto Operativo | Plan de Mitigación / Corrección |
| :--- | :--- | :---: | :--- | :--- |
| **CI-01** | Despliegues basados en SCP/SSH manuales hacia el servidor Proxmox sin validación previa de sintaxis. | **Alta** | Posibilidad de desplegar código con errores de sintaxis que afecten la recarga de Nginx o Express. | Configurar GitHub Actions en ambos repositorios para validar sintaxis (ESLint, HTMLHint) antes de permitir merge a rama `main`. |
| **CI-02** | Carencia de versionamiento inmutable de imágenes Docker mediante tags de Git. | **Media** | Imposibilidad de auditar exactamente qué commit específico está corriendo en el contenedor si se sobrescribe la imagen. | Generar imágenes Docker con tag semántico (`atlas-backend:v3.0.x`) y compilar mediante pipeline automatizado. |
| **CI-03** | Ausencia de procedimiento automatizado de Rollback en caso de fallo post-despliegue. | **Media** | Tiempo de recuperación prolongado si un cambio introduce un error crítico en producción. | Crear script `deploy-rollback.sh` que restaure el commit anterior y el último snapshot de PostgreSQL en un solo comando. |

### 6.4. Perfil Ciberseguridad (Defensa en Profundidad)
| ID | Hallazgo Detectado | Severidad | Impacto Operativo | Plan de Mitigación / Corrección |
| :--- | :--- | :---: | :--- | :--- |
| **SEC-01** | Riesgo de commit inadvertido de archivos `.env` o certificados SSL en repositorios remotos. | **Crítica** | Exposición de credenciales de base de datos o claves privadas de certificados en GitHub. | Aplicar `.gitignore` estricto en la raíz de cada repositorio, excluir archivos `.env`, `.pem`, `.key`, `.xlsx` e integrar escáner secret-scanning / TruffleHog. |
| **SEC-02** | Tokens JWT guardados en `localStorage` susceptibles a robo ante vulnerabilidades XSS. | **Media** | Un vector XSS exitoso podría exfiltrar tokens de sesión activos de usuarios administradores. | Migrar almacenamiento sensible a cookies `HttpOnly; Secure; SameSite=Strict` y reforzar cabeceras CSP (`Content-Security-Policy`) en Nginx. |
| **SEC-03** | Falta de Rate Limiting granular en el endpoint de autenticación `/auth/v1/token`. | **Media** | Vulnerabilidad potencial a ataques de fuerza bruta contra cuentas operativas conocidas. | Integrar middleware `express-rate-limit` restringiendo a 5 intentos fallidos por dirección IP cada 15 minutos. |
| **SEC-04** | Registro de auditoría relacional sin política de retención o archivado a largo plazo. | **Baja** | Crecimiento desmedido de la tabla `audit_logs` que degrade el rendimiento de consultas a lo largo del tiempo. | Implementar particionamiento por rangos de fecha en tabla `audit_logs` y archivado mensual en frío. |

