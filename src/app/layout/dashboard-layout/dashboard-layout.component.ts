import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowsClockwise,
  phosphorBank,
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
  phosphorShoppingCart,
  phosphorTrendUp,
  phosphorReceipt,
  phosphorUser,
  phosphorUsersThree,
  phosphorWarehouse,
  phosphorX,
  phosphorArmchair,
  phosphorCube,
  phosphorChartPieSlice,
  phosphorFileText,
  phosphorScales,
  phosphorTrash,
} from '@ng-icons/phosphor-icons/regular';
import { HlmAvatarImports } from '@spartan-ng/helm/avatar';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { toast } from '@spartan-ng/brain/sonner';
import { AuthService } from '../../core/services/auth.service';
import { CompanyService, Company } from '../../core/services/company.service';

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
      phosphorBank,
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
      phosphorShoppingCart,
      phosphorTrendUp,
      phosphorReceipt,
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
      phosphorArmchair,
      phosphorCube,
      phosphorChartPieSlice,
      phosphorFileText,
      phosphorScales,
      phosphorTrash,
    }),
  ],
  templateUrl: './dashboard-layout.component.html',
  styleUrl: './dashboard-layout.component.css',
})
export class DashboardLayoutComponent {
  private readonly authService = inject(AuthService);
  private readonly companyService = inject(CompanyService);
  private readonly router = inject(Router);

  readonly isSidebarCollapsed = signal(false);
  readonly isMobileMenuOpen = signal(false);

  readonly openNavGroups = signal<Record<string, boolean>>({
    masterData: true,
    purchasing: true,
    sales: true,
    finance: true,
    assets: true,
    reports: true,
    operations: true,
    inventory: true,
    qc: false,
    settings: false,
  });

  readonly availableCompanies = computed(() => this.companyService.availableCompanies());
  readonly activeCompanyId = computed(() => this.companyService.activeCompanyId());
  readonly isOwner = computed(() => this.companyService.isOwner());
  readonly activeCompany = computed(() => {
    const current = this.companyService.activeCompany();
    if (current) return current.name;
    return this.companyService.isLoading() ? 'Memuat...' : 'Pilih Fasilitas';
  });

  readonly currentUser = computed(() => this.authService.currentUser());

  readonly userEmail = computed(() => {
    const user = this.currentUser();
    return user?.email ?? '';
  });

  readonly userName = computed(() => {
    const email = this.userEmail();
    return email ? (email.split('@')[0] || 'Operator') : 'Operator';
  });

  readonly userRole = computed(() => {
    const user = this.currentUser();
    const appRole = user?.app_metadata?.['role'] as string | undefined;
    const userRole = user?.user_metadata?.['role'] as string | undefined;
    return appRole || userRole || 'Owner';
  });

  readonly userRoleLabel = computed(() => {
    const roles = this.companyService.userRoles();
    if (roles.includes('owner') || this.companyService.isOwner()) {
      return 'Owner / Direksi';
    }
    if (roles.includes('kepala_konveksi') || roles.includes('head')) {
      return 'Head of Operations';
    }
    if (roles.includes('finance')) {
      return 'Finance Lead';
    }
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

  selectCompany(company: Company): void {
    this.companyService.setActiveCompany(company.id);
    toast.success(`Beralih ke ${company.name}`);
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

