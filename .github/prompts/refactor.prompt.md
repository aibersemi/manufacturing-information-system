---
name: refactor-safely
description: Refactor area yang diminta tanpa mengubah perilaku publik.
agent: Implementer
---

Refactor area yang diminta user dengan risiko minimal.

Proses:

1. Baca implementasi dan test yang relevan lebih dulu.
2. Identifikasi perilaku publik yang harus dipertahankan.
3. Buat refactor kecil dan bertahap; hindari rewrite lintas modul bila tidak diperlukan.
4. Jangan mengubah kontrak API, capability, route, schema, atau payload kecuali diminta eksplisit.
5. Jalankan test/lint/typecheck yang relevan.
6. Ringkas perubahan, perilaku yang dipertahankan, validasi, dan risiko tersisa.
