---
trigger: always_on
---

# Angular & Supabase Frontend Development Rules

Pedoman dan batasan wajib untuk pengembangan frontend Angular (v22+) dan integrasi Supabase pada proyek ini.

## Angular Standards (v22+)

### TypeScript & Scaffolding
- Gunakan strict type checking. Hindari penggunaan tipe `any`; gunakan tipe spesifik atau `unknown` jika tipe belum pasti.
- Semua komponen, direktif, dan pipe secara default adalah **Standalone**. Jangan menambahkan flag redundan `standalone: true` di dalam dekorator.
- `ChangeDetectionStrategy.OnPush` adalah default di Angular v22+; tidak perlu menambahkan deklarasi `OnPush` secara manual kecuali ada kebutuhan khusus.
- Zoneless change detection diutamakan. Hindari ketergantungan pada `zone.js`.

### Reactivity & State Management
- Gunakan **Signals** (`signal()`, `computed()`, `effect()`) sebagai fondasi utama manajemen state.
- Hindari penggunaan `BehaviorSubject` atau RxJS berlebih untuk state lokal komponen yang dapat ditangani lebih bersih dengan Signals.
- Gunakan `update()` atau `set()` untuk memodifikasi signal; dilarang menggunakan metode mutasi langsung.
- Gunakan `linkedSignal()` untuk state turunan yang perlu sinkron dengan sumber reaktif lain namun dapat ditulis ulang secara lokal.
- Gunakan `resource()` atau `httpResource()` untuk penanganan asynchronous data fetching secara deklaratif.

### Components & Templates
- Jaga komponen tetap kecil dan fokus pada satu tanggung jawab tunggal.
- Gunakan fungsi `input()` dan `output()` modern, **bukan** dekorator `@Input()` dan `@Output()`.
- Gunakan fungsi `model()` untuk properti two-way binding dengan sintaks `[(prop)]`.
- Gunakan signal query (`viewChild()`, `viewChildren()`, `contentChild()`, `contentChildren()`) menggantikan dekorator `@ViewChild()` / `@ContentChild()`.
- Gunakan native control flow (`@if`, `@else`, `@for`, `@switch`) menggantikan direktif struktural usang (`*ngIf`, `*ngFor`, `*ngSwitch`).
- Jangan mengimpor `CommonModule` secara gelondongan. Impor hanya pipe atau direktif spesifik yang digunakan template (misalnya `AsyncPipe`, `DatePipe`).
- Gunakan binding `[class]` dan `[style]` standar, **jangan** menggunakan `ngClass` atau `ngStyle`.
- Letakkan host bindings di dalam properti `host: {}` pada metadata dekorator `@Component` atau `@Directive`, **bukan** menggunakan `@HostBinding()` atau `@HostListener()`.
- Gunakan `NgOptimizedImage` untuk gambar statis (tidak berlaku untuk gambar inline base64).
- Gunakan path relatif terhadap file komponen TS saat merujuk file template atau style eksternal.
- Hindari asumsi bahwa variabel/fungsi global (seperti `new Date()`) tersedia langsung di dalam template.

### Accessibility (A11y)
- Seluruh komponen UI wajib lolos pengujian AXE dan mematuhi standar minimum WCAG AA (focus management, kontras warna yang memadai, dan atribut ARIA yang tepat).

### Forms, Services & Routing
- Utamakan **Signal Forms** (`@angular/forms/signals`) untuk form baru dengan validasi berbasis skema dan akses field type-safe. Jika memerlukan pendekatan tradisional, gunakan Typed Reactive Forms (`FormGroup`, `FormControl`). Hindari Template-Driven Forms.
- Desain service dengan single responsibility. Gunakan `providedIn: 'root'` untuk singleton services (utamakan dekorator `@Service` di Angular v22+).
- Gunakan fungsi `inject()` untuk Dependency Injection, bukan constructor injection.
- Gunakan lazy loading untuk seluruh feature routes.
- Gunakan functional route guards (`canActivateFn`, `canMatchFn`) dan functional interceptors (`HttpInterceptorFn`).

---

## Supabase Frontend Integration Rules

### Core Security & Credentials Isolation
- Bundle frontend **HANYA** boleh memuat atau mengakses variabel lingkungan publik:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
- **Dilarang keras** memasukkan `SERVICE_ROLE_KEY`, password database, webhook secrets, atau credential administratif ke dalam kode klien atau file bundle frontend.
- Seluruh credential tetap tersimpan di `.env` dan tidak boleh di-hardcode.

### Client Architecture & Service Layer
- Bungkus `@supabase/supabase-js` dalam singleton Angular service (`providedIn: 'root'`) misal `SupabaseService`.
- Sediakan state reaktif untuk user session dan auth berbasis Signal:
  ```ts
  readonly session = signal<Session | null>(null);
  readonly currentUser = computed(() => this.session()?.user ?? null);
  ```
- Seluruh interaksi query data ke database Supabase harus tunduk pada Row Level Security (RLS) dan memperhitungkan konteks tenant/multi-company aktif.
- Selalu gunakan type contract yang di-generate dari skema PostgreSQL Supabase (`supabase gen types typescript`) untuk menjamin end-to-end type safety.
