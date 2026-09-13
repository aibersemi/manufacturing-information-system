import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../core/services/auth.service';
import { CompanyService, Company } from '../../core/services/company.service';
import { DashboardLayoutComponent } from './dashboard-layout.component';

describe('DashboardLayoutComponent', () => {
  let component: DashboardLayoutComponent;
  let fixture: ComponentFixture<DashboardLayoutComponent>;
  let mockAuthService: {
    currentUser: ReturnType<typeof signal>;
    signOut: ReturnType<typeof vi.fn>;
  };
  let mockCompanyService: {
    availableCompanies: ReturnType<typeof signal<Company[]>>;
    activeCompanyId: ReturnType<typeof signal<string | null>>;
    activeCompany: ReturnType<typeof signal<Company | null>>;
    userRoles: ReturnType<typeof signal<string[]>>;
    isOwner: ReturnType<typeof signal<boolean>>;
    isLoading: ReturnType<typeof signal<boolean>>;
    setActiveCompany: ReturnType<typeof vi.fn>;
  };
  let router: Router;

  const mockCompany: Company = {
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
  };

  beforeEach(async () => {
    mockAuthService = {
      currentUser: signal({
        id: 'u-1',
        email: 'e2e_playwright@example.com',
        app_metadata: { role: 'head' },
        user_metadata: { role: 'head' },
      } as unknown),
      signOut: vi.fn().mockResolvedValue(undefined),
    };

    mockCompanyService = {
      availableCompanies: signal<Company[]>([mockCompany]),
      activeCompanyId: signal<string | null>('c-1'),
      activeCompany: signal<Company | null>(mockCompany),
      userRoles: signal<string[]>(['head']),
      isOwner: signal<boolean>(false),
      isLoading: signal<boolean>(false),
      setActiveCompany: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [DashboardLayoutComponent],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: CompanyService, useValue: mockCompanyService },
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardLayoutComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('should create the dashboard layout component', () => {
    expect(component).toBeTruthy();
  });

  it('should compute user properties accurately', () => {
    expect(component.userEmail()).toBe('e2e_playwright@example.com');
    expect(component.userRole()).toBe('head');
    expect(component.userRoleLabel()).toBe('Head of Operations');
    expect(component.userInitials()).toBe('E2');
  });

  it('should reflect active company name from CompanyService', () => {
    expect(component.activeCompany()).toBe('PT Aiber Semikonduktor Indonesia');
    expect(component.availableCompanies().length).toBe(1);
  });

  it('should call CompanyService when selectCompany is invoked', () => {
    component.selectCompany(mockCompany);
    expect(mockCompanyService.setActiveCompany).toHaveBeenCalledWith('c-1');
  });

  it('should toggle mobile menu signal', () => {
    expect(component.isMobileMenuOpen()).toBe(false);
    component.toggleMobileMenu();
    expect(component.isMobileMenuOpen()).toBe(true);
    component.closeMobileMenu();
    expect(component.isMobileMenuOpen()).toBe(false);
  });

  it('should handle logout flow', async () => {
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    await component.logout();

    expect(mockAuthService.signOut).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith('/login');
  });
});
