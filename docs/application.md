# Application Architecture and Angular Integration

Dokumen ini menjelaskan arsitektur aplikasi Manufacturing Information System (MIS) yang dibangun menggunakan Angular v22+, integrasi reaktif dengan Supabase, pengelolaan environment, dan perintah operasional.

---

## Technical Stack

- **Framework**: Angular v22 (Standalone components, Zoneless change detection)
- **Language**: TypeScript (Strict mode)
- **State Management**: Angular Signals (`signal()`, `computed()`, `linkedSignal()`, `resource()`)
- **UI Library**: spartan/ui v1.4.1 (Brain primitives + Helm components bergaya Luma)
- **Styling**: Tailwind CSS v4 dengan CSS design tokens OKLCH
- **Typography**: `@fontsource-variable/inter` (Inter Variable)
- **Icons**: `@ng-icons/core` & `@ng-icons/phosphor-icons` (Phosphor Regular)
- **Notifications**: `@spartan-ng/brain/sonner` & `@spartan-ng/helm/sonner`
- **Backend SDK**: `@supabase/supabase-js` dengan schema types otomatis dari PostgreSQL

---

## Directory Structure

```text
src/
├── app/
│   ├── core/
│   │   ├── guards/
│   │   │   ├── auth.guard.ts           # Functional route guard (CanActivateFn) dengan returnUrl
│   │   │   ├── guest.guard.ts          # Guard pencegah akses login untuk sesi aktif
│   │   │   └── owner.guard.ts          # Guard pembatasan akses khusus peran Owner
│   │   ├── services/
│   │   │   ├── auth.service.ts         # Reactive session & user state via Signals + waitForAuthReady()
│   │   │   ├── company.service.ts      # Multi-company context, RLS tenant scope, & local storage persistence
│   │   │   ├── settings.service.ts     # Layanan CRUD Perusahaan, Penugasan Pengguna, Matriks Izin, Profil, & Audit
│   │   │   ├── storage.service.ts      # Layanan upload, signed URL, & manajemen file Supabase Storage
│   │   │   └── supabase.service.ts     # Singleton Supabase client wrapper (PKCE Flow)
│   │   └── utils/
│   │       └── url.util.ts             # Sanitasi URL & mitigasi Open Redirect
│   ├── features/
│   │   ├── auth/login/                 # Komponen halaman masuk login
│   │   ├── dashboard/                  # Komponen overview metrik manufaktur
│   │   └── settings/
│   │       ├── companies/              # Manajemen fasilitas manufaktur & multi-company (/workspace/companies)
│   │       ├── users-access/           # Penugasan staf & matriks izin akses per peran (/workspace/users-access)
│   │       └── profile/                # Profil pribadi, data rekening bank, & ganti password (/workspace/profile)
│   ├── layout/
│   │   └── dashboard-layout/           # Layout utama (sidebar navigasi + header profil)
│   ├── app.config.ts                   # Provider zoneless, router, & error listeners
│   ├── app.routes.ts                   # Rute modular dengan lazy loading & guard otorisasi
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
| `npm run serve:prod` | Menjalankan web server statis produksi (SPA fallback di port `${APP_PORT}`) |
| `npm test` | Menjalankan pengujian unit berbasis Vitest (`ng test`) |
| `npm run lint` | Menjalankan analisis statis kode dan template HTML menggunakan angular-eslint |
| `npm run types:db` | Meng-generate ulang `src/types/database.types.ts` dari skema database aktif |
| `sudo systemctl status manufacturing-information-system` | Memeriksa status unit systemd service produksi |
| `sudo journalctl -u manufacturing-information-system -f` | Memantau log realtime service |

---

## AI Pair Programming & MCP Tools

Proyek ini telah dikonfigurasi dengan:
- **Local Agent Skills**: `.agents/skills/angular-developer`, `.agents/skills/angular-new-app`, `.agents/skills/spartan`, `.agents/skills/supabase`, dan `.agents/skills/supabase-postgres-best-practices`.
- **Local MCP Servers**: [.agents/mcp_config.json](../.agents/mcp_config.json) yang mencakup **Angular CLI MCP** (`get_best_practices`, `run_target`, `devserver`), **Spartan MCP** (`spartan_components_get`, `spartan_blocks_get`, `spartan_accessibility_check`, dokumentasi UI), dan **Supabase DB MCP** (`query`, `execute`, `list_tables`, `describe_table`).
- **Frontend Guidelines**: [.agents/rules/angular.md](../.agents/rules/angular.md) untuk memastikan penulisan kode modern bebas dari pola legacy.
- **UI/UX Design System Standards**: [docs/ui-ux-standards.md](ui-ux-standards.md) sebagai acuan baku tata letak, ukuran font, palet, dan blueprint halaman baru.

---

## Examples

Contoh modern standalone component Angular v22+ dengan signals dan native control flow:

```ts
import { Component, signal } from '@angular/core';

@Component({
  selector: 'app-server-status',
  templateUrl: './server-status.component.html',
  styleUrl: './server-status.component.css',
})
export class ServerStatusComponent {
  protected readonly isServerRunning = signal(true);

  toggleServerStatus(): void {
    this.isServerRunning.update(running => !running);
  }
}
```

```css
.container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;

  button {
    margin-top: 10px;
  }
}
```

```html
<section class="container">
  @if (isServerRunning()) {
    <span>Yes, the server is running</span>
  } @else {
    <span>No, the server is not running</span>
  }
  <button type="button" (click)="toggleServerStatus()">Toggle Server Status</button>
</section>
```

Saat memperbarui komponen, tempatkan logic di dalam file `.ts`, styles di dalam file `.css`, dan HTML template di dalam file `.html` menggunakan relative paths.

### Integrasi Supabase Storage di Angular Component

```ts
import { Component, inject, signal } from '@angular/core';
import { StorageService } from '../../core/services/storage.service';

@Component({
  selector: 'app-qc-upload',
  template: `
    <input type="file" (change)="onFileSelected($event)" accept="image/*,video/*,.pdf" />
    @if (previewUrl()) {
      <img [src]="previewUrl()" alt="QC Preview" class="w-48 h-48 rounded object-cover" />
    }
  `
})
export class QcUploadComponent {
  private readonly storage = inject(StorageService);
  protected readonly previewUrl = signal<string | null>(null);

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    // 1. Upload ke bucket privat manufacturing-media
    const uploaded = await this.storage.uploadFile(file, undefined, { folder: 'qc-inspections' });

    // 2. Buat Signed URL sementara untuk preview aman di browser
    const signedUrl = await this.storage.getSignedUrl(uploaded.path, 1800);
    this.previewUrl.set(signedUrl);
  }
}
```
