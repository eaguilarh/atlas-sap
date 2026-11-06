# REFERENCE BASELINE — ATLAS-SAP Operaciones
**Fecha**: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
**Git Tag**: baseline-pre-refactor-$(Get-Date -Format "yyyyMMdd-HHmmss")
**Commit**: 8338f7a

---

## Métricas de Código (Pre-Refactor)

| Archivo | Líneas | Tamaño | Tipo |
|---------|--------|--------|------|
| `index.html` | **50,694** | ~1.8 MB | HTML + CSS embebido + JS inline |
| `server.js` | ~2,500+ | ~95 KB | Backend monolítico (Express) |
| `styles.css` | ~1,200+ | ~45 KB | CSS duplicado (también en index.html) |
| `package.json` | 28 | 1 KB | Dependencias básicas |

**Total JS/HTML/CSS**: ~54,000 líneas en 3 archivos principales

---

## Endpoints API (Baseline)

```bash
# Health
GET  /

# Auth
POST /auth/v1/signup
POST /auth/v1/token
POST /auth/v1/refresh
POST /auth/v1/recover
POST /auth/v1/reset-password
POST /auth/v1/password
POST /auth/v1/logout
GET  /auth/v1/user
PUT  /auth/v1/user
POST /auth/v1/security-questions
GET  /auth/v1/security-questions/:userId

# RFCs
GET    /api/rfcs
POST   /api/rfcs
GET    /api/rfcs/:id
PATCH  /api/rfcs/:id
DELETE /api/rfcs/:id

# Solicitudes
GET    /api/solicitudes
POST   /api/solicitudes
GET    /api/solicitudes/:id
PATCH  /api/solicitudes/:id
DELETE /api/solicitudes/:id

# Sistemas
GET    /api/sistemas
POST   /api/sistemas
GET    /api/sistemas/:id
PATCH  /api/sistemas/:id
DELETE /api/sistemas/:id

# Users (Admin)
GET    /api/users
POST   /api/users
PATCH  /api/users/:id
DELETE /api/users/:id

# Logs
GET /api/logs/aplicacion
GET /api/logs/auditoria
GET /api/logs/actividades
GET /api/logs/sincronizacion

# AI
POST /api/ai/report
```

---

## Validación de Paridad (Checklist Post-Refactor)

### Backend (FASE 1-2)
- [ ] `npm run dev` levanta en puerto 54321/54322
- [ ] `GET /` retorna HTML de ATLAS
- [ ] `POST /auth/v1/token` login exitoso (admin@easconsulting.com.mx)
- [ ] `GET /api/rfcs` retorna lista (200 + array)
- [ ] `GET /api/solicitudes` retorna lista
- [ ] `GET /api/sistemas` retorna lista
- [ ] `GET /api/users` (admin) retorna usuarios
- [ ] Rate limiting responde 429 tras exceder límite
- [ ] JWT válido con issuer `atlas-sap-operations`, audience `atlas-api`
- [ ] Refresh token rota y revoca anterior
- [ ] Logs de auditoría se escriben en DB
- [ ] Tests unitarios >90% cobertura services/middleware
- [ ] Tests integración >80% cobertura routes
- [ ] Pipeline CI: lint → typecheck → test → build = VERDE

### Frontend (FASE 3)
- [ ] `npm run build` genera `public/index.html` + assets hasheados
- [ ] Visual regression: 0 diff vs screenshots baseline (Playwright)
- [ ] Lighthouse: Performance >90, Accessibility >95, Best Practices >90, SEO >90
- [ ] Console: 0 errores, 0 warnings críticos
- [ ] Navegación: Sidebar, Topbar, Dashboard, RFCs, Solicitudes, Sistemas, Dirección
- [ ] Modales: Login, Crear/Editar RFC, Crear/Editar Solicitud, Crear/Editar Sistema, Usuario, AI Report
- [ ] Tema oscuro/claro toggle funcional
- [ ] Búsqueda global funciona
- [ ] Filtros columna funcionan
- [ ] Paginación funciona
- [ ] Export CSV funciona
- [ ] Carga masiva modal abre

### DB (FASE 4)
- [ ] Migraciones versionadas aplicadas (up/down probados)
- [ ] `ALTER TABLE` automático removido de startup
- [ ] Schema idéntico a `baseline_schema.sql` (pg_dump --schema-only)

### Limpieza (FASE 4)
- [ ] 0 scripts `.ps1`/`py` en `scratch/` en repo
- [ ] `.gitignore` limpio (node_modules, dist, .env, *.log, edge profiles)

### E2E (FASE 5)
- [ ] Playwright: Login → Dashboard → CRUD RFC → CRUD Solicitud → CRUD Sistema → Logout
- [ ] k6 load test: 50 users, 2min, p95 < 500ms, 0 errors
- [ ] `npm audit`: 0 high/critical
- [ ] CSP headers estrictos (sin unsafe-inline innecesario)
- [ ] Deploy staging → smoke test → prod (blue/green)

---

## Comandos de Rollback Rápido

```bash
# Backend only
git checkout baseline-pre-refactor-YYYYMMDD-HHMMSS -- server.js package.json
npm install --production
npm start

# Frontend only  
git checkout baseline-pre-refactor-YYYYMMDD-HHMMSS -- index.html styles.css
# (servir estático directo)

# Full rollback
git checkout baseline-pre-refactor-YYYYMMDD-HHMMSS -- .
npm install
npm run build
npm start
```

---

## Archivos Críticos NO Tocar en FASE 1-2

| Archivo | Motivo |
|---------|--------|
| `index.html` | Frontend legacy - se reemplaza en FASE 3 |
| `styles.css` | Duplicado en index.html - se unifica en FASE 3 |
| `scratch/*` | Basura - se borra en FASE 4 |
| `.env` | Secrets - nunca en git |

---

## Variables de Entorno Requeridas (`.env.example`)

```env
PORT=54321
DATABASE_URL=postgres://user:pass@host:5432/atlas
JWT_SECRET=<64+ chars>
JWT_SECRET_FILE=/run/secrets/jwt_secret
ALLOWED_ORIGINS=http://localhost:54321,https://atlas.easconsulting.com.mx
LOG_LEVEL=info
SB_ANON=<supabase anon key>
```