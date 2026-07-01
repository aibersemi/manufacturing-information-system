---
name: explain-architecture
description: Jelaskan arsitektur MIS untuk area yang diminta tanpa mengedit file.
agent: Planner
---

Jelaskan arsitektur MIS untuk area yang diminta user.

Proses:

1. Baca `README.md`, README area, `docs/` yang relevan, dan file kode utama sebelum menjelaskan.
2. Jelaskan alur request/data dari frontend ke backend, service/domain, database, background task, atau WebSocket sesuai scope.
3. Sebutkan kontrak penting: auth, CSRF, RBAC, tenant isolation, audit, generated API client, dan validation boundary bila relevan.
4. Sertakan referensi file yang paling penting.
5. Jangan mengedit file.
