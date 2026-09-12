import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../core/services/auth.service';
import { DashboardLayoutComponent } from './dashboard-layout.component';

describe('DashboardLayoutComponent', () => {
  let component: DashboardLayoutComponent;
  let fixture: ComponentFixture<DashboardLayoutComponent>;
  let mockAuthService: {
    currentUser: ReturnType<typeof signal>;
    signOut: ReturnType<typeof vi.fn>;
  };
  let router: Router;

  beforeEach(async () => {
    mockAuthService = {
      currentUser: signal({
        id: 'u-1',
        email: 'e2e_playwright@mis.mrmads.net',
        app_metadata: { role: 'head' },
        user_metadata: { role: 'head' },
      } as any),
      signOut: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [DashboardLayoutComponent],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
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
    expect(component.userEmail()).toBe('e2e_playwright@mis.mrmads.net');
    expect(component.userRole()).toBe('head');
    expect(component.userRoleLabel()).toBe('Head of Operations');
    expect(component.userInitials()).toBe('E2');
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
