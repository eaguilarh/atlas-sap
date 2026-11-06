---
trigger: always_on
description: Reglas Obligatorias y Anti-Patrones — ATLAS-SAP Operaciones
---
# Reglas Obligatorias del Proyecto (ATLAS-SAP Operaciones)
Estas reglas han sido registradas en Obsidian Second Brain y son de OBLIGATORIO CUMPLIMIENTO en cada intervencion del agente en este workspace:
## Anti-Patrones y Trampas Prohibidas (Errores Recurrentes)
- **PROHIBIDO:** Sobrescribir funciones globales de UI (como toggleMultiSelectDropdown) dentro de callbacks de edicion; omitir sincronizacion de checkboxes visibles y labels en picklists multiselect al cargar un registro existente
- **PROHIBIDO:** Mezclar logica, artefactos, manuales o referencias de prospeccion comercial de EAS Mercurio (BANT, DISC, HubSpot, leads de nicho) en el proyecto ATLAS-SAP Operaciones
- **PROHIBIDO:** Omitir la columna 'fecha' en ALLOWED_COLUMNS para tablas de auditoria y logs donde el timestamp es 'fecha' y no 'created_at', provocando que la API despoje silenciosamente el ORDER BY y trunque registros recientes en PostgreSQL
