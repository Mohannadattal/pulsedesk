import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { UserRole } from '../../api/generated/model/userRole';
import { AuthSessionStore } from '../../platform/auth/auth-session.store';
import { NotificationIndicatorService } from '../../features/notifications/data-access/notification-indicator.service';
import { NotificationsDataAccess } from '../../features/notifications/data-access/notifications-data-access';
import { AppShellComponent } from './app-shell.component';

describe('AppShellComponent administration navigation', () => {
  let fixture: ComponentFixture<AppShellComponent>;
  const currentUser = signal<Record<string, unknown> | null>(null);
  const session = {
    currentUser,
    endSession: vi.fn(),
  };
  const unreadCount = signal<number | null>(0);
  const indicator = {
    unreadCount,
    badgeText: () => {
      const count = unreadCount();
      return count === null || count <= 0 ? null : count > 99 ? '99+' : String(count);
    },
    start: vi.fn(),
    stop: vi.fn(),
    noteOneRead: vi.fn(),
    noteAllRead: vi.fn(),
    refresh: vi.fn(),
  };
  const notifications = {
    list: vi.fn(() => of({ items: [], page: 1, pageSize: 5, total: 0, totalPages: 0 })),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [
        provideRouter([]),
        { provide: AuthSessionStore, useValue: session },
        { provide: NotificationIndicatorService, useValue: indicator },
        { provide: NotificationsDataAccess, useValue: notifications },
        { provide: BreakpointObserver, useValue: { observe: () => of({ matches: false }) } },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    unreadCount.set(0);
    vi.clearAllMocks();
  });

  it('shows Administration only to administrators', () => {
    currentUser.set({
      id: 1,
      first_name: 'Amir',
      last_name: 'Admin',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
    });
    fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Administration');
  });

  it.each([UserRole.EMPLOYEE, UserRole.AGENT])('hides Administration from %s', (role) => {
    currentUser.set({
      id: 2,
      first_name: 'User',
      last_name: 'Example',
      email: 'user@example.com',
      role,
    });
    fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Administration');
  });

  it.each([UserRole.EMPLOYEE, UserRole.ADMIN])('shows Customers to %s', (role) => {
    currentUser.set({
      id: 3,
      first_name: 'Customer',
      last_name: 'User',
      email: 'user@example.com',
      role,
    });
    fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Customers');
  });

  it('hides Customers from Agents', () => {
    currentUser.set({
      id: 4,
      first_name: 'Ada',
      last_name: 'Agent',
      email: 'agent@example.com',
      role: UserRole.AGENT,
    });
    fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Customers');
  });

  it.each([UserRole.EMPLOYEE, UserRole.AGENT, UserRole.ADMIN])(
    'shows the notification bell to %s',
    (role) => {
      currentUser.set({
        id: 5,
        first_name: 'Bell',
        last_name: 'User',
        email: 'bell@example.com',
        role,
      });
      fixture = TestBed.createComponent(AppShellComponent);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.notification-bell')).not.toBeNull();
    },
  );

  it('hides a zero badge and compacts large counts', () => {
    currentUser.set({
      id: 6,
      first_name: 'Badge',
      last_name: 'User',
      email: 'badge@example.com',
      role: UserRole.AGENT,
    });
    fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.notification-bell__badge')).toBeNull();

    unreadCount.set(142);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.notification-bell__badge').textContent).toContain(
      '99+',
    );
    expect(
      fixture.nativeElement.querySelector('.notification-bell').getAttribute('aria-label'),
    ).toBe('142 unread notifications');
  });
});
