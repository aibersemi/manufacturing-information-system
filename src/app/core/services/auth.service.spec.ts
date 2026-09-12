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
});
