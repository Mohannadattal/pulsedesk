import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { MatDialogRef } from '@angular/material/dialog';
import { of, Subject, throwError } from 'rxjs';
import { vi } from 'vitest';

import { UserRole } from '../../../api/generated/model/userRole';
import { AdministrationDataAccess, AdminUser } from '../data-access/administration-data-access';
import { ProvisionUserDialog } from './provision-user-dialog';

const CREATED_USER: AdminUser = {
  id: 9,
  email: 'new@example.com',
  firstName: 'New',
  lastName: 'User',
  role: UserRole.EMPLOYEE,
  isActive: true,
  createdAt: new Date('2026-09-17T08:00:00Z'),
  updatedAt: new Date('2026-09-17T08:00:00Z'),
};

describe('ProvisionUserDialog', () => {
  let fixture: ComponentFixture<ProvisionUserDialog>;
  const administration = { provisionUser: vi.fn() };
  const dialogRef = { close: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    administration.provisionUser.mockReturnValue(of(CREATED_USER));
    await TestBed.configureTestingModule({
      imports: [ProvisionUserDialog],
      providers: [
        { provide: AdministrationDataAccess, useValue: administration },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ProvisionUserDialog);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  function validForm(): void {
    fixture.componentInstance['form'].setValue({
      email: 'new@example.com',
      firstName: 'New',
      lastName: 'User',
      role: UserRole.EMPLOYEE,
      password: 'password-123',
      passwordConfirmation: 'password-123',
    });
  }

  it('requires matching passwords and supports every initial role', () => {
    const form = fixture.componentInstance['form'];
    form.controls.password.setValue('password-123');
    form.controls.passwordConfirmation.setValue('different-password');
    expect(form.hasError('passwordMismatch')).toBe(true);
    expect(fixture.componentInstance['roles']).toEqual([
      UserRole.EMPLOYEE,
      UserRole.AGENT,
      UserRole.ADMIN,
    ]);
  });

  it('prevents duplicate submission and clears password state after success', () => {
    const pending = new Subject<AdminUser>();
    administration.provisionUser.mockReturnValue(pending);
    validForm();

    fixture.componentInstance['submit']();
    fixture.componentInstance['submit']();
    expect(administration.provisionUser).toHaveBeenCalledOnce();

    pending.next(CREATED_USER);
    pending.complete();
    expect(fixture.componentInstance['form'].controls.password.value).toBe('');
    expect(fixture.componentInstance['form'].controls.passwordConfirmation.value).toBe('');
    expect(dialogRef.close).toHaveBeenCalledWith(CREATED_USER);
  });

  it('maps duplicate email to the email field and retains entered values', () => {
    administration.provisionUser.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { code: 'USER_ALREADY_EXISTS', detail: 'Duplicate' },
          }),
      ),
    );
    validForm();

    fixture.componentInstance['submit']();

    expect(fixture.componentInstance['form'].controls.email.hasError('server')).toBe(true);
    expect(fixture.componentInstance['form'].controls.firstName.value).toBe('New');
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('shows required and invalid-email feedback after invalid submit', () => {
    fixture.componentInstance['submit']();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(administration.provisionUser).not.toHaveBeenCalled();
    expect(text).toContain('Email is required.');
    expect(text).toContain('First name is required.');
    expect(text).toContain('Last name is required.');
    expect(text).toContain('Password is required.');
    expect(text).toContain('Password confirmation is required.');

    fixture.componentInstance['form'].controls.email.setValue('not-an-email');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Enter a valid email address.');
  });

  it('shows local maximum-length feedback for provisioning fields', () => {
    const form = fixture.componentInstance['form'];
    form.setValue({
      email: `${'a'.repeat(244)}@example.com`,
      firstName: 'a'.repeat(101),
      lastName: 'b'.repeat(101),
      role: UserRole.EMPLOYEE,
      password: 'p'.repeat(129),
      passwordConfirmation: 'p'.repeat(129),
    });

    fixture.componentInstance['submit']();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Use 255 characters or fewer.');
    expect(text.match(/Use 100 characters or fewer\./g)).toHaveLength(2);
    expect(text).toContain('Use 128 characters or fewer.');
    expect(administration.provisionUser).not.toHaveBeenCalled();
  });

  it('shows backend-compatible minimum length and associates mismatch with confirmation', () => {
    const form = fixture.componentInstance['form'];
    form.setValue({
      email: 'new@example.com',
      firstName: 'New',
      lastName: 'User',
      role: UserRole.EMPLOYEE,
      password: 'short',
      passwordConfirmation: 'different',
    });

    fixture.componentInstance['submit']();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Use at least 8 characters.');
    expect(fixture.nativeElement.textContent).toContain('Passwords must match.');
    const confirmation = fixture.nativeElement.querySelector(
      'input[formcontrolname="passwordConfirmation"]',
    ) as HTMLInputElement;
    const describedBy = confirmation.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(fixture.nativeElement.querySelector(`#${describedBy}`)?.textContent).toContain(
      'Passwords must match.',
    );
  });
});
