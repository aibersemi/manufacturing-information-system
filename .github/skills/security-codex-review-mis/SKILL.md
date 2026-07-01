---
name: security-codex-review-mis
description: Gunakan skill ini saat melakukan security review, security diff scan, repository/path scan, triage finding, atau fix finding MIS dengan workflow Codex Security, terutama untuk auth, CSRF, RBAC, tenant isolation, audit trail, file/media, WebSocket, Dramatiq, API contract, dan frontend session safety.
---

# Security Codex Review MIS

## Prinsip

- Ikuti `AGENTS.md`, `docs/security.md`, `docs/permission-matrix.md`, `backend/README.md`, dan `frontend/README.md` sesuai scope.
- Pakai workflow Codex Security bila tersedia untuk scan formal:
  - Diff/PR/commit/branch/working-tree: gunakan security diff scan.
  - Repository atau path luas: gunakan security scan.
  - Finding tervalidasi atau plausible yang diminta diperbaiki: gunakan fix finding.
  - Finding dari scanner/tiket/advisory: gunakan triage/finding workflow yang sesuai.
- Jangan mengklaim coverage scan penuh bila workflow Codex Security tidak selesai dengan artifact/receipt yang diminta.
- Untuk review manual biasa, ambil stance code review: findings dulu, severity tertinggi dulu, dengan file/baris dan attack path ringkas.

## Threat Model MIS

Prioritaskan area ini:

- Auth session cookie, login/logout, tenant switch, password change, superadmin bootstrap.
- CSRF untuk mutasi API dan validasi Origin untuk WebSocket.
- RBAC/capability, object-level authorization, operator assignment, dan tenant isolation.
- Mutasi stok, approval, finance/accounting, audit trail, dan status transition.
- File/media private handling: path, tipe, ukuran, tenant permission, archive, PDF/XLSX generation.
- Background task/outbox/Dramatiq: retry safety, idempotency, duplicate side effect.
- Frontend session safety: tidak ada credential di Local/Session Storage, API client memakai cookie credentials dan CSRF.
- API contract: Django Ninja/Pydantic, Orval generated client, Zod boundary, error normalization.

## Workflow Review

1. Tentukan scope:
   - diff, commit, branch, working tree, path, module, finding, atau endpoint.
2. Baca konteks minimal:
   - route/API/schema/service/model/test terkait, permission helper, capability map, docs security/permission, dan pemanggil frontend bila relevan.
3. Trace source ke sink:
   - input attacker, boundary validasi, authn/authz, tenant/object scope, sink/side effect, audit/logging, dan error handling.
4. Kalibrasi severity:
   - prasyarat attacker, data tenant, privilege, dampak bisnis, exploitability, dan kontrol yang sudah ada.
5. Tulis findings:
   - file/baris, attack path, dampak, bukti, rekomendasi minimal, dan test yang perlu ada.
6. Bila user meminta fix:
   - reproduksi atau encode issue sebagai test bila feasible.
   - patch boundary terkecil yang menegakkan invariant.
   - tambahkan regression test dan positive test untuk perilaku sah.
   - validasi exploit tidak lagi reproduksi.

## Hard Rules

- Jangan melemahkan autentikasi, CSRF, RBAC, tenant isolation, audit trail, validasi input, atau logging untuk membuat test pass.
- Jangan menyimpan token, cookie, password, tenant context, atau kredensial di Local Storage atau Session Storage.
- Jangan menganggap UI guard sebagai otorisasi. Backend harus menolak request tidak sah.
- Jangan menutup finding hanya dengan "terlihat aman"; harus ada bukti reachability atau counterevidence konkret.
- Jangan memperluas fix ke refactor besar bila invariant bisa ditegakkan secara lokal.
- Jangan memasukkan secret atau data produksi sensitif ke artifact, log, test fixture, atau repo.
- Jangan hardcode ID dari URL contoh; normalisasi menjadi route dinamis atau query parameter.

## Validasi

Gunakan command relevan:

- Backend: `.venv/bin/ruff check .` dan `.venv/bin/pytest <path>` atau `.venv/bin/pytest --testmon --reuse-db`.
- Frontend: `npm run lint`, `npm run typecheck`, `npm run test:frontend`, dan `npm run build` bila UI/routing/build config signifikan.
- API contract berubah: `npm run generate:api` lalu `npm run contract:check`.
- Security fix: jalankan reproducer/PoC/test yang membuktikan issue asli tidak lagi berhasil, plus positive test perilaku sah.

## Output

Untuk review, berikan findings dulu. Untuk fix, ringkas file berubah, invariant yang ditegakkan, test/validasi yang dijalankan, bukti issue asli tidak reproduksi, dan risiko tersisa.
