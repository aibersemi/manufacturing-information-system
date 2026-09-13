import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { AuthService } from '../../core/services/auth.service';
import { DashboardComponent } from './dashboard.component';

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;
  let mockAuthService: {
    currentUser: ReturnType<typeof signal>;
  };

  beforeEach(async () => {
    mockAuthService = {
      currentUser: signal({
        id: 'u-1',
        email: 'e2e_playwright@example.com',
        app_metadata: { role: 'head' },
        user_metadata: { role: 'head' },
      } as any),
    };

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the dashboard component', () => {
    expect(component).toBeTruthy();
  });

  it('should display the current user email and role', () => {
    expect(component.userEmail()).toBe('e2e_playwright@example.com');
    expect(component.userRole()).toBe('head');
  });

  it('should provide recent work orders list', () => {
    const orders = component.recentWorkOrders();
    expect(orders.length).toBeGreaterThan(0);
    expect(orders[0]?.code).toBe('WO-2026-0891');
  });

  it('should return correct badge variants and labels for work order statuses', () => {
    expect(component.getStatusBadgeVariant('completed')).toBe('default');
    expect(component.getStatusLabel('completed')).toBe('Selesai');
    expect(component.getStatusBadgeVariant('processing')).toBe('secondary');
    expect(component.getStatusLabel('processing')).toBe('Sedang Berjalan');
  });
});
