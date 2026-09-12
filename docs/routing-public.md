# Public Routing and Edge Proxy

Dokumen ini menjelaskan alur routing publik dan reverse proxy edge server untuk Manufacturing Information System (MIS).

---

## Architecture Overview

- **Domain Aplikasi**: `${APP_DOMAIN}`
- **IP WireGuard Server Aplikasi**: `${APP_WIREGUARD_IP}`
- **Port Aplikasi**: `${APP_PORT}`
- **Alur Trafik Standar**:
  ```text
  Client / Browser -> [${APP_DOMAIN}]
                   -> VPS Edge Server (${TUNNEL_VPS_PUBLIC_IP})
                   -> Caddy Reverse Proxy
                   -> WireGuard Tunnel (${TUNNEL_VPS_WIREGUARD_IP} -> ${APP_WIREGUARD_IP}:${APP_PORT})
                   -> Manufacturing Information System
  ```

---

## Configuration & Management

1. **Lokasi Konfigurasi**:
   - Konfigurasi route domain dilakukan pada Caddy di VPS `${TUNNEL_VPS_HOST}`, bukan di dalam repositori aplikasi ini.
2. **Pola Reverse Proxy**:
   - `${APP_DOMAIN}` -> `http://${APP_WIREGUARD_IP}:${APP_PORT}`
3. **Instruksi Pembaruan Caddy**:
   - Untuk membaca SOP pembaruan konfigurasi Caddyfile di edge server:
     ```bash
     ssh "${TUNNEL_VPS_HOST}" 'sed -n "1,220p" /opt/services/caddy/AGENTS.md'
     ```