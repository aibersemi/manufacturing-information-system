import { inject, Injectable } from '@angular/core';
import { Json, Tables, TablesUpdate } from '../../../types/database.types';
import { AuthService } from './auth.service';
import { CompanyService } from './company.service';
import { SupabaseService } from './supabase.service';

export type Company = Tables<'company'>;
export type UserCompanyAssignment = Tables<'user_company_assignment'>;
export type AccessPermission = Tables<'access_permission'>;
export type AuditLog = Tables<'audit_log'>;

export interface CompanyWithStats extends Company {
  assigned_users_count?: number;
}

export interface CreateCompanyPayload {
  code: string;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
}

export interface UpdateCompanyPayload {
  name: string;
  code?: string;
  address?: string;
  phone?: string;
  email?: string;
  isActive?: boolean;
  version?: number;
}

export interface CompanyUserWithProfile {
  company_id: string;
  user_id: string;
  email: string;
  full_name: string;
  username: string;
  roles: string[];
  is_active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface SystemUserOption {
  user_id: string;
  email: string;
  full_name: string;
  username: string;
}

export interface UserProfileData {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  address: string;
  bankAccount: string;
  bankAccountName: string;
  role: string;
}

export const VALID_ROLES = [
  { id: 'owner', label: 'Owner / Direksi', isExclusive: true },
  { id: 'finance', label: 'Finance & Akuntansi', isExclusive: true },
  { id: 'kepala_konveksi', label: 'Kepala Pabrik / Konveksi', isExclusive: false },
  { id: 'operator_potong', label: 'Operator Potong', isExclusive: false },
  { id: 'operator_sablon', label: 'Operator Sablon', isExclusive: false },
  { id: 'operator_jahit', label: 'Operator Jahit', isExclusive: false },
  { id: 'operator_packing', label: 'Operator Packing', isExclusive: false },
] as const;

@Injectable({
  providedIn: 'root',
})
export class SettingsService {
  private readonly supabase = inject(SupabaseService);
  private readonly authService = inject(AuthService);
  private readonly companyService = inject(CompanyService);

  // ============================================================================
  // 1. MANAJEMEN PERUSAHAAN (COMPANIES)
  // ============================================================================

  /**
   * Mengambil daftar seluruh perusahaan terdaftar beserta statistik jumlah personil aktif
   */
  async getCompanies(): Promise<CompanyWithStats[]> {
    // 1. Coba panggil RPC get_companies_with_stats
    const { data: rpcData, error: rpcError } = await this.supabase.client.rpc(
      'get_companies_with_stats',
    );

    if (!rpcError && rpcData) {
      return (rpcData as CompanyWithStats[]).map((c) => ({
        ...c,
        assigned_users_count: Number(c.assigned_users_count || 0),
      }));
    }

    // 2. Fallback query standar jika RPC belum siap
    const { data, error } = await this.supabase.client
      .from('company')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      throw new Error(`Gagal memuat daftar perusahaan: ${error.message}`);
    }

    return (data ?? []) as CompanyWithStats[];
  }

  /**
   * Mendaftarkan perusahaan baru, menginisialisasi skema bootstrap secara atomik, dan mencatat audit log
   */
  async createCompany(data: CreateCompanyPayload): Promise<Company> {
    const rawCode = (data.code || '').trim().toUpperCase();
    const rawName = (data.name || '').trim();
    const rawAddress = (data.address || '').trim();
    const rawPhone = (data.phone || '').trim();
    const rawEmail = (data.email || '').trim();

    if (!rawCode) {
      throw new Error('Kode perusahaan wajib diisi.');
    }

    if (!/^[A-Z0-9_-]+$/.test(rawCode)) {
      throw new Error('Kode perusahaan hanya boleh berupa huruf kapital dan angka tanpa spasi.');
    }

    if (rawCode.length < 2 || rawCode.length > 20) {
      throw new Error('Kode perusahaan harus terdiri dari 2 hingga 20 karakter.');
    }

    if (!rawName) {
      throw new Error('Nama perusahaan wajib diisi.');
    }

    const currentUser = this.authService.currentUser();
    if (!currentUser) {
      throw new Error('Sesi pengguna tidak valid.');
    }

    // 1. Panggil stored procedure create_company_with_bootstrap untuk atomic transaction
    const { data: createdCompany, error: rpcError } = await this.supabase.client.rpc(
      'create_company_with_bootstrap',
      {
        p_code: rawCode,
        p_name: rawName,
        p_address: rawAddress || undefined,
        p_phone: rawPhone || undefined,
        p_email: rawEmail || undefined,
      },
    );

    if (rpcError) {
      if (rpcError.code === '23505') {
        throw new Error('Kode atau nama perusahaan sudah digunakan.');
      }
      throw new Error(`Gagal membuat perusahaan: ${rpcError.message}`);
    }

    const companyRecord = createdCompany as Company;

    // 2. Muat ulang daftar perusahaan aktif di CompanyService
    await this.companyService.loadUserCompanies();

    return companyRecord;
  }

  /**
   * Memperbarui informasi identitas perusahaan (nama, alamat, telepon, email, kode, dan status aktif)
   */
  async updateCompany(
    id: string,
    data: UpdateCompanyPayload,
  ): Promise<Company> {
    const rawName = (data.name || '').trim();
    if (!rawName) {
      throw new Error('Nama perusahaan tidak boleh kosong.');
    }

    // Cegah penonaktifan perusahaan yang sedang aktif digunakan
    if (this.companyService.activeCompanyId() === id && data.isActive === false) {
      throw new Error(
        'Tidak dapat menonaktifkan perusahaan yang sedang aktif digunakan. Pindahkan pilihan perusahaan aktif terlebih dahulu.',
      );
    }

    // 1. Coba pembaruan via RPC update_company_details
    const { data: rpcData, error: rpcError } = await this.supabase.client.rpc(
      'update_company_details',
      {
        p_company_id: id,
        p_name: rawName,
        p_code: data.code ? data.code.trim().toUpperCase() : undefined,
        p_address: data.address ? data.address.trim() : undefined,
        p_phone: data.phone ? data.phone.trim() : undefined,
        p_email: data.email ? data.email.trim() : undefined,
        p_is_active: typeof data.isActive === 'boolean' ? data.isActive : undefined,
        p_expected_version: data.version ?? undefined,
      },
    );

    if (!rpcError && rpcData) {
      await this.companyService.loadUserCompanies();
      return rpcData as Company;
    }

    // 2. Fallback query standar jika RPC belum terdaftar
    const { data: existing, error: findError } = await this.supabase.client
      .from('company')
      .select('*')
      .eq('id', id)
      .single();

    if (findError || !existing) {
      throw new Error('Perusahaan tidak ditemukan.');
    }

    const updatePayload: TablesUpdate<'company'> = {
      name: rawName,
      version: existing.version + 1,
    };

    if (data.code && !existing.code_locked) {
      updatePayload.code = data.code.trim().toUpperCase();
    }

    if (data.address !== undefined) {
      updatePayload.address = data.address.trim() || null;
    }

    if (data.phone !== undefined) {
      updatePayload.phone = data.phone.trim() || null;
    }

    if (data.email !== undefined) {
      updatePayload.email = data.email.trim() || null;
    }

    if (typeof data.isActive === 'boolean') {
      updatePayload.is_active = data.isActive;
    }

    const { data: updated, error: updateError } = await this.supabase.client
      .from('company')
      .update(updatePayload)
      .eq('id', id)
      .eq('version', existing.version)
      .select('*')
      .single();

    if (updateError) {
      if (updateError.code === '23505') {
        throw new Error('Nama atau kode perusahaan sudah digunakan oleh entitas lain.');
      }
      throw new Error(`Gagal memperbarui perusahaan: ${updateError.message}`);
    }

    const updatedRecord = updated as Company;

    // Catat audit log
    await this.logAudit({
      companyId: id,
      action: 'company.update',
      targetType: 'company',
      targetId: id,
      details: { name: rawName, isActive: data.isActive },
      before: existing,
      after: updatedRecord,
    });

    // Refresh daftar perusahaan aktif di state
    await this.companyService.loadUserCompanies();

    return updatedRecord;
  }

  // ============================================================================
  // 2. MANAJEMEN PENGGUNA & PENUGASAN AKSES (USERS & ACCESS)
  // ============================================================================

  /**
   * Mengambil daftar penugasan pengguna pada perusahaan tertentu beserta profil
   */
  async getCompanyUsers(companyId: string): Promise<CompanyUserWithProfile[]> {
    const { data, error } = await this.supabase.client.rpc(
      'get_company_users_with_profiles',
      { p_company_id: companyId },
    );

    if (error) {
      // Fallback query langsung dari tabel user_company_assignment jika RPC belum tersedia
      const { data: fallbackData, error: fallbackError } = await this.supabase.client
        .from('user_company_assignment')
        .select('*')
        .eq('company_id', companyId);

      if (fallbackError) {
        throw new Error(`Gagal memuat pengguna perusahaan: ${fallbackError.message}`);
      }

      return (fallbackData || []).map((item) => ({
        company_id: item.company_id,
        user_id: item.user_id,
        email: item.user_id,
        full_name: 'Pengguna Sistem',
        username: item.user_id.slice(0, 8),
        roles: item.roles,
        is_active: item.is_active,
        version: item.version,
        created_at: item.created_at,
        updated_at: item.updated_at,
      }));
    }

    return (data || []) as CompanyUserWithProfile[];
  }

  /**
   * Mengambil daftar seluruh pengguna sistem yang tersedia untuk ditugaskan
   */
  async listAvailableSystemUsers(): Promise<SystemUserOption[]> {
    const { data, error } = await this.supabase.client.rpc('list_available_system_users');
    if (error) {
      console.warn('Gagal memanggil list_available_system_users:', error.message);
      return [];
    }
    return (data || []) as SystemUserOption[];
  }

  /**
   * Menugaskan atau memperbarui peran pengguna pada perusahaan aktif
   */
  async assignUserRole(
    companyId: string,
    userId: string,
    roles: string[],
    isActive = true,
  ): Promise<UserCompanyAssignment> {
    const uniqueRoles = Array.from(new Set(roles));

    if (uniqueRoles.length === 0) {
      throw new Error('Minimal satu peran wajib dipilih untuk pengguna.');
    }

    // Validasi aturan bisnis peran eksklusif
    const hasOwner = uniqueRoles.includes('owner');
    const hasFinance = uniqueRoles.includes('finance');

    if ((hasOwner || hasFinance) && uniqueRoles.length > 1) {
      throw new Error('Peran Owner dan Finance bersifat eksklusif dan tidak dapat digabung dengan peran lain.');
    }

    // Proteksi invariant: pengguna yang sedang login tidak dapat melepas peran owner sendiri atau menonaktifkan akun sendiri
    const currentUserId = this.authService.currentUser()?.id;
    if (currentUserId === userId) {
      if (!isActive) {
        throw new Error('Anda tidak dapat menonaktifkan akun Anda sendiri.');
      }
      if (!uniqueRoles.includes('owner') && this.companyService.isOwner()) {
        throw new Error('Anda tidak dapat melepas peran Owner dari akun Anda sendiri.');
      }
    }

    // Periksa assignment yang ada
    const { data: existing } = await this.supabase.client
      .from('user_company_assignment')
      .select('*')
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .maybeSingle();

    const payload = {
      company_id: companyId,
      user_id: userId,
      roles: uniqueRoles,
      is_active: isActive,
      version: existing ? existing.version + 1 : 1,
      updated_at: new Date().toISOString(),
    };

    const { data: saved, error: upsertError } = await this.supabase.client
      .from('user_company_assignment')
      .upsert(payload)
      .select('*')
      .single();

    if (upsertError) {
      throw new Error(`Gagal menyimpan penugasan pengguna: ${upsertError.message}`);
    }

    const savedRecord = saved as UserCompanyAssignment;

    // Catat audit log
    await this.logAudit({
      companyId,
      action: 'access.assignment.update',
      targetType: 'user_company_assignment',
      targetId: `${companyId}:${userId}`,
      details: { roles: uniqueRoles, isActive },
      before: existing,
      after: savedRecord,
    });

    return savedRecord;
  }

  /**
   * Mengambil matriks izin akses dari tabel access_permission
   */
  async getUserPermissions(companyId: string, role?: string): Promise<AccessPermission[]> {
    let query = this.supabase.client
      .from('access_permission')
      .select('*')
      .eq('company_id', companyId);

    if (role) {
      query = query.eq('role', role);
    }

    const { data, error } = await query.order('menu_key', { ascending: true });
    if (error) {
      throw new Error(`Gagal memuat matriks izin: ${error.message}`);
    }

    return (data || []) as AccessPermission[];
  }

  /**
   * Memperbarui izin granular pada access_permission
   */
  async updatePermission(
    companyId: string,
    role: string,
    menuKey: string,
    permissions: {
      canView?: boolean;
      canCreate?: boolean;
      canEdit?: boolean;
      canDelete?: boolean;
      canPost?: boolean;
      canVoid?: boolean;
    },
  ): Promise<AccessPermission> {
    const { data: existing, error: findError } = await this.supabase.client
      .from('access_permission')
      .select('*')
      .eq('company_id', companyId)
      .eq('role', role)
      .eq('menu_key', menuKey)
      .single();

    if (findError || !existing) {
      throw new Error('Entri izin akses tidak ditemukan.');
    }

    const updatePayload: TablesUpdate<'access_permission'> = {
      version: existing.version + 1,
      updated_by_user_id: this.authService.currentUser()?.id,
      updated_at: new Date().toISOString(),
    };

    if (permissions.canView !== undefined) updatePayload.can_view = permissions.canView;
    if (permissions.canCreate !== undefined) updatePayload.can_create = permissions.canCreate;
    if (permissions.canEdit !== undefined) updatePayload.can_edit = permissions.canEdit;
    if (permissions.canDelete !== undefined) updatePayload.can_delete = permissions.canDelete;
    if (permissions.canPost !== undefined) updatePayload.can_post = permissions.canPost;
    if (permissions.canVoid !== undefined) updatePayload.can_void = permissions.canVoid;

    const { data: updated, error: updateError } = await this.supabase.client
      .from('access_permission')
      .update(updatePayload)
      .eq('company_id', companyId)
      .eq('role', role)
      .eq('menu_key', menuKey)
      .select('*')
      .single();

    if (updateError) {
      throw new Error(`Gagal memperbarui izin: ${updateError.message}`);
    }

    const updatedRecord = updated as AccessPermission;

    await this.logAudit({
      companyId,
      action: 'access.permission.update',
      targetType: 'access_permission',
      targetId: `${companyId}:${role}:${menuKey}`,
      details: permissions,
      before: existing,
      after: updatedRecord,
    });

    return updatedRecord;
  }

  // ============================================================================
  // 3. PROFIL PENGGUNA & KATA SANDI (USER PROFILE & SECURITY)
  // ============================================================================

  /**
   * Mengambil data profil pengguna yang sedang login
   */
  getCurrentUserProfile(): UserProfileData {
    const user = this.authService.currentUser();
    if (!user) {
      throw new Error('Pengguna belum masuk ke sistem.');
    }

    const meta = (user.user_metadata || {}) as Record<string, unknown>;
    const email = user.email || '';

    return {
      id: user.id,
      email,
      fullName:
        (meta['full_name'] as string) ||
        (meta['name'] as string) ||
        (meta['username'] as string) ||
        email.split('@')[0],
      phone: (meta['phone'] as string) || '',
      address: (meta['address'] as string) || '',
      bankAccount: (meta['bank_account'] as string) || (meta['bank_account_number'] as string) || '',
      bankAccountName: (meta['bank_account_name'] as string) || (meta['bank_account_holder'] as string) || '',
      role: this.companyService.userRoles()[0] || (meta['role'] as string) || 'operator',
    };
  }

  /**
   * Memperbarui metadata profil pengguna saat ini
   */
  async updateProfile(data: {
    fullName?: string;
    phone?: string;
    address?: string;
    bankAccount?: string;
    bankAccountName?: string;
  }): Promise<UserProfileData> {
    const user = this.authService.currentUser();
    if (!user) {
      throw new Error('Sesi pengguna tidak valid.');
    }

    const existingMeta = (user.user_metadata || {}) as Record<string, unknown>;

    const updatedMeta: Record<string, unknown> = {
      ...existingMeta,
    };

    if (data.fullName !== undefined) {
      updatedMeta['full_name'] = data.fullName.trim();
      updatedMeta['name'] = data.fullName.trim();
    }
    if (data.phone !== undefined) {
      updatedMeta['phone'] = data.phone.trim();
    }
    if (data.address !== undefined) {
      updatedMeta['address'] = data.address.trim();
    }
    if (data.bankAccount !== undefined) {
      updatedMeta['bank_account'] = data.bankAccount.trim();
      updatedMeta['bank_account_number'] = data.bankAccount.trim();
    }
    if (data.bankAccountName !== undefined) {
      updatedMeta['bank_account_name'] = data.bankAccountName.trim();
      updatedMeta['bank_account_holder'] = data.bankAccountName.trim();
    }

    const { data: authRes, error: updateError } = await this.supabase.client.auth.updateUser({
      data: updatedMeta,
    });

    if (updateError) {
      throw new Error(`Gagal memperbarui profil pengguna: ${updateError.message}`);
    }

    if (authRes.user) {
      this.authService.session.update((s) => (s ? { ...s, user: authRes.user } : null));
    }

    // Catat audit log profil update
    await this.logAudit({
      action: 'user.profile_update',
      targetType: 'user',
      targetId: user.id,
      details: { fields: Object.keys(data) },
      before: existingMeta,
      after: updatedMeta,
    });

    return this.getCurrentUserProfile();
  }

  /**
   * Mengubah kata sandi pengguna dengan memverifikasi kata sandi lama terlebih dahulu
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    if (!currentPassword) {
      throw new Error('Kata sandi saat ini wajib diisi.');
    }

    if (!newPassword || newPassword.length < 8) {
      throw new Error('Kata sandi baru minimal harus 8 karakter.');
    }

    const user = this.authService.currentUser();
    if (!user || !user.email) {
      throw new Error('Sesi pengguna tidak valid.');
    }

    // 1. Verifikasi kredensial saat ini
    const { error: verifyError } = await this.supabase.client.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });

    if (verifyError) {
      throw new Error('Kata sandi saat ini yang Anda masukkan salah.');
    }

    // 2. Perbarui ke kata sandi baru
    const { error: updateError } = await this.supabase.client.auth.updateUser({
      password: newPassword,
    });

    if (updateError) {
      throw new Error(`Gagal mengubah kata sandi: ${updateError.message}`);
    }

    // 3. Catat audit log
    await this.logAudit({
      action: 'user.password_change',
      targetType: 'user',
      targetId: user.id,
      details: { result: 'success' },
    });
  }

  // ============================================================================
  // HELPER AUDIT LOG
  // ============================================================================

  private async logAudit(params: {
    companyId?: string | null;
    action: string;
    targetType: string;
    targetId: string;
    details?: Record<string, unknown>;
    before?: unknown;
    after?: unknown;
  }): Promise<void> {
    try {
      const actorUserId = this.authService.currentUser()?.id;
      const compId = params.companyId ?? this.companyService.activeCompanyId();
      if (!compId) return;

      await this.supabase.client.from('audit_log').insert({
        company_id: compId,
        actor_user_id: actorUserId,
        action: params.action,
        target_type: params.targetType,
        target_id: params.targetId,
        result: 'success',
        details: (params.details ?? {}) as Json,
        before: params.before ? (params.before as Json) : null,
        after: params.after ? (params.after as Json) : null,
      });
    } catch (err) {
      console.warn('Peringatan: Gagal mencatat log audit:', err);
    }
  }
}
