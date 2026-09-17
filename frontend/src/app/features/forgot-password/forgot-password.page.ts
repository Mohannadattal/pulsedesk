import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { finalize, take } from 'rxjs';

import { AuthApi } from '../../platform/auth/auth-api';
import { AppError, normalizeHttpError } from '../../platform/http/app-error';

const GENERIC_SUCCESS =
  'If an account exists for this email, a password reset request has been submitted.';

@Component({
  selector: 'app-forgot-password-page',
  imports: [
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './forgot-password.page.html',
  styleUrl: './forgot-password.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForgotPasswordPage {
  private readonly authApi = inject(AuthApi);

  protected readonly submitting = signal(false);
  protected readonly successMessage = signal<string | null>(null);
  protected readonly serverError = signal<string | null>(null);
  protected readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email, Validators.maxLength(255)],
    }),
  });

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.serverError.set(null);
    this.successMessage.set(null);
    this.authApi
      .requestPasswordReset({ email: this.form.controls.email.value.trim() })
      .pipe(
        take(1),
        finalize(() => this.submitting.set(false)),
      )
      .subscribe({
        next: () => this.successMessage.set(GENERIC_SUCCESS),
        error: (error: unknown) => this.serverError.set(this.messageForError(error)),
      });
  }

  private messageForError(error: unknown): string {
    const appError: AppError = normalizeHttpError(error);
    if (appError.kind === 'network') {
      return 'PulseDesk could not be reached. Check your connection and try again.';
    }
    if (appError.kind === 'unavailable') {
      return 'Password reset requests are temporarily unavailable. Please try again shortly.';
    }
    return 'The request could not be submitted. Please try again.';
  }
}
