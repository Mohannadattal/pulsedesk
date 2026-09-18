import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';

import { CustomersApi } from '../../../api/generated/api/customers.service';
import { CustomerCreate } from '../../../api/generated/model/customerCreate';
import { CustomerSearchKind } from '../../../api/generated/model/customerSearchKind';
import { CustomerUpdate } from '../../../api/generated/model/customerUpdate';
import { VerificationFactor } from '../../../api/generated/model/verificationFactor';
import { mapTicket, TicketPage } from '../../tickets/domain/ticket';
import {
  Customer,
  CustomerPage,
  CustomerVerification,
  mapCustomer,
  mapCustomerSummary,
  mapVerification,
} from '../domain/customer';

@Injectable({ providedIn: 'root' })
export class CustomersDataAccess {
  private readonly api = inject(CustomersApi);

  list(isActive: boolean | undefined, page: number, pageSize: number): Observable<CustomerPage> {
    return this.api
      .listCustomers(isActive, page, pageSize, 'body', false, { transferCache: false })
      .pipe(map(mapPage));
  }

  search(
    kind: CustomerSearchKind,
    value: string,
    isActive: boolean | undefined,
    page: number,
    pageSize: number,
  ): Observable<CustomerPage> {
    return this.api
      .searchCustomers(
        { kind, value, is_active: isActive, page, page_size: pageSize },
        'body',
        false,
        { transferCache: false },
      )
      .pipe(map(mapPage));
  }

  get(customerId: number): Observable<Customer> {
    return this.api
      .getCustomer(customerId, 'body', false, { transferCache: false })
      .pipe(map(mapCustomer));
  }

  create(request: CustomerCreate): Observable<Customer> {
    return this.api
      .createCustomer(request, 'body', false, { transferCache: false })
      .pipe(map(mapCustomer));
  }

  update(customerId: number, request: CustomerUpdate): Observable<Customer> {
    return this.api
      .updateCustomer(customerId, request, 'body', false, { transferCache: false })
      .pipe(map(mapCustomer));
  }

  updateActivation(customerId: number, isActive: boolean): Observable<Customer> {
    return this.api
      .updateCustomerActivation(customerId, { is_active: isActive }, 'body', false, {
        transferCache: false,
      })
      .pipe(map(mapCustomer));
  }

  verify(
    customerId: number,
    factors: readonly VerificationFactor[],
  ): Observable<CustomerVerification> {
    return this.api
      .createCustomerVerification(customerId, { factors: [...factors] }, 'body', false, {
        transferCache: false,
      })
      .pipe(map(mapVerification));
  }

  listTickets(customerId: number, page: number, pageSize: number): Observable<TicketPage> {
    return this.api
      .listCustomerTickets(
        customerId,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        page,
        pageSize,
        'body',
        false,
        { transferCache: false },
      )
      .pipe(
        map((response) => ({
          items: response.items.map(mapTicket),
          page: response.page,
          pageSize: response.page_size,
          total: response.total,
          totalPages: response.total_pages,
        })),
      );
  }
}

function mapPage(response: {
  readonly items: Parameters<typeof mapCustomerSummary>[0][];
  readonly page: number;
  readonly page_size: number;
  readonly total: number;
  readonly total_pages: number;
}): CustomerPage {
  return {
    items: response.items.map(mapCustomerSummary),
    page: response.page,
    pageSize: response.page_size,
    total: response.total,
    totalPages: response.total_pages,
  };
}
