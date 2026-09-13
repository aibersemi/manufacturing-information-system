import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { signal } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { CompanyService } from '../services/company.service';
import { ownerGuard } from './owner.guard';

describe('ownerGuard', () => {
  let mockAuthService: any;
  let mockCompanyService: any;
  let mockRouter: any;

  const mockRoute = {} as ActivatedRouteSnapshot;
  const mockState = { url: '/workspace/companies' } as RouterStateSnapshot;

  beforeEach(() => {
    mockAuthService = {
      waitForAuthReady: vi.fn().mockResolvedValue(undefined),
      isAuthenticated: signal(true),
    };

    mockCompanyService = {
      availableCompanies: signal([{ id: 'c1' }]),
      isLoading: signal(false),
      loadUserCompanies: vi.fn().mockResolvedValue(undefined),
      isOwner: signal(true),
    };

    mockRouter = {
      createUrlTree: vi.fn().mockImplementation((path, extras) => ({ path, extras }) as unknown as UrlTree),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: CompanyService, useValue: mockCompanyService },
        { provide: Router, useValue: mockRouter },
      ],
    });
  });

  it('should redirect to /login when not authenticated', async () => {
    mockAuthService.isAuthenticated.set(false);

    const result = await TestBed.runInInjectionContext(() => ownerGuard(mockRoute, mockState));

    expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/workspace/companies' },
    });
    expect(result).toEqual({ path: ['/login'], extras: { queryParams: { returnUrl: '/workspace/companies' } } });
  });

  it('should redirect to root / when authenticated but not an owner', async () => {
    mockAuthService.isAuthenticated.set(true);
    mockCompanyService.isOwner.set(false);

    const result = await TestBed.runInInjectionContext(() => ownerGuard(mockRoute, mockState));

    expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/']);
    expect(result).toEqual({ path: ['/'], extras: undefined });
  });

  it('should allow access when authenticated and user is an owner', async () => {
    mockAuthService.isAuthenticated.set(true);
    mockCompanyService.isOwner.set(true);

    const result = await TestBed.runInInjectionContext(() => ownerGuard(mockRoute, mockState));

    expect(result).toBe(true);
  });
});
