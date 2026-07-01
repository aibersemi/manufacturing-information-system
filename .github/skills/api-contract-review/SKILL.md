---
name: api-contract-review
description: Gunakan skill ini saat meninjau perubahan kontrak API Django Ninja, schema OpenAPI, Orval client, atau integrasi frontend-backend MIS.
---

# API Contract Review Skill

Saat meninjau kontrak API:

1. Baca endpoint Django Ninja, schema Pydantic, service/domain logic, generated Orval client, dan pemanggil frontend.
2. Pastikan request/response schema tidak berubah diam-diam tanpa update client dan test.
3. Periksa session auth, CSRF untuk mutasi, RBAC/capability, tenant scope, dan audit trail.
4. Pastikan error shape, status code, pagination, sorting, filtering, dan empty state konsisten dengan pola endpoint lain.
5. Jika schema backend berubah, jalankan `npm run generate:api`, tinjau diff generated, lalu jalankan `npm run contract:check`.
6. Untuk form frontend, pastikan payload dibentuk lewat Zod/TanStack Form boundary sebelum memanggil API.
7. Jangan mengedit `frontend/src/api/generated/` secara manual.
