import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, Subject, throwError } from 'rxjs';
import { vi } from 'vitest';

import { CustomerSearchKind } from '../../../api/generated/model/customerSearchKind';
import { UserRole } from '../../../api/generated/model/userRole';
import { AuthSessionStore } from '../../../platform/auth/auth-session.store';
import { CustomersDataAccess } from '../data-access/customers-data-access';
import { CustomerPage } from '../domain/customer';
import { CustomerListPage } from './customer-list.page';

const EMPTY_PAGE: CustomerPage = {
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 0,
};

const RESULT_PAGE: CustomerPage = {
  items: [
    {
      id: 8,
      customerNumber: 'CUS-000008',
      name: 'Thomas Müller',
      email: 'thomas@example.net',
      phone: '+491701234567',
      city: 'Berlin',
      country: 'DE',
      isActive: true,
    },
  ],
  page: 1,
  pageSize: 20,
  total: 1,
  totalPages: 1,
};

describe('CustomerListPage search-first workflow', () => {
  let fixture: ComponentFixture<CustomerListPage>;
  const customers = {
    list: vi.fn(),
    search:
      vi.fn<
        (
          kind: CustomerSearchKind,
          value: string,
          isActive: boolean | undefined,
          page: number,
          pageSize: number,
        ) => Observable<CustomerPage>
      >(),
  };
  const session = {
    currentUser: vi.fn(() => ({ role: UserRole.EMPLOYEE })),
  };

  async function render(role = UserRole.EMPLOYEE): Promise<void> {
    session.currentUser.mockReturnValue({ role });
    await TestBed.configureTestingModule({
      imports: [CustomerListPage],
      providers: [
        provideRouter([]),
        { provide: AuthSessionStore, useValue: session },
        { provide: CustomersDataAccess, useValue: customers },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CustomerListPage);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    customers.search.mockReturnValue(of(EMPTY_PAGE));
  });

  it('starts in the lookup empty state without fetching or displaying results', async () => {
    await render();

    expect(customers.search).not.toHaveBeenCalled();
    expect(customers.list).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Find a customer');
    expect(fixture.nativeElement.textContent).toContain(
      'Search by name, customer number, email, or phone',
    );
    expect(fixture.nativeElement.textContent).not.toContain(
      'Search is sent securely in the request body.',
    );
    expect(fixture.nativeElement.querySelector('table')).toBeNull();
  });

  it('searches explicitly and displays the returned result table', async () => {
    customers.search.mockReturnValue(of(RESULT_PAGE));
    await render();
    fixture.componentInstance['form'].controls.value.setValue('  Müll  ');

    fixture.componentInstance['submitSearch']();
    fixture.detectChanges();

    expect(customers.search).toHaveBeenCalledWith(CustomerSearchKind.NAME, 'Müll', true, 1, 20);
    expect(fixture.componentInstance['form'].controls.value.value).toBe('');
    expect(fixture.nativeElement.querySelector('table')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Thomas Müller');
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('input[formControlName="value"]'),
    );
  });

  it('clears results without loading a default directory and cancels a stale search', async () => {
    const pending = new Subject<CustomerPage>();
    customers.search.mockReturnValue(pending);
    await render();
    fixture.componentInstance['form'].controls.value.setValue('Thomas');
    fixture.componentInstance['submitSearch']();
    pending.next(RESULT_PAGE);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('table')).not.toBeNull();

    fixture.componentInstance['clearSearch']();
    pending.next(RESULT_PAGE);
    fixture.componentInstance['pageChanged']({ pageIndex: 1, pageSize: 10, length: 20 });
    fixture.detectChanges();

    expect(fixture.componentInstance['state']()).toEqual({ kind: 'idle' });
    expect(fixture.componentInstance['form'].getRawValue()).toEqual({
      kind: CustomerSearchKind.NAME,
      value: '',
      includeInactive: false,
    });
    expect(fixture.nativeElement.textContent).toContain('Find a customer');
    expect(fixture.nativeElement.querySelector('table')).toBeNull();
    expect(customers.search).toHaveBeenCalledTimes(1);
    expect(customers.list).not.toHaveBeenCalled();
  });

  it('preserves the active POST-body search when changing result pages', async () => {
    customers.search.mockReturnValue(of(RESULT_PAGE));
    await render();
    fixture.componentInstance['form'].setValue({
      kind: CustomerSearchKind.EMAIL,
      value: 'thomas@example.net',
      includeInactive: false,
    });
    fixture.componentInstance['submitSearch']();

    expect(fixture.componentInstance['form'].controls.value.value).toBe('');

    fixture.componentInstance['pageChanged']({ pageIndex: 2, pageSize: 10, length: 30 });
    fixture.detectChanges();

    expect(customers.search).toHaveBeenLastCalledWith(
      CustomerSearchKind.EMAIL,
      'thomas@example.net',
      true,
      3,
      10,
    );
    expect(fixture.nativeElement.textContent).toContain('Thomas Müller');
  });

  it('preserves the entered value when a search fails', async () => {
    customers.search.mockReturnValue(throwError(() => new Error('offline')));
    await render();
    fixture.componentInstance['form'].controls.value.setValue('Müll');

    fixture.componentInstance['submitSearch']();
    fixture.detectChanges();

    expect(fixture.componentInstance['form'].controls.value.value).toBe('Müll');
    expect(fixture.componentInstance['state']().kind).toBe('error');
  });

  it('ignores a stale response after a newer search starts', async () => {
    const first = new Subject<CustomerPage>();
    const second = new Subject<CustomerPage>();
    customers.search.mockReturnValueOnce(first).mockReturnValueOnce(second);
    await render();
    fixture.componentInstance['form'].controls.value.setValue('Thomas');
    fixture.componentInstance['submitSearch']();
    fixture.componentInstance['form'].controls.value.setValue('Müll');
    fixture.componentInstance['submitSearch']();

    first.next(RESULT_PAGE);
    fixture.detectChanges();
    expect(fixture.componentInstance['state']().kind).toBe('loading');
    expect(fixture.componentInstance['form'].controls.value.value).toBe('Müll');

    second.next(RESULT_PAGE);
    fixture.detectChanges();
    expect(fixture.componentInstance['state']().kind).toBe('loaded');
    expect(fixture.componentInstance['form'].controls.value.value).toBe('');
  });

  it('keeps the ADMIN inactive-only option explicit until Search is performed', async () => {
    await render(UserRole.ADMIN);
    fixture.componentInstance['form'].setValue({
      kind: CustomerSearchKind.CUSTOMER_NUMBER,
      value: 'CUS-000008',
      includeInactive: true,
    });
    fixture.detectChanges();

    expect(customers.search).not.toHaveBeenCalled();
    fixture.componentInstance['submitSearch']();

    expect(customers.search).toHaveBeenCalledWith(
      CustomerSearchKind.CUSTOMER_NUMBER,
      'CUS-000008',
      false,
      1,
      20,
    );
  });
});
