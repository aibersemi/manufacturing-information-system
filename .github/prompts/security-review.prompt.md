---
name: security-review
description: Review keamanan untuk scope atau perubahan yang diminta.
agent: Code Reviewer
---

Lakukan security review pada scope yang diminta user.

Fokus:

- Session cookie auth, CSRF, Origin validation, dan CORS.
- RBAC/capability, tenant isolation, object-level authorization, dan audit trail.
- Validasi Pydantic/Zod, file/media handling, dynamic property access, dan injection risk.
- WebSocket, background task, generated API client, dan kontrak OpenAPI bila tersentuh.
- Secret leakage, logging data sensitif, dan unsafe operational command.

Output:

1. Findings lebih dulu, diurutkan dari severity tertinggi.
2. Setiap finding menyertakan file/baris, attack path ringkas, dampak, dan rekomendasi.
3. Bila tidak ada finding, katakan jelas dan sebutkan residual risk atau test gap.

Jangan mengedit file kecuali user meminta fix eksplisit.
