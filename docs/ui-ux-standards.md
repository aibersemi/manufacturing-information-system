# UI/UX Standards & Layout Blueprint

Dokumen standar baku UI/UX bagi tim pengembang dan agen AI saat merancang atau menambahkan antarmuka pengguna pada proyek Manufacturing Information System (MIS). Seluruh halaman, fitur, dan komponen baru **wajib** mengikuti standar ini agar tampilan konsisten, serasi, dan identik dengan desain referensi (`/opt/services/konveksi`).

---

## 1. Prinsip Tipografi & Ukuran Font

### Hirarki Font Wajib
- Gunakan font keluarga **Inter Variable** (`--font-sans`).
- **Judul Halaman (Page Title)**: `text-2xl font-semibold tracking-tight text-foreground`
- **Subtitle Halaman**: `text-sm text-muted-foreground mt-1`
- **Judul Kartu / Card Title**: `text-base font-semibold tracking-tight text-foreground` (atau `text-lg font-semibold`)
- **Deskripsi Kartu / Card Description**: `text-sm text-muted-foreground`
- **Teks Utama Item / List Data**: `text-sm font-medium text-foreground` (untuk kode dokumen gunakan `font-mono text-sm font-semibold`)
- **Teks Metadata / Subtitle Item**: `text-xs text-muted-foreground`
- **Input Form & Placeholder**: `text-sm text-foreground placeholder:text-muted-foreground`
- **Tombol Aksi (Buttons)**: `text-sm font-medium` (tinggi standar `h-9` atau `h-10`)
- **Badge Status / Pill**: `text-xs font-medium` (padding `px-2.5 py-0.5 rounded-full`)
- **Label Metrik KPI**: `text-sm font-medium text-muted-foreground`
- **Nilai Angka Metrik KPI**: `text-xl sm:text-2xl font-semibold tracking-tight text-foreground`
- **Footnote / Target Metrik**: `text-xs` (misalnya `text-xs text-muted-foreground` atau `text-xs text-emerald-600 font-medium`)

### Larangan Keras Font
> [!CAUTION]
> **DILARANG** menggunakan kelas font terlalu kecil seperti `text-[10px]` atau `text-[11px]`. Seluruh elemen UI yang membutuhkan font kompak wajib menggunakan minimal `text-xs` (12px), dan teks utama/navigasi/input wajib menggunakan `text-sm` (14px).

---

## 2. Ikonografi & Komponen UI

- Gunakan **Phosphor Icons** dari paket `@ng-icons/phosphor-icons` (gaya Regular). Hindari mencampuradukkan library ikon lain.
- Gunakan komponen **spartan/ui** (Brain primitives + Helm components):
  - `hlmCard`, `hlmCardHeader`, `hlmCardTitle`, `hlmCardDescription`, `hlmCardContent`, `hlmCardFooter`
  - `hlmBtn` dengan varian `default`, `outline`, `ghost`, `destructive`
  - `hlmBadge` dengan varian `default`, `secondary`, `outline`, `destructive`
  - `hlmInput` untuk form fields
  - `hlmDropdownMenu` untuk menu popover dan filter

---

## 3. Atmosfer, Radius & Desain Visual

- **Radius Sudut Baku**:
  - Kontainer kartu utama & tabel data: `rounded-3xl`
  - Tombol aksi utama, search input, filter tabs, dan status badge: `rounded-full` (*pill style*)
  - Dropdown menu & modal: `rounded-2xl`
  - Submenu navigasi: `rounded-md` atau `rounded-lg`
- **Border & Shadow**:
  - Border kartu: `border border-border/80`
  - Background kartu: `bg-card` (atau `bg-card/80` dengan backdrop blur halus)
  - Shadow kartu: `shadow-xs` dengan efek transisi hover `transition hover:shadow-sm`
  - Shadow tombol pill & search: `shadow-2xs`
- **Background Halaman**:
  - Diatur otomatis di `src/styles.css` dengan multi-layer radial gradient bernuansa teal-sage dan dot-grid mask halus.

---

## 4. Pola Struktur Halaman Baru (Standard Page Blueprint)

Setiap pembuatan halaman fitur baru di dalam dashboard wajib menyusun layout dengan struktur berikut:

### TypeScript Template (`*.component.ts`)
```ts
import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorMagnifyingGlass,
  phosphorPackage,
  phosphorPlus,
  phosphorTrendUp,
} from '@ng-icons/phosphor-icons/regular';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';

@Component({
  selector: 'app-fitur-contoh',
  imports: [
    FormsModule,
    NgIcon,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCardImports,
  ],
  providers: [
    provideIcons({
      phosphorArrowsClockwise,
      phosphorPlus,
      phosphorTrendUp,
      phosphorMagnifyingGlass,
      phosphorPackage,
    }),
  ],
  templateUrl: './fitur-contoh.component.html',
})
export class FiturContohComponent {
  readonly searchQuery = signal('');
  readonly statusFilter = signal<'all' | 'active'>('all');

  setStatusFilter(status: 'all' | 'active'): void {
    this.statusFilter.set(status);
  }
}
```

### HTML Template (`*.component.html`)
```html
<main class="flex flex-1 flex-col gap-6">
  <!-- 1. Header Halaman & Action Buttons -->
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight text-foreground">Nama Fitur</h1>
      <p class="text-sm text-muted-foreground mt-1">
        Deskripsi singkat fungsi dan tujuan dari fitur/halaman ini.
      </p>
    </div>

    <div class="flex items-center gap-2">
      <!-- Secondary Action Pill -->
      <button
        hlmBtn
        variant="outline"
        size="sm"
        class="h-9 gap-1.5 rounded-full border-border/80 bg-card/80 px-3.5 text-sm font-medium shadow-2xs hover:bg-accent"
      >
        <ng-icon name="phosphorArrowsClockwise" class="size-4" />
        <span>Segarkan Data</span>
      </button>

      <!-- Primary Action Pill -->
      <button
        hlmBtn
        size="sm"
        class="h-9 gap-1.5 rounded-full px-4 text-sm font-medium shadow-xs"
      >
        <ng-icon name="phosphorPlus" class="size-4" />
        <span>Tambah Baru</span>
      </button>
    </div>
  </div>

  <!-- 2. Ringkasan Metrik / KPI (Jika Diperlukan) -->
  <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Ringkasan Metrik">
    <div hlmCard class="rounded-3xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs transition hover:shadow-sm">
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium text-muted-foreground">Label Metrik</span>
        <div class="flex size-7 items-center justify-center rounded-full bg-teal-500/10 text-teal-600 dark:text-teal-400">
          <ng-icon name="phosphorTrendUp" class="size-4" />
        </div>
      </div>
      <div class="mt-2 text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
        1,250 <span class="text-sm font-normal text-muted-foreground">Unit</span>
      </div>
      <div class="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span class="font-semibold text-emerald-600 dark:text-emerald-400">+5%</span>
        <span>• Periode aktif</span>
      </div>
    </div>
  </section>

  <!-- 3. Search & Filter Controls Pill Bar -->
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <!-- Search Pill -->
    <div class="relative w-full max-w-sm">
      <ng-icon
        name="phosphorMagnifyingGlass"
        class="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        type="text"
        [ngModel]="searchQuery()"
        (ngModelChange)="searchQuery.set($event)"
        placeholder="Cari data..."
        class="w-full rounded-full border border-border bg-card ps-10 pe-4 py-2 text-sm text-foreground placeholder:text-muted-foreground shadow-2xs transition focus:bg-background focus:ring-2 focus:ring-ring focus:outline-hidden"
      />
    </div>

    <!-- Filter Tab Pills -->
    <div class="flex items-center gap-1 self-start rounded-full border border-border/80 bg-card p-1 shadow-2xs sm:self-auto">
      <button
        type="button"
        (click)="setStatusFilter('all')"
        [class.bg-muted]="statusFilter() === 'all'"
        [class.text-foreground]="statusFilter() === 'all'"
        [class.font-semibold]="statusFilter() === 'all'"
        class="rounded-full px-3.5 py-1 text-sm text-muted-foreground transition hover:text-foreground"
      >
        Semua
      </button>
      <button
        type="button"
        (click)="setStatusFilter('active')"
        [class.bg-muted]="statusFilter() === 'active'"
        [class.text-foreground]="statusFilter() === 'active'"
        [class.font-semibold]="statusFilter() === 'active'"
        class="rounded-full px-3.5 py-1 text-sm text-muted-foreground transition hover:text-foreground"
      >
        Aktif
      </button>
    </div>
  </div>

  <!-- 4. Konten Utama / Tabel Data Card -->
  <div hlmCard class="rounded-3xl border border-border/80 bg-card shadow-xs overflow-hidden">
    <div hlmCardHeader class="border-b border-border/60 px-5 py-4">
      <div class="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 hlmCardTitle class="text-base font-semibold tracking-tight text-foreground">
            Daftar Data
          </h2>
          <p hlmCardDescription class="text-sm text-muted-foreground">
            Keterangan tentang data yang ditampilkan di bawah ini.
          </p>
        </div>
      </div>
    </div>

    <div hlmCardContent class="p-0">
      @if (items().length === 0) {
        <div class="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
          <p class="text-sm font-medium">Tidak ada data yang ditemukan</p>
          <p class="text-xs text-muted-foreground mt-1">Coba gunakan kata kunci pencarian atau filter lain.</p>
        </div>
      } @else {
        <div class="divide-y divide-border/60">
          @for (item of items(); track item.id) {
            <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 transition hover:bg-muted/40">
              <div class="flex items-center gap-3 min-w-0">
                <div class="flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground">
                  <ng-icon name="phosphorPackage" class="size-4" />
                </div>
                <div class="flex flex-col min-w-0">
                  <span class="truncate text-sm font-medium text-foreground">{{ item.name }}</span>
                  <div class="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    <span>{{ item.category }}</span>
                    <span>•</span>
                    <span>{{ item.updatedAt }}</span>
                  </div>
                </div>
              </div>

              <div class="flex items-center gap-4 ms-auto">
                <span
                  hlmBadge
                  variant="secondary"
                  class="rounded-full px-2.5 py-0.5 text-xs font-medium"
                >
                  {{ item.status }}
                </span>
              </div>
            </div>
          }
        </div>
      }
    </div>
  </div>
</main>
```

---

## 5. Integrasi Routing & Shell Navigasi

- Seluruh fitur baru yang memerlukan shell navigasi **wajib didaftarkan sebagai child routes** dari `DashboardLayoutComponent` di `src/app/app.routes.ts`:
  ```ts
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./layout/dashboard-layout/dashboard-layout.component').then(
        (m) => m.DashboardLayoutComponent,
      ),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then(
            (m) => m.DashboardComponent,
          ),
      },
      {
        path: 'fitur-baru',
        loadComponent: () =>
          import('./features/fitur-baru/fitur-baru.component').then(
            (m) => m.FiturBaruComponent,
          ),
      },
    ],
  }
  ```
- Tambahkan link menu pada accordion group terkait di `src/app/layout/dashboard-layout/dashboard-layout.component.html` dengan format:
  ```html
  <a
    routerLink="/fitur-baru"
    routerLinkActive="text-foreground font-semibold"
    class="rounded-md px-2 py-1.5 text-sm text-muted-foreground transition hover:text-foreground"
    (click)="closeMobileMenu()"
  >
    Label Menu Fitur
  </a>
  ```
