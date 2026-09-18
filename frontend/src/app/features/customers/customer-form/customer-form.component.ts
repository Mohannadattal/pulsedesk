import { ChangeDetectionStrategy, Component, effect, input, output } from '@angular/core';
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

import { CustomerCreate } from '../../../api/generated/model/customerCreate';
import { CustomerUpdate } from '../../../api/generated/model/customerUpdate';
import { Customer } from '../domain/customer';

export type CustomerFormValue = Omit<CustomerCreate, 'confirm_possible_duplicate'>;

const contactRequired: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
  const email = group.get('email')?.value?.trim();
  const phone = group.get('phone')?.value?.trim();
  return email || phone ? null : { contactRequired: true };
};

const e164 = Validators.pattern(/^\+[1-9][0-9]{1,14}$/);
const countryCode = Validators.pattern(/^[A-Za-z]{2}$/);

@Component({
  selector: 'app-customer-form',
  imports: [MatButtonModule, MatFormFieldModule, MatInputModule, ReactiveFormsModule],
  templateUrl: './customer-form.component.html',
  styleUrl: './customer-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerFormComponent {
  readonly customer = input<Customer | null>(null);
  readonly submitting = input(false);
  readonly submitLabel = input('Save customer');
  readonly formError = input<string | null>(null);
  readonly saved = output<CustomerFormValue>();
  readonly cancelled = output<void>();

  readonly form = new FormGroup(
    {
      firstName: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(100)],
      }),
      lastName: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(100)],
      }),
      dateOfBirth: new FormControl<string | null>(null),
      email: new FormControl<string | null>(null, [Validators.email, Validators.maxLength(254)]),
      phone: new FormControl<string | null>(null, [e164, Validators.maxLength(16)]),
      street: new FormControl<string | null>(null, Validators.maxLength(150)),
      houseNumber: new FormControl<string | null>(null, Validators.maxLength(30)),
      postalCode: new FormControl<string | null>(null, Validators.maxLength(20)),
      city: new FormControl<string | null>(null, Validators.maxLength(100)),
      country: new FormControl<string | null>(null, [countryCode, Validators.maxLength(2)]),
    },
    { validators: [contactRequired] },
  );

  private initializedCustomerId: number | null | undefined;

  constructor() {
    effect(() => this.syncCustomer());
  }

  private syncCustomer(): void {
    const customer = this.customer();
    const customerId = customer?.id ?? null;
    if (customerId === this.initializedCustomerId) {
      return;
    }
    this.initializedCustomerId = customerId;
    if (customer) {
      this.form.reset({
        firstName: customer.firstName,
        lastName: customer.lastName,
        dateOfBirth: customer.dateOfBirth,
        email: customer.email,
        phone: customer.phone,
        street: customer.street,
        houseNumber: customer.houseNumber,
        postalCode: customer.postalCode,
        city: customer.city,
        country: customer.country,
      });
    }
  }

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    this.saved.emit({
      first_name: value.firstName.trim(),
      last_name: value.lastName.trim(),
      date_of_birth: optional(value.dateOfBirth),
      email: optional(value.email)?.toLowerCase() ?? null,
      phone: optional(value.phone),
      street: optional(value.street),
      house_number: optional(value.houseNumber),
      postal_code: optional(value.postalCode),
      city: optional(value.city),
      country: optional(value.country)?.toUpperCase() ?? null,
    });
  }

  toPatch(value: CustomerFormValue): CustomerUpdate {
    const customer = this.customer();
    if (!customer) {
      return value;
    }
    const original: CustomerFormValue = {
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
}

function optional(value: string | null): string | null {
  const normalized = value?.trim() ?? '';
  return normalized || null;
}
