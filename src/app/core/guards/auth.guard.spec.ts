import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../services/auth.service';
import { authGuard } from './auth.guard';

describe('authGuard', () => {
  it('should allow access if user is authenticated after auth becomes ready', async () => {
    const mockAuthService = {
      isAuthenticated: signal(true),
      waitForAuthReady: vi.fn().mockResolvedValue(undefined),
    };
    const mockRouter = {
      createUrlTree: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: Router, useValue: mockRouter },
      ],
    });

    const result = await TestBed.runInInjectionContext(() =>
      authGuard({} as any, { url: '/dashboard' } as any)
    );

    expect(mockAuthService.waitForAuthReady).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
    expect(mockRouter.createUrlTree).not.toHaveBeenCalled();
  });

  it('should redirect to /login with returnUrl if user is not authenticated', async () => {
    const mockAuthService = {
      isAuthenticated: signal(false),
      waitForAuthReady: vi.fn().mockResolvedValue(undefined),
    };
    const mockUrlTree = {} as UrlTree;
    const mockRouter = {
      createUrlTree: vi.fn().mockReturnValue(mockUrlTree),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: Router, useValue: mockRouter },
      ],
    });

    const result = await TestBed.runInInjectionContext(() =>
      authGuard({} as any, { url: '/production/orders' } as any)
    );

    expect(mockAuthService.waitForAuthReady).toHaveBeenCalledTimes(1);
    expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/production/orders' },
    });
    expect(result).toBe(mockUrlTree);
  });
});
