import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorBell,
  phosphorBuildings,
  phosphorCaretDown,
  phosphorCaretRight,
  phosphorCheck,
  phosphorClipboardText,
  phosphorCpu,
  phosphorFactory,
  phosphorGauge,
  phosphorGear,
  phosphorList,
  phosphorPackage,
  phosphorPulse,
  phosphorShieldCheck,
  phosphorSidebar,
  phosphorSidebarSimple,
  phosphorSignOut,
  phosphorSliders,
  phosphorUser,
  phosphorUsersThree,
  phosphorWarehouse,
  phosphorX,
} from '@ng-icons/phosphor-icons/regular';
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
    NgIcon,
    HlmAvatarImports,
    HlmBadge,
    HlmButton,
    HlmDropdownMenuImports,
  ],
  providers: [
    provideIcons({
      phosphorGauge,
      phosphorUsersThree,
      phosphorPackage,
      phosphorCpu,
      phosphorClipboardText,
      phosphorFactory,
      phosphorBuildings,
      phosphorWarehouse,
      phosphorShieldCheck,
      phosphorGear,
      phosphorCaretRight,
      phosphorCaretDown,
      phosphorBell,
      phosphorSignOut,
      phosphorUser,
      phosphorSidebar,
      phosphorSidebarSimple,
      phosphorX,
      phosphorList,
      phosphorArrowsClockwise,
      phosphorCheck,
      phosphorSliders,
      phosphorPulse,
    }),
  ],
  templateUrl: './dashboard-layout.component.html',
  styleUrl: './dashboard-layout.component.css',
})
export class DashboardLayoutComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  readonly isSidebarCollapsed = signal(false);
  readonly isMobileMenuOpen = signal(false);

  readonly openNavGroups = signal<Record<string, boolean>>({
    masterData: true,
    operations: true,
    inventory: true,
    qc: false,
    settings: false,
  });

  readonly companies = [
    'Pabrik Semikonduktor Aiber',
    'Fabrikasi Wafer Line B',
    'Cleanroom IC Packaging',
  ];
  readonly activeCompany = signal('Pabrik Semikonduktor Aiber');

  readonly currentUser = computed(() => this.authService.currentUser());

  readonly userEmail = computed(() => {
    const user = this.currentUser();
    return user?.email ?? 'supergadangzzz@mis.mrmads.net';
  });

  readonly userName = computed(() => {
    const email = this.userEmail();
    return email.split('@')[0] || 'Operator';
  });

  readonly userRole = computed(() => {
    const user = this.currentUser();
    const appRole = user?.app_metadata?.['role'] as string | undefined;
    const userRole = user?.user_metadata?.['role'] as string | undefined;
    return appRole || userRole || 'Owner';
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
        return 'Operator Fabrikasi';
    }
  });

  readonly userInitials = computed(() => {
    const name = this.userName();
    return name.slice(0, 2).toUpperCase();
  });

  toggleSidebar(): void {
    this.isSidebarCollapsed.update((collapsed) => !collapsed);
  }

  toggleMobileMenu(): void {
    this.isMobileMenuOpen.update((open) => !open);
  }

  closeMobileMenu(): void {
    this.isMobileMenuOpen.set(false);
  }

  toggleGroup(groupKey: string): void {
    this.openNavGroups.update((groups) => ({
      ...groups,
      [groupKey]: !groups[groupKey],
    }));
  }

  isGroupOpen(groupKey: string): boolean {
    return !!this.openNavGroups()[groupKey];
  }

  selectCompany(company: string): void {
    this.activeCompany.set(company);
    toast.success(`Beralih ke ${company}`);
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

