import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AuthService, SupabaseService]
    });
    service = TestBed.inject(AuthService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should expose reactive signals for session and user', () => {
    expect(service.session).toBeDefined();
    expect(service.currentUser).toBeDefined();
    expect(service.isAuthenticated).toBeDefined();
    expect(service.isLoading).toBeDefined();
  });

  it('should handle signInWithPassword delegation', async () => {
    const supabaseService = TestBed.inject(SupabaseService);
    const mockSession = { access_token: 'test-token', user: { id: 'u1', email: 'test@example.com' } };
    const spy = vi.spyOn(supabaseService.client.auth, 'signInWithPassword').mockResolvedValue({
      data: { session: mockSession as any, user: mockSession.user as any },
      error: null,
    });

    const res = await service.signInWithPassword({ email: 'test@example.com', password: 'password123' });
    expect(spy).toHaveBeenCalledWith({ email: 'test@example.com', password: 'password123' });
    expect(res.session).toEqual(mockSession);
    expect(service.session()).toEqual(mockSession);
  });
});
