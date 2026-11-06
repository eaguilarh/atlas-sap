# SOLICITUD TÉCNICA DE RED Y FIREWALL FORTIGATE

**Para:** Equipo de Infraestructura / Administrador de Red y Firewall  
**De:** EAS Consulting Group — Equipo de Arquitectura de Software  
**Asunto:** Publicación Externa de la Suite ATLAS (SAP Operations) en Puerto 54321  
**Fecha:** 3 de Septiembre de 2026  

---

## 📌 1. RESUMEN DEL REQUERIMIENTO

Se requiere publicar y permitir el tráfico público entrante hacia la plataforma **ATLAS (SAP Operations Suite)** a través de la **IP Pública Externa: `187.170.135.143` en el Puerto `54321` (TCP)** hacia el servidor de aplicación interno.

Actualmente la plataforma opera correctamente en la red interna, pero las conexiones provenientes de redes externas (fuera de la oficina / VPN) son descartadas por el Firewall al no contar con la regla Virtual IP (VIP) activa en el puerto `54321`.

---

## 🛠️ 2. DATOS DE RED E INFRAESTRUCTURA

| Parámetro | Valor Técnico |
| :--- | :--- |
| **IP Pública Externa / DDNS** | `187.170.135.143` / `easconsulting.fortiddns.com` |
| **Puerto Público Asignado** | **`54321`** (TCP) |
| **IP Privada Gateway (Nginx Reverse Proxy)** | `10.10.10.101` |
| **IP Privada Servidor Aplicación (Proxmox Host)** | `10.10.10.102` |
| **Puerto Interno de Servicio** | **`54321`** (TCP) |
| **Configuración Adicional Requerida** | **NAT Loopback (Hairpin NAT)** habilitado |

---

## 🔒 3. REGLAS SUGERIDAS PARA FORTINET / FORTIGATE CLI

### Step 1: Creación de Objeto Virtual IP (VIP)
```text
config firewall vip
    edit "VIP_ATLAS_54321"
        set extip 187.170.135.143
        set extintf "any"
        set portforward enable
        set mappedip "10.10.10.101"
        set extport 54321
        set mappedport 54321
        set nat-loopback enable
    next
end
```

### Step 2: Política de Firewall (Permitir Tráfico WAN -> LAN)
```text
config firewall policy
    edit 0
        set name "Allow_ATLAS_54321_External"
        set srcintf "wan1"
        set dstintf "lan"
        set srcaddr "all"
        set dstaddr "VIP_ATLAS_54321"
        set action accept
        set schedule "always"
        set service "ALL"
        set logtraffic all
    next
end
```

---

## 🧪 4. PRUEBA DE VALIDACIÓN

Una vez aplicada la regla, la plataforma deberá responder adecuadamente tanto interna como externamente en:
👉 **`http://easconsulting.fortiddns.com:54321`**  
👉 **`http://187.170.135.143:54321`**
