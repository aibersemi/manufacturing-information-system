import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorCheck,
  phosphorFloppyDisk,
  phosphorLock,
  phosphorShieldCheck,
  phosphorUser,
  phosphorX,
} from '@ng-icons/phosphor-icons/regular';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { SettingsService, UserProfileData } from '../../../core/services/settings.service';

@Component({
  selector: 'app-profile',
  imports: [
    FormsModule,
    NgIcon,
    HlmButton,
    HlmCardImports,
  ],
  providers: [
    provideIcons({
      phosphorArrowsClockwise,
      phosphorCheck,
      phosphorFloppyDisk,
      phosphorLock,
      phosphorShieldCheck,
      phosphorUser,
      phosphorX,
    }),
  ],
  templateUrl: './profile.component.html',
})
export class ProfileComponent implements OnInit {
  private readonly settingsService = inject(SettingsService);

  readonly profile = signal<UserProfileData | null>(null);

  // Form Profil
  readonly formFullName = signal<string>('');
  readonly formPhone = signal<string>('');
  readonly formAddress = signal<string>('');
  readonly formBankAccount = signal<string>('');
  readonly formBankAccountName = signal<string>('');
  readonly isSavingProfile = signal<boolean>(false);

  // Form Keamanan & Kata Sandi
  readonly currentPassword = signal<string>('');
  readonly newPassword = signal<string>('');
  readonly confirmPassword = signal<string>('');
  readonly isChangingPassword = signal<boolean>(false);
  readonly passwordError = signal<string | null>(null);

  // Indikator Kekuatan Password
  readonly passwordStrength = computed(() => {
    const p = this.newPassword();
    if (!p) return { score: 0, label: '', color: '' };
    let score = 0;
    if (p.length >= 8) score++;
    if (/[A-Z]/.test(p)) score++;
    if (/[0-9]/.test(p)) score++;
    if (/[^A-Za-z0-9]/.test(p)) score++;

    if (score <= 1) return { score: 1, label: 'Lemah', color: 'bg-destructive' };
    if (score <= 3) return { score: 2, label: 'Sedang', color: 'bg-amber-500' };
    return { score: 3, label: 'Kuat', color: 'bg-emerald-500' };
  });

  readonly isPasswordMismatch = computed(() => {
    return (
      this.newPassword().length > 0 &&
      this.confirmPassword().length > 0 &&
      this.newPassword() !== this.confirmPassword()
    );
  });

  ngOnInit(): void {
    this.loadProfile();
  }

  loadProfile(): void {
    try {
      const data = this.settingsService.getCurrentUserProfile();
      this.profile.set(data);
      this.formFullName.set(data.fullName);
      this.formPhone.set(data.phone);
      this.formAddress.set(data.address);
      this.formBankAccount.set(data.bankAccount);
      this.formBankAccountName.set(data.bankAccountName);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat profil pengguna.';
      toast.error(msg);
    }
  }

  async saveProfile(): Promise<void> {
    const fullName = this.formFullName().trim();
    if (!fullName) {
      toast.error('Nama lengkap tidak boleh kosong.');
      return;
    }

    this.isSavingProfile.set(true);

    try {
      const updated = await this.settingsService.updateProfile({
        fullName,
        phone: this.formPhone().trim(),
        address: this.formAddress().trim(),
        bankAccount: this.formBankAccount().trim(),
        bankAccountName: this.formBankAccountName().trim(),
      });

      this.profile.set(updated);
      toast.success('Profil pengguna berhasil diperbarui.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memperbarui profil.';
      toast.error(msg);
    } finally {
      this.isSavingProfile.set(false);
    }
  }

  async changePassword(): Promise<void> {
    this.passwordError.set(null);

    const curr = this.currentPassword();
    const next = this.newPassword();
    const conf = this.confirmPassword();

    if (!curr) {
      this.passwordError.set('Kata sandi saat ini wajib diisi.');
      return;
    }

    if (next.length < 8) {
      this.passwordError.set('Kata sandi baru minimal harus 8 karakter.');
      return;
    }

    if (next !== conf) {
      this.passwordError.set('Konfirmasi kata sandi baru tidak cocok.');
      return;
    }

    this.isChangingPassword.set(true);

    try {
      await this.settingsService.changePassword(curr, next);
      toast.success('Kata sandi berhasil diubah.');
      this.currentPassword.set('');
      this.newPassword.set('');
      this.confirmPassword.set('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal mengubah kata sandi.';
      this.passwordError.set(msg);
    } finally {
      this.isChangingPassword.set(false);
    }
  }
}
