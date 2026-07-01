---
name: debug-backend
description: Gunakan skill ini saat mendiagnosis bug backend Django, API Django Ninja, Channels, Dramatiq, atau data domain MIS.
---

# Backend Debug Skill

Saat debug backend:

1. Reproduksi gejala dari test, log, request payload, atau endpoint yang disebut user.
2. Redaksi secret, cookie, token, password, DSN lengkap, IP/domain internal, dan data produksi sensitif sebelum menyalin log, payload, traceback, atau output ke artifact/repo.
3. Baca route API, schema Pydantic, service layer, model, permission helper, dan test terkait.
4. Pastikan tenant scope, membership/operator assignment, capability, status transition, dan audit trail tidak terlewat.
5. Untuk mutasi, cek CSRF, session auth, validasi input, transaksi database, dan efek samping outbox/Dramatiq.
6. Untuk bug data, cek migration, constraint, default, data seed, dan idempotensi command management.
7. Gunakan pytest spesifik terlebih dulu, misalnya `.venv/bin/pytest backend/api/test_auth.py -q`.
8. Jalankan `.venv/bin/ruff check .` setelah perubahan backend.
9. Jika perubahan memengaruhi runtime backend, ingatkan kebutuhan restart `manufacturing.service` atau service worker/scheduler yang relevan.
