import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { User } from '@supabase/supabase-js';
import { AuthService } from './auth.service';
import { CompanyService } from './company.service';
import { SettingsService } from './settings.service';
import { SupabaseService } from './supabase.service';

describe('SettingsService', () => {
  let service: SettingsService;
  let mockSupabase: any;
  let mockAuthService: any;
  let mockCompanyService: any;

  const mockUser: User = {
    id: 'user-owner-123',
    app_metadata: {},
    user_metadata: {
      full_name: 'Budi Santoso',
      phone: '08123456789',
      address: 'Jl. Industri No. 1',
      bank_account: '1234567890',
      bank_account_name: 'Budi Santoso',
    },
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00Z',
    email: 'budi@mis.mrmads.net',
  };

  beforeEach(() => {
    mockSupabase = {
      client: {
        from: vi.fn(),
        rpc: vi.fn(),
        auth: {
          updateUser: vi.fn(),
          signInWithPassword: vi.fn(),
        },
      },
    };

    mockAuthService = {
      currentUser: vi.fn().mockReturnValue(mockUser),
      session: signal({ user: mockUser }),
    };

    mockCompanyService = {
      activeCompanyId: vi.fn().mockReturnValue('comp-1'),
      isOwner: vi.fn().mockReturnValue(true),
      userRoles: vi.fn().mockReturnValue(['owner']),
      loadUserCompanies: vi.fn().mockResolvedValue(undefined),
    };

    TestBed.configureTestingModule({
      providers: [
        SettingsService,
        { provide: SupabaseService, useValue: mockSupabase },
        { provide: AuthService, useValue: mockAuthService },
        { provide: CompanyService, useValue: mockCompanyService },
      ],
    });

    service = TestBed.inject(SettingsService);
  });

  describe('createCompany', () => {
    it('should reject invalid company code with spaces or lowercase characters', async () => {
      await expect(service.createCompany({ code: 'aiber 001', name: 'PT Aiber' })).rejects.toThrow(
        'Kode perusahaan hanya boleh berupa huruf kapital dan angka tanpa spasi.',
      );
    });

    it('should reject empty company name', async () => {
      await expect(service.createCompany({ code: 'AIBER002', name: '' })).rejects.toThrow(
        'Nama perusahaan wajib diisi.',
      );
    });

    it('should insert new company and call bootstrap_company_data RPC', async () => {
      const createdCompany = {
        id: 'new-comp-uuid',
        code: 'AIBER002',
        name: 'PT Semikonduktor Maju',
        is_active: true,
        version: 1,
      };

      const mockQueryBuilder = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: createdCompany, error: null }),
      };

      mockSupabase.client.from.mockImplementation((table: string) => {
        if (table === 'company') return mockQueryBuilder;
        if (table === 'audit_log') return { insert: vi.fn().mockResolvedValue({ error: null }) };
        return {};
      });

      mockSupabase.client.rpc.mockResolvedValue({ error: null });

      const res = await service.createCompany({ code: 'aiber002', name: 'PT Semikonduktor Maju' });

      expect(res.code).toBe('AIBER002');
      expect(mockSupabase.client.rpc).toHaveBeenCalledWith('bootstrap_company_data', {
        p_company_id: 'new-comp-uuid',
        p_creator_user_id: 'user-owner-123',
      });
      expect(mockCompanyService.loadUserCompanies).toHaveBeenCalled();
    });
  });

  describe('updateCompany', () => {
    it('should prevent deactivating active company currently in use', async () => {
      mockCompanyService.activeCompanyId.mockReturnValue('comp-1');

      await expect(
        service.updateCompany('comp-1', { name: 'PT Aiber Aktif', isActive: false }),
      ).rejects.toThrow(
        'Tidak dapat menonaktifkan perusahaan yang sedang aktif digunakan. Pindahkan pilihan perusahaan aktif terlebih dahulu.',
      );
    });

    it('should increment version when updating company', async () => {
      const existing = { id: 'comp-2', name: 'PT Lama', is_active: true, version: 3 };
      const updated = { id: 'comp-2', name: 'PT Baru', is_active: true, version: 4 };

      mockSupabase.client.from.mockImplementation((table: string) => {
        if (table === 'company') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: existing, error: null }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({ data: updated, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'audit_log') return { insert: vi.fn().mockResolvedValue({ error: null }) };
        return {};
      });

      const res = await service.updateCompany('comp-2', { name: 'PT Baru' });
      expect(res.version).toBe(4);
    });
  });

  describe('assignUserRole', () => {
    it('should reject combining owner role with operational roles', async () => {
      await expect(
        service.assignUserRole('comp-1', 'user-2', ['owner', 'operator_potong']),
      ).rejects.toThrow('Peran Owner dan Finance bersifat eksklusif dan tidak dapat digabung dengan peran lain.');
    });

    it('should prevent user from deactivating own assignment', async () => {
      await expect(
        service.assignUserRole('comp-1', 'user-owner-123', ['owner'], false),
      ).rejects.toThrow('Anda tidak dapat menonaktifkan akun Anda sendiri.');
    });

    it('should prevent user from removing own owner role', async () => {
      await expect(
        service.assignUserRole('comp-1', 'user-owner-123', ['kepala_konveksi'], true),
      ).rejects.toThrow('Anda tidak dapat melepas peran Owner dari akun Anda sendiri.');
    });
  });

  describe('Profile & Password', () => {
    it('should return parsed current user profile data', () => {
      const profile = service.getCurrentUserProfile();
      expect(profile.fullName).toBe('Budi Santoso');
      expect(profile.phone).toBe('08123456789');
      expect(profile.bankAccount).toBe('1234567890');
    });

    it('should reject password change with length less than 8 characters', async () => {
      await expect(service.changePassword('old-password', '12345')).rejects.toThrow(
        'Kata sandi baru minimal harus 8 karakter.',
      );
    });

    it('should verify old password before updating password', async () => {
      mockSupabase.client.auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login' } });

      await expect(service.changePassword('wrong-password', 'new-valid-password-123')).rejects.toThrow(
        'Kata sandi saat ini yang Anda masukkan salah.',
      );
    });
  });
});
