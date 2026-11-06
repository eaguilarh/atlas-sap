# ATLAS · SAP Operations Suite (Frontend)

Repositorio oficial del cliente web de **ATLAS · SAP Operations & Management Suite**.
Arquitectura SPA (*Single Page Application*) desarrollada con tecnologías web estándar de alto rendimiento (HTML5, Vanilla JS, CSS3 con variables nativas).

- **Repositorio:** `https://github.com/eaguilarh01/atlas-frontend`
- **Organización:** EAS Consulting Group
- **Versión:** 2.5.5

---

## 1. Estructura del Proyecto

```text
atlas-frontend/
├── index.html                  # Núcleo SPA (Vistas, componentes y controladores reactivos)
├── styles.css                  # Sistema de diseño, paleta corporativa y temas claro/oscuro
├── favicon.png                 # Icono oficial del proyecto
├── tests/
│   └── frontend-lint.test.js   # Pruebas automatizadas de integridad DOM y sintaxis
├── .github/
│   └── workflows/
│       └── ci.yml              # Pipeline CI de GitHub Actions
├── package.json                # Definición del paquete y scripts
└── .gitignore                  # Exclusiones de seguridad
```

---

## 2. Ejecución y Desarrollo Local

El frontend puede ser servido por cualquier servidor estático local o consumirse a través del reverse proxy Nginx del backend:

```bash
# Servidor HTTP simple con Node.js
npx serve . -p 8080

# O utilizando Python 3
python -m http.server 8080
```

---

## 3. Pruebas Automatizadas

Para validar la integridad de las etiquetas, elementos del DOM e identificadores críticos de negocio:

```bash
npm test
```

---

## 4. Despliegue en Producción

El frontend se sincroniza directamente en el entorno de ejecución on-premise (Proxmox VE / Nginx Reverse Proxy) sirviendo los archivos bajo HTTPS sobre el puerto 8443.

