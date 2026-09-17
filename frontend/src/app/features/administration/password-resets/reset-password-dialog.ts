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
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { finalize, take } from 'rxjs';

import { AppError, normalizeHttpError } from '../../../platform/http/app-error';
import {
  AdministrationDataAccess,
  AdminPasswordResetRequest,
} from '../data-access/administration-data-access';

export type ResetPasswordDialogResult =
  | { readonly kind: 'resolved'; readonly userName: string }
  | { readonly kind: 'conflict' };

function passwordsMatch(control: AbstractControl): ValidationErrors | null {
  return control.get('temporaryPassword')?.value === control.get('confirmation')?.value
    ? null
    : { passwordMismatch: true };
}

function passwordMatches(control: AbstractControl): ValidationErrors | null {
  const password = control.parent?.get('temporaryPassword')?.value;
  return password === undefined || password === control.value ? null : { passwordMismatch: true };
}

@Component({
  selector: 'app-reset-password-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    ReactiveFormsModule,
  ],
  templateUrl: './reset-password-dialog.html',
  styleUrl: './reset-password-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResetPasswordDialog {
  private readonly administration = inject(AdministrationDataAccess);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef = inject(MatDialogRef<ResetPasswordDialog, ResetPasswordDialogResult>);
  protected readonly request = inject<AdminPasswordResetRequest>(MAT_DIALOG_DATA);

  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly form = new FormGroup(
    {
      temporaryPassword: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.minLength(8), Validators.maxLength(128)],
      }),
      confirmation: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, passwordMatches],
      }),
    },
    { validators: passwordsMatch },
  );

  constructor() {
    this.form.controls.temporaryPassword.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.errorMessage.set(null);
      this.form.controls.confirmation.updateValueAndValidity({ emitEvent: false });
    });
    this.form.controls.confirmation.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.errorMessage.set(null));
  }

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    this.submitting.set(true);
    this.errorMessage.set(null);
    this.administration
      .resetUserPassword(this.request.id, value.temporaryPassword, value.confirmation)
      .pipe(
        take(1),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.submitting.set(false)),
      )
      .subscribe({
        next: () => {
          this.clearSensitiveFields();
          this.dialogRef.close({
            kind: 'resolved',
            userName: `${this.request.user.firstName} ${this.request.user.lastName}`,
          });
        },
        error: (error: unknown) => this.handleError(normalizeHttpError(error)),
      });
  }

  private handleError(error: AppError): void {
    if (error.kind === 'conflict' && error.code === 'PASSWORD_RESET_REQUEST_RESOLVED') {
      this.clearSensitiveFields();
      this.dialogRef.close({ kind: 'conflict' });
      return;
    }
    if (error.kind === 'conflict' && error.code === 'PASSWORD_RESET_TARGET_INACTIVE') {
      this.errorMessage.set(
        'This account is inactive. Reactivate it before resetting its password.',
      );
      return;
    }
    if (error.kind === 'validation') {
      this.errorMessage.set('Review the temporary password requirements and try again.');
      return;
    }
    this.errorMessage.set(
      error.kind === 'network'
        ? 'PulseDesk could not be reached. The password was not reset.'
        : error.kind === 'unavailable'
          ? 'Password resets are temporarily unavailable. Please try again shortly.'
          : 'The password could not be reset. Please try again.',
    );
  }

  private clearSensitiveFields(): void {
    this.form.reset({ temporaryPassword: '', confirmation: '' });
  }
}
