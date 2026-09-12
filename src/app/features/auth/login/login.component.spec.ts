import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { LoginComponent } from './login.component';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;
  let mockAuthService: { signInWithPassword: ReturnType<typeof vi.fn> };
  let router: Router;

  beforeEach(async () => {
    mockAuthService = {
      signInWithPassword: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: {
                get: (key: string) => (key === 'returnUrl' ? null : null),
              },
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('should create the login component', () => {
    expect(component).toBeTruthy();
  });

  it('should validate email and password fields', () => {
    expect(component.form.valid).toBe(false);

    const emailControl = component.form.get('email')!;
    const passwordControl = component.form.get('password')!;

    emailControl.setValue('invalid-email');
    expect(emailControl.hasError('email')).toBe(true);

    emailControl.setValue('valid@aibersemi.com');
    expect(emailControl.valid).toBe(true);

    passwordControl.setValue('123');
    expect(passwordControl.hasError('minlength')).toBe(true);

    passwordControl.setValue('secret123');
    expect(passwordControl.valid).toBe(true);

    expect(component.form.valid).toBe(true);
  });

  it('should toggle password visibility signal', () => {
    expect(component.showPassword()).toBe(false);
    component.togglePasswordVisibility();
    expect(component.showPassword()).toBe(true);
    component.togglePasswordVisibility();
    expect(component.showPassword()).toBe(false);
  });

  it('should call authService.signInWithPassword and navigate on valid submit', async () => {
    mockAuthService.signInWithPassword.mockResolvedValue({
      user: { id: 'u1', email: 'valid@aibersemi.com' },
      session: { access_token: 'token' },
    });
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    component.form.setValue({
      email: 'valid@aibersemi.com',
      password: 'validpassword',
    });

    await component.onSubmit();

    expect(mockAuthService.signInWithPassword).toHaveBeenCalledWith({
      email: 'valid@aibersemi.com',
      password: 'validpassword',
    });
    expect(navigateSpy).toHaveBeenCalledWith('/');
    expect(component.errorMessage()).toBeNull();
    expect(component.isSubmitting()).toBe(false);
  });

  it('should display error message on failed login', async () => {
    mockAuthService.signInWithPassword.mockRejectedValue(new Error('Invalid credentials'));

    component.form.setValue({
      email: 'wrong@aibersemi.com',
      password: 'wrongpassword',
    });

    await component.onSubmit();

    expect(mockAuthService.signInWithPassword).toHaveBeenCalled();
    expect(component.errorMessage()).toBe('Invalid credentials');
    expect(component.isSubmitting()).toBe(false);
  });
});
