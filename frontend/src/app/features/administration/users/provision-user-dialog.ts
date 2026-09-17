import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { finalize, take } from 'rxjs';

import { UserRole } from '../../../api/generated/model/userRole';
import { AppError, normalizeHttpError } from '../../../platform/http/app-error';
import { AdministrationDataAccess, AdminUser } from '../data-access/administration-data-access';
import { USER_ROLES } from '../domain/admin-user-filters';

type UserField = 'email' | 'firstName' | 'lastName' | 'role' | 'password';

function passwordsMatch(control: AbstractControl): ValidationErrors | null {
  const password = control.get('password')?.value;
  const confirmation = control.get('passwordConfirmation')?.value;
  return password === confirmation ? null : { passwordMismatch: true };
}

function passwordMatches(control: AbstractControl): ValidationErrors | null {
  const password = control.parent?.get('password')?.value;
  return password === undefined || password === control.value ? null : { passwordMismatch: true };
}

@Component({
  selector: 'app-provision-user-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    ReactiveFormsModule,
  ],
  templateUrl: './provision-user-dialog.html',
  styleUrl: './provision-user-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProvisionUserDialog {
  private readonly administration = inject(AdministrationDataAccess);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef = inject(MatDialogRef<ProvisionUserDialog, AdminUser>);

  protected readonly roles = USER_ROLES;
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly serverFields = signal<Partial<Record<UserField, string>>>({});
  protected readonly form = new FormGroup(
    {
      email: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.email, Validators.maxLength(255)],
      }),
      firstName: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(100)],
      }),
      lastName: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(100)],
      }),
      role: new FormControl<UserRole>(UserRole.EMPLOYEE, { nonNullable: true }),
      password: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.minLength(8), Validators.maxLength(128)],
      }),
      passwordConfirmation: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, passwordMatches],
      }),
    },
    { validators: passwordsMatch },
  );

  constructor() {
    const fields: readonly UserField[] = ['email', 'firstName', 'lastName', 'role', 'password'];
    for (const field of fields) {
      const control: AbstractControl = this.form.controls[field];
      control.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.clearFieldError(field));
    }
    this.form.controls.passwordConfirmation.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.errorMessage.set(null));
    this.form.controls.password.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.form.controls.passwordConfirmation.updateValueAndValidity({ emitEvent: false });
    });
  }

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    this.errorMessage.set(null);
    this.serverFields.set({});
    this.submitting.set(true);
    this.administration
      .provisionUser({
        email: value.email.trim(),
        first_name: value.firstName.trim(),
        last_name: value.lastName.trim(),
        role: value.role,
        password: value.password,
      })
      .pipe(
        take(1),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.submitting.set(false)),
      )
      .subscribe({
        next: (user) => {
          this.form.controls.password.reset('');
          this.form.controls.passwordConfirmation.reset('');
          this.dialogRef.close(user);
        },
        error: (error: unknown) => this.handleError(normalizeHttpError(error)),
      });
  }

  protected fieldMessage(field: UserField): string | undefined {
    return this.serverFields()[field];
  }

  private handleError(error: AppError): void {
    if (error.kind === 'conflict' && error.code === 'USER_ALREADY_EXISTS') {
      this.setFieldError('email', 'An account with this email already exists.');
      return;
    }
    if (error.kind === 'validation') {
      for (const item of error.validationErrors) {
        const field = this.fieldForApiName(item.field);
        if (field) this.setFieldError(field, item.message);
      }
      if (Object.keys(this.serverFields()).length > 0) return;
    }
    this.errorMessage.set(
      error.kind === 'network'
        ? 'PulseDesk could not be reached. Check your connection and try again.'
        : error.kind === 'unavailable'
          ? 'User provisioning is temporarily unavailable. Try again shortly.'
          : error.kind === 'forbidden'
            ? 'Your account does not have permission to provision users.'
            : 'The user could not be provisioned. Review the details and try again.',
    );
  }

  private setFieldError(field: UserField, message: string): void {
    this.serverFields.update((messages) => ({ ...messages, [field]: message }));
    const control = this.form.controls[field];
    control.setErrors({ ...control.errors, server: true });
  }

  private clearFieldError(field: UserField): void {
    this.errorMessage.set(null);
    this.serverFields.update((messages) => {
      const next = { ...messages };
      delete next[field];
      return next;
    });
    const control = this.form.controls[field];
    if (control.hasError('server')) {
      const remaining = { ...control.errors };
      delete remaining['server'];
      control.setErrors(Object.keys(remaining).length ? remaining : null);
    }
  }

  private fieldForApiName(field: string): UserField | undefined {
    return (
      {
        email: 'email',
        first_name: 'firstName',
        last_name: 'lastName',
        role: 'role',
        password: 'password',
      } as const
    )[field as 'email'];
  }
}
