import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import { CompanyService, Company, UserCompanyAssignment } from './company.service';
import { SupabaseService } from './supabase.service';

describe('CompanyService', () => {
  let service: CompanyService;
  let mockCurrentUser: ReturnType<typeof signal>;
  let mockSupabaseClient: {
    from: ReturnType<typeof vi.fn>;
  };

  const mockCompanies: Company[] = [
    {
      id: 'c-1',
      code: 'AIBER001',
      name: 'PT Aiber Semikonduktor Indonesia',
      address: null,
      phone: null,
      email: null,
      logo_storage_key: null,
      is_active: true,
      code_locked: true,
      version: 1,
      created_at: '2026-09-13T00:00:00Z',
      updated_at: '2026-09-13T00:00:00Z',
    },
    {
      id: 'c-2',
      code: 'WAFER002',
      name: 'Fabrikasi Wafer Line B',
      address: null,
      phone: null,
      email: null,
      logo_storage_key: null,
      is_active: true,
      code_locked: false,
      version: 1,
      created_at: '2026-09-13T00:00:00Z',
      updated_at: '2026-09-13T00:00:00Z',
    },
  ];

  const mockAssignments: UserCompanyAssignment[] = [
    {
      company_id: 'c-1',
      user_id: 'u-1',
      roles: ['owner'],
      is_active: true,
      version: 1,
      created_at: '2026-09-13T00:00:00Z',
      updated_at: '2026-09-13T00:00:00Z',
    },
    {
      company_id: 'c-2',
      user_id: 'u-1',
      roles: ['head'],
      is_active: true,
      version: 1,
      created_at: '2026-09-13T00:00:00Z',
      updated_at: '2026-09-13T00:00:00Z',
    },
  ];

  beforeEach(() => {
    localStorage.clear();

    mockCurrentUser = signal({
      id: 'u-1',
      email: 'supergadangzzz@example.com',
      app_metadata: { role: 'owner' },
      user_metadata: { role: 'owner' },
    } as unknown);

    mockSupabaseClient = {
      from: vi.fn((table: string) => {
        if (table === 'user_company_assignment') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: mockAssignments, error: null }),
              }),
            }),
          };
        }
        if (table === 'company') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: mockCompanies, error: null }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        CompanyService,
        {
          provide: AuthService,
          useValue: { currentUser: mockCurrentUser },
        },
        {
          provide: SupabaseService,
          useValue: { client: mockSupabaseClient },
        },
      ],
    });

    service = TestBed.inject(CompanyService);
  });

  it('should create the CompanyService', () => {
    expect(service).toBeTruthy();
  });

  it('should load user companies and set active company default', async () => {
    await service.loadUserCompanies();

    expect(service.availableCompanies().length).toBe(2);
    expect(service.activeCompanyId()).toBe('c-1');
    expect(service.activeCompany()?.code).toBe('AIBER001');
    expect(service.isOwner()).toBe(true);
  });

  it('should switch active company and persist to localStorage', async () => {
    await service.loadUserCompanies();

    service.setActiveCompany('c-2');

    expect(service.activeCompanyId()).toBe('c-2');
    expect(service.activeCompany()?.name).toBe('Fabrikasi Wafer Line B');
    expect(localStorage.getItem('mis_active_company_id')).toBe('c-2');
  });

  it('should ignore invalid company ID when setting active company', async () => {
    await service.loadUserCompanies();

    service.setActiveCompany('c-non-existent');

    expect(service.activeCompanyId()).toBe('c-1');
  });

  it('should restore stored company ID from localStorage', async () => {
    localStorage.setItem('mis_active_company_id', 'c-2');

    await service.loadUserCompanies();

    expect(service.activeCompanyId()).toBe('c-2');
    expect(service.activeCompany()?.code).toBe('WAFER002');
  });
});
