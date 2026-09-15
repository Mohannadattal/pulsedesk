import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';
import { catchError, finalize, map, of, startWith, Subject, switchMap, take } from 'rxjs';

import { AppError, normalizeHttpError } from '../../../platform/http/app-error';
import { PageMessageComponent } from '../../../shared/ui/page-message/page-message.component';
import { TicketsDataAccess } from '../data-access/tickets-data-access';
import { Category } from '../domain/category';
import { PendingTicketChanges } from './pending-ticket-changes.guard';

type CategoriesState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly items: readonly Category[] }
  | { readonly kind: 'error'; readonly error: AppError };

type CreateField = 'title' | 'description' | 'categoryId';

const nonWhitespace: ValidatorFn = (control: AbstractControl<string>): ValidationErrors | null =>
  control.value.trim().length > 0 ? null : { whitespace: true };

const maxUtf8Bytes =
  (maximum: number): ValidatorFn =>
  (control: AbstractControl<string>): ValidationErrors | null =>
    new TextEncoder().encode(control.value).length <= maximum ? null : { maxUtf8Bytes: true };

@Component({
  selector: 'app-create-ticket-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    PageMessageComponent,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './create-ticket.page.html',
  styleUrl: './create-ticket.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateTicketPage implements PendingTicketChanges {
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly tickets = inject(TicketsDataAccess);
  private readonly categoryRetries = new Subject<void>();
  private submissionSucceeded = false;

  readonly form = new FormGroup({
    title: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, nonWhitespace, Validators.maxLength(200)],
    }),
    description: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, nonWhitespace, maxUtf8Bytes(65_535)],
    }),
    categoryId: new FormControl<number | null>(null, { validators: [Validators.required] }),
  });

  protected readonly categoriesState = signal<CategoriesState>({ kind: 'loading' });
  protected readonly submitting = signal(false);
  protected readonly submissionError = signal<string | null>(null);
  protected readonly categoryRecoveryNeeded = signal(false);
  protected readonly serverFieldMessages = signal<Partial<Record<CreateField, string>>>({});

  constructor() {
    this.categoryRetries
      .pipe(
        startWith(undefined),
        switchMap(() =>
          this.tickets.listActiveCategories().pipe(
            map((items): CategoriesState => ({ kind: 'loaded', items })),
            startWith<CategoriesState>({ kind: 'loading' }),
            catchError((error: unknown) =>
              of<CategoriesState>({ kind: 'error', error: normalizeHttpError(error) }),
            ),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.updateCategoriesState(state));

    this.form.controls.title.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.clearServerError('title'));
    this.form.controls.description.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.clearServerError('description'));
    this.form.controls.categoryId.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.clearServerError('categoryId'));
  }

  hasUnsavedChanges(): boolean {
    if (this.submissionSucceeded) {
      return false;
    }
    const value = this.form.getRawValue();
    return Boolean(value.title.trim() || value.description.trim() || value.categoryId !== null);
  }

  @HostListener('window:beforeunload', ['$event'])
  protected protectBrowserNavigation(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  protected retryCategories(): void {
    this.submissionError.set(null);
    this.categoryRecoveryNeeded.set(false);
    this.categoryRetries.next();
  }

  protected submit(): void {
    if (this.form.invalid || this.submitting() || !this.hasAvailableCategories()) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    if (value.categoryId === null) {
      return;
    }

    this.clearAllServerErrors();
    this.submissionError.set(null);
    this.submitting.set(true);
    this.tickets
      .create({
        title: value.title.trim(),
        description: value.description.trim(),
        category_id: value.categoryId,
      })
      .pipe(
        take(1),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.submitting.set(false)),
      )
      .subscribe({
        next: (ticket) => {
          this.submissionSucceeded = true;
          this.form.markAsPristine();
          void this.router.navigate(['/tickets', ticket.id]);
        },
        error: (error: unknown) => this.handleSubmissionError(normalizeHttpError(error)),
      });
  }

  protected categoriesErrorTitle(error: AppError): string {
    switch (error.kind) {
      case 'forbidden':
        return 'Categories are not available to this account';
      case 'network':
        return 'PulseDesk could not be reached';
      case 'unavailable':
        return 'Categories are temporarily unavailable';
      default:
        return 'Categories could not be loaded';
    }
  }

  protected hasAvailableCategories(): boolean {
    const state = this.categoriesState();
    return state.kind === 'loaded' && state.items.length > 0;
  }

  private handleSubmissionError(error: AppError): void {
    if (error.kind === 'validation') {
      const messages: Partial<Record<CreateField, string>> = {};
      for (const validationError of error.validationErrors) {
        const field = this.formFieldFor(validationError.field);
        if (field && !messages[field]) {
          messages[field] = validationError.message;
          this.form.controls[field].setErrors({
            ...this.form.controls[field].errors,
            server: true,
          });
        }
      }
      this.serverFieldMessages.set(messages);
      if (Object.keys(messages).length > 0) {
        return;
      }
    }

    this.categoryRecoveryNeeded.set(['not-found', 'conflict'].includes(error.kind));
    this.submissionError.set(this.submissionErrorMessage(error));
  }

  private updateCategoriesState(state: CategoriesState): void {
    this.categoriesState.set(state);
    if (state.kind !== 'loaded') {
      return;
    }

    const selectedCategoryId = this.form.controls.categoryId.value;
    if (
      selectedCategoryId !== null &&
      !state.items.some((category) => category.id === selectedCategoryId)
    ) {
      this.form.controls.categoryId.setValue(null);
    }
  }

  private submissionErrorMessage(error: AppError): string {
    switch (error.kind) {
      case 'forbidden':
        return 'Your account does not have permission to create this ticket.';
      case 'not-found':
      case 'conflict':
        return 'The selected category is no longer available. Reload the categories and try again.';
      case 'network':
        return 'PulseDesk could not be reached. Check your connection and try again.';
      case 'unavailable':
        return 'Ticket creation is temporarily unavailable. Please try again shortly.';
      case 'validation':
        return 'Some ticket details were not accepted. Review the form and try again.';
      default:
        return 'The ticket could not be created. Please try again.';
    }
  }

  private formFieldFor(field: string): CreateField | undefined {
    switch (field) {
      case 'title':
        return 'title';
      case 'description':
        return 'description';
      case 'category_id':
        return 'categoryId';
      default:
        return undefined;
    }
  }

  private clearAllServerErrors(): void {
    this.serverFieldMessages.set({});
    this.submissionError.set(null);
    this.categoryRecoveryNeeded.set(false);
    for (const control of Object.values(this.form.controls)) {
      if (control.hasError('server')) {
        const remainingErrors = { ...control.errors };
        delete remainingErrors['server'];
        control.setErrors(Object.keys(remainingErrors).length > 0 ? remainingErrors : null);
      }
    }
  }

  private clearServerError(field: CreateField): void {
    this.submissionError.set(null);
    const messages = { ...this.serverFieldMessages() };
    delete messages[field];
    this.serverFieldMessages.set(messages);

    const control = this.form.controls[field];
    if (control.hasError('server')) {
      const remainingErrors = { ...control.errors };
      delete remainingErrors['server'];
      control.setErrors(Object.keys(remainingErrors).length > 0 ? remainingErrors : null);
    }
  }
}
