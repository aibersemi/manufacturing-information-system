import { Component, computed, inject, signal } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideActivity,
  lucideBell,
  lucideBoxes,
  lucideChevronDown,
  lucideClipboardList,
  lucideFactory,
  lucideLayoutDashboard,
  lucideLogOut,
  lucideMenu,
  lucideSettings,
  lucideShieldCheck,
  lucideSliders,
  lucideUser,
  lucideX,
} from '@ng-icons/lucide';
import { HlmAvatarImports } from '@spartan-ng/helm/avatar';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { toast } from '@spartan-ng/brain/sonner';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-dashboard-layout',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    NgOptimizedImage,
    NgIcon,
    HlmAvatarImports,
    HlmBadge,
    HlmButton,
    HlmDropdownMenuImports,
  ],
  providers: [
    provideIcons({
      lucideLayoutDashboard,
      lucideClipboardList,
      lucideFactory,
      lucideBoxes,
      lucideShieldCheck,
      lucideSettings,
      lucideLogOut,
      lucideUser,
      lucideSliders,
      lucideBell,
      lucideChevronDown,
      lucideActivity,
      lucideMenu,
      lucideX,
    }),
  ],
  templateUrl: './dashboard-layout.component.html',
  styleUrl: './dashboard-layout.component.css',
})
export class DashboardLayoutComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  readonly isMobileMenuOpen = signal(false);

  readonly currentUser = computed(() => this.authService.currentUser());

  readonly userEmail = computed(() => {
    const user = this.currentUser();
    return user?.email ?? 'Pengguna MIS';
  });

  readonly userRole = computed(() => {
    const user = this.currentUser();
    const appRole = user?.app_metadata?.['role'] as string | undefined;
    const userRole = user?.user_metadata?.['role'] as string | undefined;
    return appRole || userRole || 'operator';
  });

  readonly userRoleLabel = computed(() => {
    const role = this.userRole().toLowerCase();
    switch (role) {
      case 'owner':
        return 'Owner / Direksi';
      case 'head':
        return 'Head of Operations';
      case 'finance':
        return 'Finance Lead';
      case 'operator':
      default:
        return 'Production Operator';
    }
  });

  readonly userInitials = computed(() => {
    const email = this.userEmail();
    const clean = email.split('@')[0] || 'US';
    return clean.slice(0, 2).toUpperCase();
  });

  toggleMobileMenu(): void {
    this.isMobileMenuOpen.update((open) => !open);
  }

  closeMobileMenu(): void {
    this.isMobileMenuOpen.set(false);
  }

  async logout(): Promise<void> {
    try {
      await this.authService.signOut();
      toast.success('Berhasil keluar dari sistem.');
      await this.router.navigateByUrl('/login');
    } catch (err) {
      console.error('Logout error:', err);
      toast.error('Gagal keluar dari sistem.');
    }
  }
}
