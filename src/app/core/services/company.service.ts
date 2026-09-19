import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { Tables } from '../../../types/database.types';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

export type Company = Tables<'company'>;
export type UserCompanyAssignment = Tables<'user_company_assignment'>;

const STORAGE_KEY = 'mis_active_company_id';

@Injectable({
  providedIn: 'root',
})
export class CompanyService {
  private readonly supabase = inject(SupabaseService);
  private readonly authService = inject(AuthService);

  readonly availableCompanies = signal<Company[]>([]);
  readonly activeCompanyId = signal<string | null>(null);
  readonly userAssignments = signal<UserCompanyAssignment[]>([]);
  readonly isLoading = signal<boolean>(false);

  readonly activeCompany = computed<Company | null>(() => {
    const id = this.activeCompanyId();
    if (!id) return null;
    return this.availableCompanies().find((c) => c.id === id) ?? null;
  });

  readonly userRoles = signal<string[]>([]);

  readonly isOwner = computed<boolean>(() => {
    return this.userRoles().includes('owner');
  });

  constructor() {
    // Muat company setiap kali auth session berubah
    effect(() => {
      const user = this.authService.currentUser();
      if (user) {
        this.loadUserCompanies();
      } else {
        this.availableCompanies.set([]);
        this.activeCompanyId.set(null);
        this.userAssignments.set([]);
        this.userRoles.set([]);
      }
    });
  }

  /**
   * Menunggu resolusi perusahaan aktif selesai saat inisialisasi aplikasi
   */
  async waitForActiveCompany(): Promise<string | null> {
    if (this.activeCompanyId()) {
      return this.activeCompanyId();
    }
    await this.authService.waitForAuthReady();
    if (!this.authService.currentUser()) {
      return null;
    }
    if (this.availableCompanies().length === 0) {
      await this.loadUserCompanies();
    }
    return this.activeCompanyId();
  }

  /**
   * Mengambil daftar perusahaan yang ditugaskan kepada pengguna saat ini
   * dan menetapkan perusahaan aktif dari cache localStorage atau default.
   */
  async loadUserCompanies(): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) {
      return;
    }

    this.isLoading.set(true);

    try {
      // Ambil penugasan user beserta detail company
      const [assignmentsRes, companiesRes] = await Promise.all([
        this.supabase.client
          .from('user_company_assignment')
          .select('*')
          .eq('user_id', user.id)
          .eq('is_active', true),
        this.supabase.client
          .from('company')
          .select('*')
          .eq('is_active', true),
      ]);

      if (assignmentsRes.error) {
        console.error('Gagal memuat user company assignments:', assignmentsRes.error);
        return;
      }

      if (companiesRes.error) {
        console.error('Gagal memuat company:', companiesRes.error);
        return;
      }

      const assignments = (assignmentsRes.data ?? []) as UserCompanyAssignment[];
      const companies = (companiesRes.data ?? []) as Company[];

      this.userAssignments.set(assignments);
      this.availableCompanies.set(companies);

      // Resolusi active company
      const cachedCompanyId = this.getStoredCompanyId();
      let targetCompanyId: string | null = null;

      if (cachedCompanyId && companies.some((c) => c.id === cachedCompanyId)) {
        targetCompanyId = cachedCompanyId;
      } else if (companies.length > 0) {
        targetCompanyId = companies[0].id;
      }

      this.setActiveCompanyInternal(targetCompanyId, assignments);
    } catch (err) {
      console.error('Error saat loadUserCompanies:', err);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Memilih perusahaan aktif dan menyimpan preferensi ke localStorage
   */
  setActiveCompany(companyId: string): void {
    const exists = this.availableCompanies().some((c) => c.id === companyId);
    if (!exists) {
      console.warn(`Company dengan ID ${companyId} tidak ditemukan di daftar perusahaan aktif.`);
      return;
    }

    this.setActiveCompanyInternal(companyId, this.userAssignments());
  }

  /**
   * Mengalihkan perusahaan aktif ke entitas baru dengan validasi ketersediaan
   */
  switchActiveCompany(companyId: string): boolean {
    const target = this.availableCompanies().find((c) => c.id === companyId);
    if (!target) {
      console.warn(`Perusahaan dengan ID ${companyId} tidak ditemukan.`);
      return false;
    }
    this.setActiveCompany(companyId);
    return true;
  }

  private setActiveCompanyInternal(
    companyId: string | null,
    assignments: UserCompanyAssignment[]
  ): void {
    this.activeCompanyId.set(companyId);

    if (companyId) {
      this.storeCompanyId(companyId);
      const assignment = assignments.find((a) => a.company_id === companyId);
      const roles = assignment?.roles ?? [];

      // Fallback jika user adalah owner sistem di metadata
      const user = this.authService.currentUser();
      const metaRole = (user?.app_metadata?.['role'] || user?.user_metadata?.['role']) as string | undefined;
      if (metaRole === 'owner' && !roles.includes('owner')) {
        roles.push('owner');
      }

      this.userRoles.set(roles);
    } else {
      this.clearStoredCompanyId();
      this.userRoles.set([]);
    }
  }

  private getStoredCompanyId(): string | null {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(STORAGE_KEY);
      }
    } catch (e) {
      console.warn('Gagal membaca company ID dari localStorage:', e);
    }
    return null;
  }

  private storeCompanyId(companyId: string): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, companyId);
      }
    } catch (e) {
      console.warn('Gagal menyimpan company ID ke localStorage:', e);
    }
  }

  private clearStoredCompanyId(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch (e) {
      console.warn('Gagal menghapus company ID dari localStorage:', e);
    }
  }
}
