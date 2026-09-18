import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { vi } from 'vitest';

import { CustomersApi } from '../../../api/generated/api/customers.service';
import { CustomerSearchKind } from '../../../api/generated/model/customerSearchKind';
import { VerificationFactor } from '../../../api/generated/model/verificationFactor';
import { CustomersDataAccess } from './customers-data-access';

describe('CustomersDataAccess', () => {
  const api = {
    listCustomers: vi.fn(),
    searchCustomers: vi.fn(),
    createCustomerVerification: vi.fn(),
  };
  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [CustomersDataAccess, { provide: CustomersApi, useValue: api }],
    });
  });

  it('loads the active directory by default through server pagination', async () => {
    api.listCustomers.mockReturnValue(
      of({ items: [], page: 2, page_size: 20, total: 0, total_pages: 0 }),
    );
    await firstValueFrom(TestBed.inject(CustomersDataAccess).list(true, 2, 20));
    expect(api.listCustomers).toHaveBeenCalledWith(true, 2, 20, 'body', false, {
      transferCache: false,
    });
  });

  it('keeps Customer search kind, value, and pagination in the POST body', async () => {
    api.searchCustomers.mockReturnValue(
      of({ items: [], page: 3, page_size: 10, total: 0, total_pages: 0 }),
    );
    await firstValueFrom(
      TestBed.inject(CustomersDataAccess).search(CustomerSearchKind.NAME, 'Müll', true, 3, 10),
    );
    expect(api.searchCustomers).toHaveBeenCalledWith(
      { kind: CustomerSearchKind.NAME, value: 'Müll', is_active: true, page: 3, page_size: 10 },
      'body',
      false,
      { transferCache: false },
    );
  });

  it('sends verification factor names only', async () => {
    api.createCustomerVerification.mockReturnValue(
      of({
        id: 5,
        customer_id: 8,
        verified_by_user_id: 3,
        factors: [VerificationFactor.DATE_OF_BIRTH, VerificationFactor.PHONE],
        verified_at: '2026-09-18T08:00:00Z',
        expires_at: '2026-09-18T08:30:00Z',
      }),
    );
    await firstValueFrom(
      TestBed.inject(CustomersDataAccess).verify(8, [
        VerificationFactor.DATE_OF_BIRTH,
        VerificationFactor.PHONE,
      ]),
    );
    expect(api.createCustomerVerification).toHaveBeenCalledWith(
      8,
      { factors: [VerificationFactor.DATE_OF_BIRTH, VerificationFactor.PHONE] },
      'body',
      false,
      { transferCache: false },
    );
  });
});
