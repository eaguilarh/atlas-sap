# Reglas de Prevención de UI, Encoding y Control de Eventos (ATLAS SAP Operaciones)

## 1. Preservación de Codificación UTF-8 y Prevención de Mojibakes
- **Regla**: Todos los archivos HTML/JS deben ser leídos y guardados estrictamente con codificación UTF-8 (sin BOM).
- **Prohibición**: No utilizar scripts de powershell con strings multilínea `@""@` que interpreten caracteres especiales o variables de CSS como `--text2` como operadores unarios, ya que corrompen la codificación ANSI/UTF-8. Usar scripts de C# (`Add-Type`) o compiladores con soporte nativo de UTF-8 (`UTF8Encoding(false)`).

## 2. Invocación Segura de Handlers de Eventos (`onclick`)
- **Regla**: Nunca pasar índices de arreglos globales efímeros en los atributos `onclick` (ej. `onclick="showDetail(window._cachedAlertRfcs[idx])"`), ya que lanzan `TypeError: Cannot read properties of undefined (reading '0')` si los datos se refrescan o no existen.
- **Solución Obligatoria**: Pasar identificadores únicos por cadena escapada (ej. `onclick="showDetail('${escapeHtml(r.ticket)}')"`), los cuales buscan de forma resiliente el objeto por Ticket/ID en `getAll()` o `SOL_RECORDS`.

## 3. Prevención de Superposición de Elementos en Modales (Flex Layout)
- **Regla**: Las cabeceras de cuadros modales que contienen Código de Ticket, Badge de Estado y Botones de Acción (`Drill-down`, `Reprogramar`, `Editar`) deben implementarse utilizando contenedores `display: flex; flex-direction: column; gap: 12px;` con sub-contenedores que tengan `flex-wrap: wrap; gap: 10px;`.
- **Prohibición**: Evitar el uso de `flex: 1` con `min-width: 0` junto a botones con `flex-shrink: 0` sin permitir el salto de línea (`flex-wrap`), ya que causa que los títulos y badges se encimen visualmente.

## 4. Gestión de Picklists Multiselect y Sincronización en Modos de Edición
- **Regla**: Los controladores de UI globales (como `toggleMultiSelectDropdown`, `updateSistemasSelectLabel`, `updateKofSelectLabel`) deben declararse única y exclusivamente en el scope global del motor principal y nunca deben redefinirse dentro de funciones de ciclo de vida (`editFromDetail`, `clearForm`, etc.).
- **Prohibición**: Jamás sobrescribir `window.toggleMultiSelectDropdown` con implementaciones reducidas que asuman IDs fijos (`multiselect-${type}-dropdown`). La función canónica debe soportar resolución polimórfica de identificadores (`id`, `${id}-dropdown-menu`, `multiselect-${id}-dropdown`, etc.) y delegación de eventos con `stopPropagation`.
- **Sincronización Bidireccional en Edición**: Al poblar formularios en modo edición (`editFromDetail`), es obligatorio actualizar tanto los elementos `<select>` ocultos como los inputs de tipo checkbox visibles (`input[name="rfc-sistema-cb"]` y `input.kof-checkbox-item`), disparando inmediatamente sus funciones de actualización de label (`updateRfcGrupoFromSistemas()`, `updateSistemasSelectLabel()`, `updateKofSelectLabel()`) para reflejar los elementos preseleccionados en el trigger del picklist.

