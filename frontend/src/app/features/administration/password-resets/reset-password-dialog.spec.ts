import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of, Subject, throwError } from 'rxjs';
import { vi } from 'vitest';

import { UserRole } from '../../../api/generated/model/userRole';
import {
  AdministrationDataAccess,
  AdminPasswordResetRequest,
} from '../data-access/administration-data-access';
import { ResetPasswordDialog } from './reset-password-dialog';

const REQUEST: AdminPasswordResetRequest = {
  id: 12,
  requestedAt: new Date('2026-09-17T08:00:00Z'),
  user: {
    id: 7,
    email: 'alex@example.com',
    firstName: 'Alex',
    lastName: 'Morgan',
    role: UserRole.AGENT,
    isActive: true,
  },
};

describe('ResetPasswordDialog', () => {
  let fixture: ComponentFixture<ResetPasswordDialog>;
  const administration = { resetUserPassword: vi.fn() };
  const dialogRef = { close: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    administration.resetUserPassword.mockReturnValue(of(REQUEST));
    await TestBed.configureTestingModule({
      imports: [ResetPasswordDialog],
      providers: [
        { provide: AdministrationDataAccess, useValue: administration },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: REQUEST },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ResetPasswordDialog);
    fixture.detectChanges();
  });

  function validForm(): void {
    fixture.componentInstance['form'].setValue({
      temporaryPassword: 'temporary-password-123',
      confirmation: 'temporary-password-123',
    });
  }

  it('enforces confirmation and password policy', () => {
    fixture.componentInstance['form'].setValue({
      temporaryPassword: 'short',
      confirmation: 'different',
    });
    fixture.componentInstance['submit']();
    fixture.detectChanges();

    expect(administration.resetUserPassword).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Use at least 8 characters.');
    expect(fixture.nativeElement.textContent).toContain('Passwords must match.');
  });

  it('prevents duplicates, clears secrets on success, and closes contextually', () => {
    const pending = new Subject<AdminPasswordResetRequest>();
    administration.resetUserPassword.mockReturnValue(pending);
    validForm();

    fixture.componentInstance['submit']();
    fixture.componentInstance['submit']();
    expect(administration.resetUserPassword).toHaveBeenCalledOnce();

    pending.next(REQUEST);
    pending.complete();
    expect(fixture.componentInstance['form'].controls.temporaryPassword.value).toBe('');
    expect(dialogRef.close).toHaveBeenCalledWith({
      kind: 'resolved',
      userName: 'Alex Morgan',
    });
  });

  it('closes and asks the queue to refresh when the request was already resolved', () => {
    administration.resetUserPassword.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { code: 'PASSWORD_RESET_REQUEST_RESOLVED' },
          }),
      ),
    );
    validForm();

    fixture.componentInstance['submit']();

    expect(fixture.componentInstance['form'].controls.temporaryPassword.value).toBe('');
    expect(dialogRef.close).toHaveBeenCalledWith({ kind: 'conflict' });
  });

  it('surfaces an inactive target and preserves the temporary password', () => {
    administration.resetUserPassword.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { code: 'PASSWORD_RESET_TARGET_INACTIVE' },
          }),
      ),
    );
    validForm();

    fixture.componentInstance['submit']();
    fixture.detectChanges();

    expect(fixture.componentInstance['form'].controls.temporaryPassword.value).toBe(
      'temporary-password-123',
    );
    expect(fixture.nativeElement.textContent).toContain('This account is inactive.');
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('preserves the temporary password after a network failure', () => {
    administration.resetUserPassword.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 0 })),
    );
    validForm();

    fixture.componentInstance['submit']();

    expect(fixture.componentInstance['form'].controls.temporaryPassword.value).toBe(
      'temporary-password-123',
    );
    expect(dialogRef.close).not.toHaveBeenCalled();
  });
});
