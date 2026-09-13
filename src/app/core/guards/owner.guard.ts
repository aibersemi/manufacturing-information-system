import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { CompanyService } from '../services/company.service';

/**
 * Functional guard yang memastikan pengguna memiliki peran 'owner' pada perusahaan aktif.
 * Jika tidak berwenang, arahkan kembali ke root dashboard.
 */
export const ownerGuard: CanActivateFn = async (_route, state) => {
  const authService = inject(AuthService);
  const companyService = inject(CompanyService);
  const router = inject(Router);

  await authService.waitForAuthReady();

  if (!authService.isAuthenticated()) {
    return router.createUrlTree(['/login'], {
      queryParams: { returnUrl: state.url },
    });
  }

  // Jika company belum selesai dimuat, tunggu atau muat terlebih dahulu
  if (companyService.availableCompanies().length === 0 && !companyService.isLoading()) {
    await companyService.loadUserCompanies();
  }

  if (companyService.isOwner()) {
    return true;
  }

  return router.createUrlTree(['/']);
};
