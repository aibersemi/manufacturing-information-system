# Manufacturing Information System

Manufacturing Information System (MIS) adalah aplikasi web internal multi-company untuk mengelola operasional manufaktur dan produksi dalam satu alur data: Master Data, Purchasing, Inventory, Production, Sales, Receivables, Finance, Accounting, Assets, dan Financial Reporting. Setiap transaksi bekerja dalam active company dan dilindungi oleh session, permission, role, tenant scope, serta object-state authorization pada server.

## Documentation

- [Frontend Architecture and Angular Integration](docs/frontend.md) - Panduan arsitektur frontend Angular v22+, Signals, environment security, dan integrasi Supabase SDK.
- [Operations and Runtime Guide](docs/operations.md) - Panduan operasional sistem, manajemen systemd service, prosedur build & deployment, logging, health check, serta backup dan disaster recovery.
- [Public Routing and Edge Proxy](docs/routing-public.md) - Panduan arsitektur routing publik, reverse proxy Caddy edge server, dan tunnel WireGuard.
- [Security Architecture and Guidelines](docs/security.md) - Panduan arsitektur keamanan berlapis (defense-in-depth), standar Angular XSS/CSP, dan Supabase RLS multi-company.
- [Supabase Infrastructure and Integration](docs/supabase.md) - Panduan arsitektur stack Supabase self-hosted, status layanan, konfigurasi environment variable, dan manajemen operasional.

