import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { vi } from 'vitest';

import { SessionType } from '../../api/generated/model/sessionType';
import { UserRole } from '../../api/generated/model/userRole';
import { AuthSessionStore } from '../../platform/auth/auth-session.store';
import { SetPasswordPage } from './set-password.page';

const USER = {
  id: 1,
  email: 'user@example.com',
  first_name: 'Pulse',
  last_name: 'User',
  role: UserRole.EMPLOYEE,
  is_active: true,
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
};

describe('SetPasswordPage', () => {
  let fixture: ComponentFixture<SetPasswordPage>;
  const session = { completePasswordChange: vi.fn() };
  const router = { navigateByUrl: vi.fn().mockResolvedValue(true) };

  beforeEach(async () => {
    vi.clearAllMocks();
    session.completePasswordChange.mockReturnValue(
      of({ access_token: 'access-token', session_type: SessionType.NORMAL, user: USER }),
    );
    await TestBed.configureTestingModule({
      imports: [SetPasswordPage],
      providers: [
        { provide: AuthSessionStore, useValue: session },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SetPasswordPage);
    fixture.detectChanges();
  });

  function validForm(): void {
    fixture.componentInstance['form'].setValue({
      newPassword: 'new-password-123',
      confirmNewPassword: 'new-password-123',
    });
  }

  it('enforces policy and confirmation validation', () => {
    const form = fixture.componentInstance['form'];
    form.setValue({ newPassword: 'short', confirmNewPassword: 'different' });
    fixture.componentInstance['submit']();
    fixture.detectChanges();

    expect(session.completePasswordChange).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Use at least 8 characters.');
    expect(fixture.nativeElement.textContent).toContain('Passwords must match.');
  });

  it('completes the session, clears sensitive fields, and navigates to tickets', () => {
    validForm();

    fixture.componentInstance['submit']();

    expect(session.completePasswordChange).toHaveBeenCalledWith({
      new_password: 'new-password-123',
      confirm_new_password: 'new-password-123',
    });
    expect(fixture.componentInstance['form'].controls.newPassword.value).toBe('');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/tickets');
  });

  it('prevents duplicate submission', () => {
    const pending = new Subject<unknown>();
    session.completePasswordChange.mockReturnValue(pending);
    validForm();

    fixture.componentInstance['submit']();
    fixture.componentInstance['submit']();

    expect(session.completePasswordChange).toHaveBeenCalledOnce();
  });

  it('preserves password fields and shows a safe error after failure', () => {
    session.completePasswordChange.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 422,
            error: { code: 'PASSWORD_REUSE_NOT_ALLOWED' },
          }),
      ),
    );
    validForm();

    fixture.componentInstance['submit']();
    fixture.detectChanges();

    expect(fixture.componentInstance['form'].controls.newPassword.value).toBe('new-password-123');
    expect(fixture.nativeElement.textContent).toContain(
      'Choose a password that is different from your temporary password.',
    );
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });
});
