import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  catchError,
  combineLatest,
  finalize,
  map,
  of,
  startWith,
  Subject,
  switchMap,
  take,
} from 'rxjs';

import { CustomerUpdate } from '../../../api/generated/model/customerUpdate';
import { UserRole } from '../../../api/generated/model/userRole';
import { AuthSessionStore } from '../../../platform/auth/auth-session.store';
import { AppError, normalizeHttpError } from '../../../platform/http/app-error';
import { PageMessageComponent } from '../../../shared/ui/page-message/page-message.component';
import { DateOnlyPipe } from '../../../shared/util/date-only.pipe';
import { LocalDateTimePipe } from '../../../shared/util/local-date-time.pipe';
import { ConfirmationDialogComponent } from '../../administration/confirmation-dialog.component';
import { TicketsDataAccess } from '../../tickets/data-access/tickets-data-access';
import { Category } from '../../tickets/domain/category';
import { TicketPage } from '../../tickets/domain/ticket';
import { CustomerFormComponent, CustomerFormValue } from '../customer-form/customer-form.component';
import { CustomersDataAccess } from '../data-access/customers-data-access';
import { Customer, CustomerVerification } from '../domain/customer';
import { CustomerVerificationComponent } from '../verification/customer-verification.component';

type DetailState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly customer: Customer }
  | { readonly kind: 'error'; readonly error: AppError };
type HistoryState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly page: TicketPage }
  | { readonly kind: 'error' };

@Component({
  selector: 'app-customer-detail-page',
  imports: [
    CustomerFormComponent,
    CustomerVerificationComponent,
    DateOnlyPipe,
    LocalDateTimePipe,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatSelectModule,
    PageMessageComponent,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './customer-detail.page.html',
  styleUrl: './customer-detail.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly customers = inject(CustomersDataAccess);
  private readonly tickets = inject(TicketsDataAccess);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly session = inject(AuthSessionStore);
  protected readonly isAdmin = this.session.currentUser()?.role === UserRole.ADMIN;
  protected readonly state = signal<DetailState>({ kind: 'loading' });
  protected readonly history = signal<HistoryState>({ kind: 'loading' });
  protected readonly verification = signal<CustomerVerification | null>(null);
  protected readonly editMode = signal(false);
  protected readonly editing = signal(false);
  protected readonly editError = signal<string | null>(null);
  protected readonly activationPending = signal(false);
  protected readonly createTicketOpen = signal(false);
  protected readonly ticketSubmitting = signal(false);
  protected readonly ticketError = signal<string | null>(null);
  protected readonly categories = signal<readonly Category[]>([]);
  protected readonly categoriesLoading = signal(true);
  protected readonly ticketForm = new FormGroup({
    title: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(200)],
    }),
    description: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    categoryId: new FormControl<number | null>(null, Validators.required),
  });
  private readonly retries = new Subject<void>();
  private readonly historyRequests = new Subject<{ page: number; pageSize: number }>();
  private customerId: number | null = null;
  private pendingPatch: CustomerUpdate | null = null;
  private verificationExpiryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    combineLatest([this.route.paramMap, this.retries.pipe(startWith(undefined))])
      .pipe(
        map(([params]) => parseId(params.get('customerId'))),
        switchMap((customerId) => {
          this.customerId = customerId;
          this.verification.set(null);
          this.editMode.set(false);
          if (customerId === null)
            return of<DetailState>({ kind: 'error', error: new AppError('not-found', 404) });
          return this.customers.get(customerId).pipe(
            map((customer): DetailState => ({ kind: 'loaded', customer })),
            startWith<DetailState>({ kind: 'loading' }),
            catchError((error: unknown) =>
              of<DetailState>({ kind: 'error', error: normalizeHttpError(error) }),
            ),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((state) => {
        this.state.set(state);
        if (state.kind === 'loaded') this.historyRequests.next({ page: 1, pageSize: 10 });
      });

    this.historyRequests
      .pipe(
        switchMap((request) =>
          this.customerId === null
            ? of<HistoryState>({ kind: 'error' })
            : this.customers.listTickets(this.customerId, request.page, request.pageSize).pipe(
                map((page): HistoryState => ({ kind: 'loaded', page })),
                startWith<HistoryState>({ kind: 'loading' }),
                catchError(() => of<HistoryState>({ kind: 'error' })),
              ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.history.set(state));

    this.tickets
      .listActiveCategories()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (categories) => {
          this.categories.set(categories);
          this.categoriesLoading.set(false);
        },
        error: () => this.categoriesLoading.set(false),
      });
  }

  protected retry(): void {
    this.retries.next();
  }
  protected canEdit(customer: Customer): boolean {
    return customer.isActive || this.isAdmin;
  }
  protected acceptVerification(value: CustomerVerification): void {
    this.verification.set(value);
    clearTimeout(this.verificationExpiryTimer);
    const delay = Math.max(0, value.expiresAt.getTime() - Date.now());
    this.verificationExpiryTimer = setTimeout(
      () => this.verification.set(null),
      Math.min(delay, 2_147_483_647),
    );
  }
  protected verificationIsValid(): boolean {
    const value = this.verification();
    return Boolean(value && value.expiresAt.getTime() > Date.now());
  }

  protected saveEdit(value: CustomerFormValue, customer: Customer): void {
    const patch = customerPatch(customer, value);
    if (Object.keys(patch).length === 0) {
      this.editMode.set(false);
      return;
    }
    this.pendingPatch = patch;
    this.submitEdit(customer.id, { ...patch, confirm_possible_duplicate: false });
  }

  private submitEdit(customerId: number, patch: CustomerUpdate): void {
    if (this.editing()) return;
    this.editing.set(true);
    this.editError.set(null);
    this.customers
      .update(customerId, patch)
      .pipe(
        take(1),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.editing.set(false)),
      )
      .subscribe({
        next: (customer) => {
          this.state.set({ kind: 'loaded', customer });
          this.editMode.set(false);
          this.pendingPatch = null;
        },
        error: (raw: unknown) => {
          const error = normalizeHttpError(raw);
          if (error.code === 'CUSTOMER_POTENTIAL_DUPLICATE' && this.pendingPatch) {
            this.dialog
              .open(ConfirmationDialogComponent, {
                data: {
                  title: 'Possible existing customer',
                  message:
                    'These changes match another customer. Review them, or deliberately save anyway.',
                  confirmLabel: 'Save anyway',
                },
              })
              .afterClosed()
              .pipe(take(1), takeUntilDestroyed(this.destroyRef))
              .subscribe((confirmed) => {
                if (confirmed && this.pendingPatch)
                  this.submitEdit(customerId, {
                    ...this.pendingPatch,
                    confirm_possible_duplicate: true,
                  });
              });
          } else
            this.editError.set(
              error.code === 'CUSTOMER_CONTACT_REQUIRED'
                ? 'At least one contact method must remain.'
                : 'The changes could not be saved. Review the form and try again.',
            );
        },
      });
  }

  protected changeActivation(customer: Customer): void {
    const activating = !customer.isActive;
    const run = () => {
      this.activationPending.set(true);
      this.customers
        .updateActivation(customer.id, activating)
        .pipe(
          take(1),
          takeUntilDestroyed(this.destroyRef),
          finalize(() => this.activationPending.set(false)),
        )
        .subscribe({
          next: (updated) => {
            this.state.set({ kind: 'loaded', customer: updated });
            if (!updated.isActive) {
              this.editMode.set(false);
              this.verification.set(null);
              this.createTicketOpen.set(false);
            }
          },
          error: () =>
            this.editError.set('The customer status could not be changed. Please try again.'),
        });
    };
    if (activating) {
      run();
      return;
    }
    this.dialog
      .open(ConfirmationDialogComponent, {
        data: {
          title: 'Deactivate customer?',
          message:
            'This prevents further employee edits, verification, and customer-linked ticket creation until an administrator reactivates the customer.',
          confirmLabel: 'Deactivate',
        },
      })
      .afterClosed()
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (confirmed) run();
      });
  }

  protected createTicket(customer: Customer): void {
    if (this.ticketForm.invalid || this.ticketSubmitting()) {
      this.ticketForm.markAllAsTouched();
      return;
    }
    const value = this.ticketForm.getRawValue();
    if (value.categoryId === null) return;
    const verification = this.verificationIsValid() ? this.verification() : null;
    this.ticketSubmitting.set(true);
    this.ticketError.set(null);
    this.tickets
      .create({
        title: value.title.trim(),
        description: value.description.trim(),
        category_id: value.categoryId,
        customer_id: customer.id,
        ...(verification ? { customer_verification_id: verification.id } : {}),
      })
      .pipe(
        take(1),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.ticketSubmitting.set(false)),
      )
      .subscribe({
        next: (ticket) => {
          this.historyRequests.next({ page: 1, pageSize: 10 });
          void this.router.navigate(['/tickets', ticket.id]);
        },
        error: (raw: unknown) => {
          const error = normalizeHttpError(raw);
          if (error.code === 'CUSTOMER_VERIFICATION_INVALID') {
            this.verification.set(null);
            this.ticketError.set(
              'Verification expired or is no longer valid. Verify again, or create the ticket without verification.',
            );
          } else this.ticketError.set('The ticket could not be created. Please try again.');
        },
      });
  }

  protected historyPage(event: PageEvent): void {
    this.historyRequests.next({ page: event.pageIndex + 1, pageSize: event.pageSize });
  }
  protected enumLabel(value: string): string {
    return value
      .toLowerCase()
      .split('_')
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join(' ');
  }
  protected addressLine(...parts: readonly (string | null)[]): string {
    return parts.filter((part): part is string => Boolean(part)).join(' ');
  }
}

function parseId(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}
function customerPatch(customer: Customer, value: CustomerFormValue): CustomerUpdate {
  const original: Record<keyof CustomerFormValue, string | null> = {
    first_name: customer.firstName,
    last_name: customer.lastName,
    date_of_birth: customer.dateOfBirth,
    email: customer.email,
    phone: customer.phone,
    street: customer.street,
    house_number: customer.houseNumber,
    postal_code: customer.postalCode,
    city: customer.city,
    country: customer.country,
  };
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, fieldValue]) => original[key as keyof CustomerFormValue] !== fieldValue,
    ),
  ) as CustomerUpdate;
}
