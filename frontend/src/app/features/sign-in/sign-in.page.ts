import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize, take } from 'rxjs';

import { AuthSessionStore } from '../../platform/auth/auth-session.store';
import { safeLocalReturnUrl } from '../../platform/auth/return-url';
import { AppError, normalizeHttpError } from '../../platform/http/app-error';

@Component({
  selector: 'app-sign-in-page',
  imports: [
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    ReactiveFormsModule,
  ],
  templateUrl: './sign-in.page.html',
  styleUrl: './sign-in.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignInPage {
  private readonly session = inject(AuthSessionStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly submitting = signal(false);
  protected readonly serverError = signal<string | null>(null);
  protected readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.serverError.set(null);

    this.session
      .signIn(this.form.getRawValue())
      .pipe(
        take(1),
        finalize(() => this.submitting.set(false)),
      )
      .subscribe({
        next: () => {
          const returnUrl = safeLocalReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'));
          void this.router.navigateByUrl(returnUrl ?? '/tickets');
        },
        error: (error: unknown) => this.serverError.set(this.messageForError(error)),
      });
  }

  private messageForError(error: unknown): string {
    const appError: AppError = normalizeHttpError(error);
    switch (appError.kind) {
      case 'authentication':
        return 'The email or password is incorrect.';
      case 'network':
        return 'PulseDesk could not be reached. Check your connection and try again.';
      case 'unavailable':
        return 'PulseDesk is temporarily unavailable. Please try again shortly.';
      default:
        return 'Sign-in could not be completed. Please try again.';
    }
  }
}
