# Frontend Architecture and Angular Integration

Dokumen ini menjelaskan arsitektur frontend Manufacturing Information System (MIS) yang dibangun menggunakan Angular v22+, integrasi reaktif dengan Supabase, pengelolaan environment, dan perintah operasional.

---

## Technical Stack

- **Framework**: Angular v22 (Standalone components, Zoneless change detection)
- **Language**: TypeScript (Strict mode)
- **State Management**: Angular Signals (`signal()`, `computed()`, `linkedSignal()`, `resource()`)
- **Testing**: Vitest dengan browser headless / JSDOM runner
- **Backend SDK**: `@supabase/supabase-js` dengan schema types otomatis dari PostgreSQL

---

## Directory Structure

```text
src/
├── app/
│   ├── core/
│   │   ├── guards/
│   │   │   └── auth.guard.ts           # Functional route guard (CanActivateFn)
│   │   └── services/
│   │       ├── auth.service.ts         # Reactive session & user state via Signals
│   │       └── supabase.service.ts     # Singleton Supabase client wrapper
│   ├── app.config.ts                   # Provider zoneless, router, & error listeners
│   ├── app.routes.ts                   # Rute modular dengan lazy loading
│   └── app.ts                          # Root component
├── environments/
│   ├── environment.example.ts          # Template deklarasi variabel environment
│   ├── environment.ts                  # Di-generate otomatis dari .env (di-ignore git)
│   └── environment.development.ts      # Di-generate otomatis dari .env (di-ignore git)
├── types/
│   └── database.types.ts               # Tipe data TypeScript skema PostgreSQL Supabase
├── main.ts                             # Entry point bootstrap aplikasi zoneless
└── styles.css                          # Global CSS design tokens & utilities
```

---

## Environment & Security Management

- Frontend hanya mengakses variabel publik: `SUPABASE_URL` dan `SUPABASE_ANON_KEY`.
- Variabel rahasia seperti `SERVICE_ROLE_KEY` dilarang keras masuk ke dalam bundle klien.
- File konfigurasi `src/environments/environment.ts` dibuat secara otomatis sebelum build atau start menggunakan script `scripts/generate-env.mjs` yang membaca nilai langsung dari `.env` lokal tanpa meng-commit file environment ke repositori.

---

## Operational Commands

| Perintah | Deskripsi |
| :--- | :--- |
| `npm start` | Menjalankan generate environment dan start server development (`ng serve`) |
| `npm run build` | Melakukan kompilasi bundle produksi aplikasi (`ng build`) |
| `npm test` | Menjalankan pengujian unit berbasis Vitest (`ng test`) |
| `npm run types:db` | Meng-generate ulang `src/types/database.types.ts` dari skema database aktif |

---

## AI Pair Programming & MCP Tools

Proyek ini telah dikonfigurasi dengan:
- **Local Agent Skills**: `.agents/skills/angular-developer`, `.agents/skills/angular-new-app`, `.agents/skills/supabase`, dan `.agents/skills/supabase-postgres-best-practices`.
- **Local Angular CLI MCP Server**: `.antigravity/mcp.json` yang memungkinkan agen mengeksekusi `get_best_practices`, `run_target`, dan `devserver` secara terisolasi di dalam proyek.
- **Frontend Guidelines**: [.agents/rules/angular.md](../.agents/rules/angular.md) untuk memastikan penulisan kode modern bebas dari pola legacy.
