import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../core/services/auth.service';
import { CompanyService, Company } from '../../core/services/company.service';
import {
  DashboardLayoutComponent,
  STORAGE_KEY_SIDEBAR_COLLAPSED,
  STORAGE_KEY_NAV_GROUPS,
  DEFAULT_NAV_GROUPS,
} from './dashboard-layout.component';

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
    localStorage.clear();

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

  it('should toggle desktop sidebar and persist state to localStorage', () => {
    // Pastikan window.innerWidth desktop
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
    expect(component.isSidebarCollapsed()).toBe(false);

    component.toggleSidebar();
    expect(component.isSidebarCollapsed()).toBe(true);
    fixture.detectChanges();
    expect(localStorage.getItem(STORAGE_KEY_SIDEBAR_COLLAPSED)).toBe('true');

    component.toggleSidebar();
    expect(component.isSidebarCollapsed()).toBe(false);
    fixture.detectChanges();
    expect(localStorage.getItem(STORAGE_KEY_SIDEBAR_COLLAPSED)).toBe('false');
  });

  it('should restore stored sidebar state and nav groups from localStorage upon initialization', () => {
    localStorage.setItem(STORAGE_KEY_SIDEBAR_COLLAPSED, 'true');
    localStorage.setItem(
      STORAGE_KEY_NAV_GROUPS,
      JSON.stringify({ masterData: false, settings: true })
    );

    const newFixture = TestBed.createComponent(DashboardLayoutComponent);
    const newComponent = newFixture.componentInstance;
    newFixture.detectChanges();

    expect(newComponent.isSidebarCollapsed()).toBe(true);
    expect(newComponent.isGroupOpen('masterData')).toBe(false);
    expect(newComponent.isGroupOpen('settings')).toBe(true);
    // Grup lain tetap mempertahankan default
    expect(newComponent.isGroupOpen('purchasing')).toBe(DEFAULT_NAV_GROUPS['purchasing']);
  });

  it('should toggle nav group and persist updated state to localStorage', () => {
    expect(component.isGroupOpen('finance')).toBe(true);

    component.toggleGroup('finance');
    expect(component.isGroupOpen('finance')).toBe(false);
    fixture.detectChanges();

    const storedJson = localStorage.getItem(STORAGE_KEY_NAV_GROUPS);
    expect(storedJson).toBeTruthy();
    const stored = JSON.parse(storedJson!);
    expect(stored.finance).toBe(false);

    component.toggleGroup('finance');
    expect(component.isGroupOpen('finance')).toBe(true);
    fixture.detectChanges();
    const updated = JSON.parse(localStorage.getItem(STORAGE_KEY_NAV_GROUPS)!);
    expect(updated.finance).toBe(true);
  });

  it('should handle corrupt localStorage data gracefully', () => {
    localStorage.setItem(STORAGE_KEY_NAV_GROUPS, '{ corrupt json');

    const newFixture = TestBed.createComponent(DashboardLayoutComponent);
    const newComponent = newFixture.componentInstance;
    newFixture.detectChanges();

    expect(newComponent.isGroupOpen('masterData')).toBe(true);
  });

  it('should have DEFAULT_NAV_GROUPS configured with 8 business groups and backward-compatibility keys', () => {
    expect(DEFAULT_NAV_GROUPS).toEqual({
      masterData: true,
      purchasing: true,
      sales: true,
      kepalaKonveksi: true,
      operator: true,
      stok: true,
      finance: true,
      settings: false,
      assets: true,
      reports: true,
      operations: true,
      inventory: true,
    });
  });

  it('should toggle new business groups (kepalaKonveksi, operator, stok)', () => {
    expect(component.isGroupOpen('kepalaKonveksi')).toBe(true);
    component.toggleGroup('kepalaKonveksi');
    expect(component.isGroupOpen('kepalaKonveksi')).toBe(false);

    expect(component.isGroupOpen('operator')).toBe(true);
    component.toggleGroup('operator');
    expect(component.isGroupOpen('operator')).toBe(false);

    expect(component.isGroupOpen('stok')).toBe(true);
    component.toggleGroup('stok');
    expect(component.isGroupOpen('stok')).toBe(false);
  });

  it('should render links for all 8 business groups in template when expanded', () => {
    component.openNavGroups.set({
      masterData: true,
      purchasing: true,
      sales: true,
      kepalaKonveksi: true,
      operator: true,
      stok: true,
      finance: true,
      settings: true,
    });
    component.isSidebarCollapsed.set(false);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const links = compiled.querySelectorAll('nav a');
    expect(links.length).toBeGreaterThan(0);

    // Check key labels in template
    const text = compiled.textContent || '';
    expect(text).toContain('Master Data');
    expect(text).toContain('Pembelian');
    expect(text).toContain('Penjualan');
    expect(text).toContain('Kepala Konveksi');
    expect(text).toContain('Operator');
    expect(text).toContain('Stok');
    expect(text).toContain('Keuangan');
    expect(text).toContain('Pengaturan');

    // Check specific links for new groups
    expect(text).toContain('SPK Potong');
    expect(text).toContain('SPK Jahit');
    expect(text).toContain('Progress SPK');
    expect(text).toContain('Perintah Produksi');
    expect(text).toContain('Kasus Perbaikan');

    expect(text).toContain('Catat Potongan');
    expect(text).toContain('Catat Sablon');
    expect(text).toContain('Catat Jahit');
    expect(text).toContain('Catat Packing');

    expect(text).toContain('Stok Bahan');
    expect(text).toContain('Stok Masuk');
    expect(text).toContain('Stok Keluar');
    expect(text).toContain('Stok Produksi');
    expect(text).toContain('Stok Produk Jadi');

    expect(text).toContain('Konveksi (Multi Tenant)');
    expect(text).toContain('Pengguna & Akses');
    expect(text).toContain('Profil Pengguna');
  });

  it('should handle logout flow', async () => {
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    await component.logout();

    expect(mockAuthService.signOut).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith('/login');
  });
});

