import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { finalize, take } from 'rxjs';

import { VerificationFactor } from '../../../api/generated/model/verificationFactor';
import { AuthSessionStore } from '../../../platform/auth/auth-session.store';
import { normalizeHttpError } from '../../../platform/http/app-error';
import { ActiveCustomerVerification, Customer, CustomerVerification } from '../domain/customer';
import { CustomersDataAccess } from '../data-access/customers-data-access';

interface FactorOption {
  readonly factor: VerificationFactor;
  readonly label: string;
  readonly prompt: string;
  readonly value: string;
  readonly available: boolean;
}

@Component({
  selector: 'app-customer-verification',
  imports: [MatButtonModule, MatCheckboxModule],
  templateUrl: './customer-verification.component.html',
  styleUrl: './customer-verification.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerVerificationComponent {
  private readonly customers = inject(CustomersDataAccess);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly session = inject(AuthSessionStore);
  readonly customer = input.required<Customer>();
  readonly verification = input<ActiveCustomerVerification | null>(null);
  readonly verified = output<CustomerVerification>();
  protected readonly selected = signal<readonly VerificationFactor[]>([]);
  protected readonly revealed = signal<readonly VerificationFactor[]>([]);
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly options = computed<readonly FactorOption[]>(() => {
    const customer = this.customer();
    return [
      {
        factor: VerificationFactor.DATE_OF_BIRTH,
        label: 'Date of birth',
        prompt: 'What is your date of birth?',
        value: customer.dateOfBirth ?? 'Not recorded',
        available: Boolean(customer.dateOfBirth),
      },
      {
        factor: VerificationFactor.POSTAL_CODE,
        label: 'Postal code',
        prompt: 'What is your postal code?',
        value: customer.postalCode ?? 'Not recorded',
        available: Boolean(customer.postalCode),
      },
      {
        factor: VerificationFactor.ADDRESS,
        label: 'Address',
        prompt: 'What is your address?',
        value:
          [customer.street, customer.houseNumber, customer.city].filter(Boolean).join(' ') ||
          'Not recorded',
        available: Boolean(customer.street && customer.city),
      },
      {
        factor: VerificationFactor.PHONE,
        label: 'Phone',
        prompt: 'What is your phone number?',
        value: customer.phone ?? 'Not recorded',
        available: Boolean(customer.phone),
      },
    ];
  });
  protected readonly verifierName = computed(() => {
    const user = this.session.currentUser();
    return user ? `${user.first_name} ${user.last_name}`.trim() : 'current employee';
  });

  protected toggle(factor: VerificationFactor, checked: boolean): void {
    const current = this.selected();
    this.selected.set(checked ? [...current, factor] : current.filter((item) => item !== factor));
    this.error.set(null);
  }

  protected toggleReveal(factor: VerificationFactor): void {
    const current = this.revealed();
    this.revealed.set(
      current.includes(factor) ? current.filter((item) => item !== factor) : [...current, factor],
    );
  }

  protected submit(): void {
    if (this.selected().length !== 2 || this.submitting()) return;
    this.submitting.set(true);
    this.error.set(null);
    this.customers
      .verify(this.customer().id, this.selected())
      .pipe(
        take(1),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.submitting.set(false)),
      )
      .subscribe({
        next: (verification) => {
          this.selected.set([]);
          this.verified.emit(verification);
        },
        error: (raw: unknown) => {
          const error = normalizeHttpError(raw);
          this.error.set(
            error.code === 'CUSTOMER_VERIFICATION_FACTOR_UNAVAILABLE'
              ? 'One of these factors is no longer available. Reload the profile and try again.'
              : 'Verification could not be recorded. Please try again.',
          );
        },
      });
  }
}
