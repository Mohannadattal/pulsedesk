import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';
import { finalize, take } from 'rxjs';

import { AuthSessionStore } from '../../platform/auth/auth-session.store';
import { AppError, normalizeHttpError } from '../../platform/http/app-error';

function passwordsMatch(control: AbstractControl): ValidationErrors | null {
  const password = control.get('newPassword')?.value;
  const confirmation = control.get('confirmNewPassword')?.value;
  return password === confirmation ? null : { passwordMismatch: true };
}

function passwordMatches(control: AbstractControl): ValidationErrors | null {
  const password = control.parent?.get('newPassword')?.value;
  return password === undefined || password === control.value ? null : { passwordMismatch: true };
}

@Component({
  selector: 'app-set-password-page',
  imports: [
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    ReactiveFormsModule,
  ],
  templateUrl: './set-password.page.html',
  styleUrl: './set-password.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetPasswordPage {
  private readonly session = inject(AuthSessionStore);
  private readonly router = inject(Router);

  protected readonly submitting = signal(false);
  protected readonly serverError = signal<string | null>(null);
  protected readonly form = new FormGroup(
    {
      newPassword: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.minLength(8), Validators.maxLength(128)],
      }),
      confirmNewPassword: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, passwordMatches],
      }),
    },
    { validators: passwordsMatch },
  );

  constructor() {
    this.form.controls.newPassword.valueChanges.subscribe(() => {
      this.serverError.set(null);
      this.form.controls.confirmNewPassword.updateValueAndValidity({ emitEvent: false });
    });
    this.form.controls.confirmNewPassword.valueChanges.subscribe(() => this.serverError.set(null));
  }

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    this.submitting.set(true);
    this.serverError.set(null);
    this.session
      .completePasswordChange({
        new_password: value.newPassword,
        confirm_new_password: value.confirmNewPassword,
      })
      .pipe(
        take(1),
        finalize(() => this.submitting.set(false)),
      )
      .subscribe({
        next: () => {
          this.form.reset();
          void this.router.navigateByUrl('/tickets');
        },
        error: (error: unknown) => this.serverError.set(this.messageForError(error)),
      });
  }

  private messageForError(error: unknown): string {
    const appError: AppError = normalizeHttpError(error);
    if (appError.code === 'PASSWORD_REUSE_NOT_ALLOWED') {
      return 'Choose a password that is different from your temporary password.';
    }
    if (appError.code === 'PASSWORD_CONFIRMATION_MISMATCH') {
      return 'The password confirmation does not match.';
    }
    if (appError.kind === 'validation') return 'Review the password requirements and try again.';
    if (appError.kind === 'authentication') {
      return 'This password-change session is no longer valid. Sign in again.';
    }
    if (appError.kind === 'network') {
      return 'PulseDesk could not be reached. Check your connection and try again.';
    }
    if (appError.kind === 'unavailable') {
      return 'Password replacement is temporarily unavailable. Please try again shortly.';
    }
    return 'Your password could not be replaced. Please try again.';
  }
}
