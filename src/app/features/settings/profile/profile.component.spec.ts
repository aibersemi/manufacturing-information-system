import { TestBed } from '@angular/core/testing';
import { ProfileComponent } from './profile.component';
import { SettingsService } from '../../../core/services/settings.service';

describe('ProfileComponent', () => {
  let component: ProfileComponent;
  let mockSettingsService: any;

  const mockProfile = {
    id: 'user-1',
    email: 'budi@example.com',
    fullName: 'Budi Santoso',
    phone: '08123456789',
    address: 'Jl. Merdeka No. 5',
    bankAccount: '123-456-7890',
    bankAccountName: 'Budi Santoso',
    role: 'owner',
  };

  beforeEach(async () => {
    mockSettingsService = {
      getCurrentUserProfile: vi.fn().mockReturnValue(mockProfile),
      updateProfile: vi.fn().mockResolvedValue({
        ...mockProfile,
        fullName: 'Budi Santoso Updated',
      }),
      changePassword: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [ProfileComponent],
      providers: [{ provide: SettingsService, useValue: mockSettingsService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(ProfileComponent);
    component = fixture.componentInstance;
  });

  it('should load profile on init', () => {
    component.ngOnInit();
    expect(mockSettingsService.getCurrentUserProfile).toHaveBeenCalled();
    expect(component.profile()?.fullName).toBe('Budi Santoso');
    expect(component.formFullName()).toBe('Budi Santoso');
  });

  it('should call updateProfile when saveProfile is invoked with valid name', async () => {
    component.formFullName.set('Budi Santoso Updated');
    component.formPhone.set('089999999');

    await component.saveProfile();

    expect(mockSettingsService.updateProfile).toHaveBeenCalledWith({
      fullName: 'Budi Santoso Updated',
      phone: '089999999',
      address: '',
      bankAccount: '',
      bankAccountName: '',
    });
  });

  it('should correctly evaluate password strength', () => {
    component.newPassword.set('abc');
    expect(component.passwordStrength().label).toBe('Lemah');

    component.newPassword.set('Abc12345');
    expect(component.passwordStrength().label).toBe('Sedang');

    component.newPassword.set('Abc12345!@#');
    expect(component.passwordStrength().label).toBe('Kuat');
  });

  it('should detect password mismatch', () => {
    component.newPassword.set('password123');
    component.confirmPassword.set('different123');
    expect(component.isPasswordMismatch()).toBe(true);

    component.confirmPassword.set('password123');
    expect(component.isPasswordMismatch()).toBe(false);
  });

  it('should require minimum 8 chars for new password in changePassword', async () => {
    component.currentPassword.set('old-password');
    component.newPassword.set('short');
    component.confirmPassword.set('short');

    await component.changePassword();

    expect(component.passwordError()).toBe('Kata sandi baru minimal harus 8 karakter.');
    expect(mockSettingsService.changePassword).not.toHaveBeenCalled();
  });

  it('should call changePassword when credentials and confirmation match', async () => {
    component.currentPassword.set('current-secret-123');
    component.newPassword.set('new-secret-123');
    component.confirmPassword.set('new-secret-123');

    await component.changePassword();

    expect(mockSettingsService.changePassword).toHaveBeenCalledWith(
      'current-secret-123',
      'new-secret-123',
    );
    expect(component.newPassword()).toBe('');
    expect(component.confirmPassword()).toBe('');
  });
});
