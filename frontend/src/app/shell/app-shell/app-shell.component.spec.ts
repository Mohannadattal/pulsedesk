import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { UserRole } from '../../api/generated/model/userRole';
import { AuthSessionStore } from '../../platform/auth/auth-session.store';
import { AppShellComponent } from './app-shell.component';

describe('AppShellComponent administration navigation', () => {
  let fixture: ComponentFixture<AppShellComponent>;
  const currentUser = signal<Record<string, unknown> | null>(null);
  const session = {
    currentUser,
    endSession: vi.fn(),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [
        provideRouter([]),
        { provide: AuthSessionStore, useValue: session },
        { provide: BreakpointObserver, useValue: { observe: () => of({ matches: false }) } },
      ],
    }).compileComponents();
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
});
