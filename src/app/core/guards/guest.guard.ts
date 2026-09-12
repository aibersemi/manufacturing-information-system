import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Functional guard untuk mencegah pengguna yang telah terautentikasi
 * mengakses kembali halaman publik khusus tamu seperti /login.
 */
export const guestGuard: CanActivateFn = async () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  await authService.waitForAuthReady();

  if (authService.isAuthenticated()) {
    return router.parseUrl('/');
  }

  return true;
};
