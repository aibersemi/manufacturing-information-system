import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { guestGuard } from './guest.guard';
import { AuthService } from '../services/auth.service';
import { signal } from '@angular/core';

describe('guestGuard', () => {
  it('should allow access if user is not authenticated', async () => {
    const mockAuthService = {
      isAuthenticated: signal(false),
      waitForAuthReady: vi.fn().mockResolvedValue(undefined),
    };
    const mockRouter = {
      parseUrl: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: Router, useValue: mockRouter },
      ],
    });

    const result = await TestBed.runInInjectionContext(() => guestGuard({} as any, {} as any));
    expect(mockAuthService.waitForAuthReady).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  it('should redirect to / if user is authenticated', async () => {
    const mockAuthService = {
      isAuthenticated: signal(true),
      waitForAuthReady: vi.fn().mockResolvedValue(undefined),
    };
    const mockRouter = {
      parseUrl: vi.fn().mockReturnValue('/'),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: Router, useValue: mockRouter },
      ],
    });

    const result = await TestBed.runInInjectionContext(() => guestGuard({} as any, {} as any));
    expect(mockAuthService.waitForAuthReady).toHaveBeenCalledTimes(1);
    expect(mockRouter.parseUrl).toHaveBeenCalledWith('/');
    expect(result).toBe('/');
  });
});
