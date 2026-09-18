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
    getCurrentCustomerVerification: vi.fn(),
    createCustomerVerification: vi.fn(),
    lookupCustomerTicket: vi.fn(),
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

  it('maps the safe current-verification projection without browser persistence', async () => {
    api.getCurrentCustomerVerification.mockReturnValue(
      of({
        verification: {
          id: 25,
          customer_id: 8,
          verified_at: '2026-09-18T08:00:00Z',
          expires_at: '2026-09-18T08:30:00Z',
        },
      }),
    );

    const current = await firstValueFrom(
      TestBed.inject(CustomersDataAccess).getCurrentVerification(8),
    );

    expect(api.getCurrentCustomerVerification).toHaveBeenCalledWith(8, 'body', false, {
      transferCache: false,
    });
    expect(current).toEqual({
      id: 25,
      customerId: 8,
      verifiedAt: new Date('2026-09-18T08:00:00Z'),
      expiresAt: new Date('2026-09-18T08:30:00Z'),
    });
  });

  it('maps an empty current-verification response to null', async () => {
    api.getCurrentCustomerVerification.mockReturnValue(of({ verification: null }));

    await expect(
      firstValueFrom(TestBed.inject(CustomersDataAccess).getCurrentVerification(8)),
    ).resolves.toBeNull();
  });

  it('supplies the verification id in the customer-context lookup body', async () => {
    api.lookupCustomerTicket.mockReturnValue(
      of({
        id: 12,
        ticket_number: 'TKT-4ZFUPC6W7ZFJDEWY',
        title: 'Outlook issue',
        description: 'Description',
        status: 'OPEN',
        priority: 'MEDIUM',
        category_id: 1,
        category: { id: 1, name: 'Support' },
        created_by_id: 3,
        created_by: { id: 3, first_name: 'Emma', last_name: 'Employee' },
        assigned_to_id: null,
        assigned_to: null,
        customer_id: 8,
        customer: {
          id: 8,
          customer_number: 'CUS-000008',
          first_name: 'Thomas',
          last_name: 'Müller',
        },
        customer_was_verified: true,
        created_at: '2026-09-18T08:00:00Z',
        updated_at: '2026-09-18T08:00:00Z',
        resolved_at: null,
        closed_at: null,
      }),
    );

    await firstValueFrom(
      TestBed.inject(CustomersDataAccess).lookupTicket(8, 'TKT-4ZFUPC6W7ZFJDEWY', 25),
    );

    expect(api.lookupCustomerTicket).toHaveBeenCalledWith(
      8,
      {
        ticket_number: 'TKT-4ZFUPC6W7ZFJDEWY',
        customer_verification_id: 25,
      },
      'body',
      false,
      { transferCache: false },
    );
  });
});
