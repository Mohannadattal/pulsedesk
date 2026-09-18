import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { Router, RouterLink } from '@angular/router';
import { finalize, take } from 'rxjs';

import { CustomerCreate } from '../../../api/generated/model/customerCreate';
import { ConfirmationDialogComponent } from '../../administration/confirmation-dialog.component';
import { AppError, normalizeHttpError } from '../../../platform/http/app-error';
import { CustomerFormComponent, CustomerFormValue } from '../customer-form/customer-form.component';
import { CustomersDataAccess } from '../data-access/customers-data-access';

@Component({
  selector: 'app-customer-create-page',
  imports: [CustomerFormComponent, RouterLink],
  templateUrl: './customer-create.page.html',
  styleUrl: './customer-create.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerCreatePage {
  private readonly customers = inject(CustomersDataAccess);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  protected readonly submitting = signal(false);
  protected readonly formError = signal<string | null>(null);
  private pendingValue: CustomerFormValue | null = null;

  protected save(value: CustomerFormValue): void {
    this.pendingValue = value;
    this.submit({ ...value, confirm_possible_duplicate: false });
  }

  protected cancel(): void {
    void this.router.navigate(['/customers']);
  }

  private submit(request: CustomerCreate): void {
    if (this.submitting()) return;
    this.formError.set(null);
    this.submitting.set(true);
    this.customers
      .create(request)
      .pipe(
        take(1),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.submitting.set(false)),
      )
      .subscribe({
        next: (customer) => void this.router.navigate(['/customers', customer.id]),
        error: (error: unknown) => this.handleError(normalizeHttpError(error)),
      });
  }

  private handleError(error: AppError): void {
    if (error.code === 'CUSTOMER_POTENTIAL_DUPLICATE' && this.pendingValue) {
      const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
        data: {
          title: 'Possible existing customer',
          message:
            'A customer with matching contact or identity details may already exist. Review the information, or deliberately create a separate customer.',
          confirmLabel: 'Create anyway',
        },
      });
      dialogRef
        .afterClosed()
        .pipe(take(1), takeUntilDestroyed(this.destroyRef))
        .subscribe((confirmed) => {
          if (confirmed && this.pendingValue) {
            this.submit({ ...this.pendingValue, confirm_possible_duplicate: true });
          }
        });
      return;
    }
    this.formError.set(
      error.code === 'CUSTOMER_CONTACT_REQUIRED'
        ? 'Enter at least one contact method.'
        : error.kind === 'validation'
          ? 'Some customer details were not accepted. Review the form and try again.'
          : 'The customer could not be created. Please try again.',
    );
  }
}
