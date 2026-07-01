---
name: pr-review
description: Review perubahan kerja saat ini seperti code review PR.
agent: Code Reviewer
---

Review perubahan yang sedang berjalan seperti PR review.

Proses:

1. Baca diff dan file terkait.
2. Cari bug, regresi perilaku, risiko security, type-safety issue, performa, migration risk, dan gap test.
3. Prioritaskan finding yang actionable. Jangan menulis komentar kosmetik.
4. Sertakan file/baris dan alasan teknis yang konkret.
5. Akhiri dengan ringkasan singkat dan test gap.

Format:

- Findings dulu, diurutkan berdasarkan severity.
- Open questions atau asumsi bila ada.
- Ringkasan perubahan hanya sebagai konteks sekunder.
