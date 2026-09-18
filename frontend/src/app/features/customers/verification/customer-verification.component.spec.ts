import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';
import { vi } from 'vitest';

import { UserRole } from '../../../api/generated/model/userRole';
import { VerificationFactor } from '../../../api/generated/model/verificationFactor';
import { AuthSessionStore } from '../../../platform/auth/auth-session.store';
import { CustomersDataAccess } from '../data-access/customers-data-access';
import { Customer, CustomerVerification } from '../domain/customer';
import { CustomerVerificationComponent } from './customer-verification.component';

const CUSTOMER: Customer = {
  id: 8,
  customerNumber: 'CUS-000008',
  name: 'Thomas Müller',
  firstName: 'Thomas',
  lastName: 'Müller',
  dateOfBirth: '1987-04-12',
  email: 'thomas@example.net',
  phone: '+491701234567',
  street: 'Hauptstraße',
  houseNumber: '4',
  postalCode: '10115',
  city: 'Berlin',
  country: 'DE',
  isActive: true,
  createdAt: new Date('2026-09-01T08:00:00Z'),
  updatedAt: new Date('2026-09-18T08:00:00Z'),
};

const VERIFICATION: CustomerVerification = {
  id: 5,
  customerId: CUSTOMER.id,
  verifiedByUserId: 3,
  factors: [VerificationFactor.DATE_OF_BIRTH, VerificationFactor.POSTAL_CODE],
  verifiedAt: new Date('2026-09-18T08:00:00Z'),
  expiresAt: new Date('2026-09-18T08:30:00Z'),
};

describe('CustomerVerificationComponent disclosure', () => {
  let fixture: ComponentFixture<CustomerVerificationComponent>;
  const customers = {
    verify:
      vi.fn<
        (
          customerId: number,
          factors: readonly VerificationFactor[],
        ) => Observable<CustomerVerification>
      >(),
  };
  const session = {
    currentUser: vi.fn(() => ({
      first_name: 'Erika',
      last_name: 'Employee',
      role: UserRole.EMPLOYEE,
    })),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    customers.verify.mockReturnValue(of(VERIFICATION));
    await TestBed.configureTestingModule({
      imports: [CustomerVerificationComponent],
      providers: [
        { provide: AuthSessionStore, useValue: session },
        { provide: CustomersDataAccess, useValue: customers },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CustomerVerificationComponent);
    fixture.componentRef.setInput('customer', CUSTOMER);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('hides stored values initially and offers a reveal control for every available factor', () => {
    const text = fixture.nativeElement.textContent;
    const revealButtons = [...fixture.nativeElement.querySelectorAll('button')].filter(
      (button: HTMLButtonElement) => button.textContent?.includes('Show stored value'),
    );

    expect(text).toContain('What is your date of birth?');
    expect(text).not.toContain('1987-04-12');
    expect(text).not.toContain('10115');
    expect(text).not.toContain('+491701234567');
    expect(revealButtons).toHaveLength(4);
  });

  it('reveals and hides one stored value without disclosing the other factors', () => {
    fixture.componentInstance['toggleReveal'](VerificationFactor.DATE_OF_BIRTH);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Stored value: 1987-04-12');
    expect(fixture.nativeElement.textContent).not.toContain('10115');
    expect(fixture.nativeElement.textContent).not.toContain('+491701234567');

    fixture.componentInstance['toggleReveal'](VerificationFactor.DATE_OF_BIRTH);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('1987-04-12');
  });

  it('keeps selection independent from reveal state and enforces exactly two factors', () => {
    fixture.componentInstance['toggleReveal'](VerificationFactor.PHONE);
    fixture.componentInstance['toggle'](VerificationFactor.DATE_OF_BIRTH, true);
    fixture.componentInstance['submit']();
    expect(customers.verify).not.toHaveBeenCalled();

    fixture.componentInstance['toggle'](VerificationFactor.POSTAL_CODE, true);
    fixture.componentInstance['submit']();

    expect(customers.verify).toHaveBeenCalledWith(CUSTOMER.id, [
      VerificationFactor.DATE_OF_BIRTH,
      VerificationFactor.POSTAL_CODE,
    ]);
    expect(customers.verify.mock.calls[0][1]).not.toContain(CUSTOMER.phone);
    expect(customers.verify.mock.calls[0][1]).not.toContain(CUSTOMER.dateOfBirth);
  });

  it('emits the unchanged verification success and backend expiry', () => {
    const emitted: CustomerVerification[] = [];
    fixture.componentInstance.verified.subscribe((value) => emitted.push(value));
    fixture.componentInstance['toggle'](VerificationFactor.ADDRESS, true);
    fixture.componentInstance['toggle'](VerificationFactor.PHONE, true);

    fixture.componentInstance['submit']();

    expect(emitted).toEqual([VERIFICATION]);
    expect(emitted[0].expiresAt).toEqual(new Date('2026-09-18T08:30:00Z'));
  });
});
