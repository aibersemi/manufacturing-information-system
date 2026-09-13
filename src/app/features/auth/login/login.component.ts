import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorBuildings,
  phosphorCircleNotch,
  phosphorEye,
  phosphorEyeSlash,
  phosphorLock,
  phosphorSignIn,
  phosphorUser,
  phosphorWarningCircle,
} from '@ng-icons/phosphor-icons/regular';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { toast } from '@spartan-ng/brain/sonner';
import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../core/services/auth.service';
import { getSafeReturnUrl } from '../../../core/utils/url.util';

@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    HlmAlertImports,
    HlmButton,
    HlmCardImports,
    HlmInputImports,
    HlmLabelImports,
    NgIcon,
  ],
  providers: [
    provideIcons({
      phosphorBuildings,
      phosphorCircleNotch,
      phosphorEye,
      phosphorEyeSlash,
      phosphorLock,
      phosphorSignIn,
      phosphorUser,
      phosphorWarningCircle,
    }),
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly isSubmitting = signal(false);
  readonly showPassword = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.minLength(3)]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  togglePasswordVisibility(): void {
    this.showPassword.update((val) => !val);
  }

  isFieldInvalid(fieldName: 'email' | 'password'): boolean {
    const control = this.form.get(fieldName);
    return !!(control && control.invalid && (control.dirty || control.touched));
  }

  async onSubmit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    const { email, password } = this.form.getRawValue();
    const defaultDomain =
      environment.appDomain || (typeof window !== 'undefined' ? window.location.hostname : 'localhost');
    const normalizedEmail = email.trim().includes('@')
      ? email.trim()
      : `${email.trim()}@${defaultDomain}`;

    try {
      await this.authService.signInWithPassword({ email: normalizedEmail, password });
      toast.success('Login berhasil! Mengalihkan ke sistem...');
      const rawReturnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
      const returnUrl = getSafeReturnUrl(rawReturnUrl, '/');
      await this.router.navigateByUrl(returnUrl);
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error ? err.message : 'Kombinasi email dan password tidak sesuai.';
      this.errorMessage.set(errorMsg);
      toast.error('Gagal Masuk', {
        description: errorMsg,
      });
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
