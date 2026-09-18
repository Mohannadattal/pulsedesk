import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { UserRole } from '../../../api/generated/model/userRole';
import { VerificationFactor } from '../../../api/generated/model/verificationFactor';
import { TicketPriority } from '../../../api/generated/model/ticketPriority';
import { TicketStatus } from '../../../api/generated/model/ticketStatus';
import { AuthSessionStore } from '../../../platform/auth/auth-session.store';
import { AppError } from '../../../platform/http/app-error';
import { TicketsDataAccess } from '../../tickets/data-access/tickets-data-access';
import { Ticket } from '../../tickets/domain/ticket';
import { CustomersDataAccess } from '../data-access/customers-data-access';
import { Customer, CustomerVerification } from '../domain/customer';
import { CustomerDetailPage } from './customer-detail.page';

const CUSTOMER: Customer = {
  id: 8,
  customerNumber: 'CUS-0000000000000008',
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
  id: 25,
  customerId: CUSTOMER.id,
  verifiedByUserId: 3,
  factors: [VerificationFactor.DATE_OF_BIRTH, VerificationFactor.POSTAL_CODE],
  verifiedAt: new Date('2026-09-18T08:00:00Z'),
  expiresAt: new Date('2099-09-18T08:30:00Z'),
};

const TICKET: Ticket = {
  id: 12,
  ticketNumber: 'TKT-4ZFUPC6W7ZFJDEWY',
  title: 'Outlook issue',
  description: 'Description',
  status: TicketStatus.OPEN,
  priority: TicketPriority.MEDIUM,
  category: { id: 1, name: 'Support' },
  creator: { id: 3, name: 'Emma Employee' },
  assignee: null,
  customer: { id: 8, name: 'Thomas Müller', customerNumber: CUSTOMER.customerNumber },
  customerWasVerified: true,
  createdAt: new Date('2026-09-18T08:00:00Z'),
  updatedAt: new Date('2026-09-18T08:00:00Z'),
  resolvedAt: null,
  closedAt: null,
};

describe('CustomerDetailPage ticket follow-up', () => {
  let fixture: ComponentFixture<CustomerDetailPage>;
  const router = { navigate: vi.fn(() => Promise.resolve(true)) };
  const customers = {
    get: vi.fn(),
    getCurrentVerification: vi.fn(),
    listTickets: vi.fn(),
    lookupTicket: vi.fn(),
    update: vi.fn(),
    updateActivation: vi.fn(),
    verify: vi.fn(),
  };
  const tickets = {
    listActiveCategories: vi.fn(() => of([])),
    create: vi.fn(),
  };

  async function render(
    currentVerification: Observable<CustomerVerification | null> = of(null),
  ): Promise<void> {
    customers.get.mockReturnValue(of(CUSTOMER));
    customers.getCurrentVerification.mockReturnValue(currentVerification);
    customers.listTickets.mockReturnValue(
      of({ items: [], page: 1, pageSize: 10, total: 0, totalPages: 0 }),
    );
    customers.lookupTicket.mockReturnValue(of(TICKET));
    await TestBed.configureTestingModule({
      imports: [CustomerDetailPage],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ customerId: '8' })) },
        },
        { provide: Router, useValue: router },
        { provide: CustomersDataAccess, useValue: customers },
        { provide: TicketsDataAccess, useValue: tickets },
        { provide: MatDialog, useValue: { open: vi.fn() } },
        {
          provide: AuthSessionStore,
          useValue: { currentUser: vi.fn(() => ({ id: 3, role: UserRole.EMPLOYEE })) },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CustomerDetailPage);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps Ticket History and makes follow-up unavailable before verification', async () => {
    await render();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Ticket history');
    expect(text).toContain('Follow up an existing ticket');
    expect(text).toContain('Verify the customer before looking up a ticket for this call.');
    expect(fixture.nativeElement.querySelector('input[formcontrolname="ticketNumber"]')).toBeNull();
  });

  it('restores the backend verification and enables follow-up after a profile remount', async () => {
    await render();
    fixture.componentInstance['acceptVerification'](VERIFICATION);
    fixture.componentInstance['lookupForm'].controls.ticketNumber.setValue(TICKET.ticketNumber);
    fixture.componentInstance['lookupTicket'](CUSTOMER);
    expect(router.navigate).toHaveBeenCalledWith(['/tickets', TICKET.id], {
      queryParams: { returnTo: '/customers/8' },
    });

    fixture.destroy();
    customers.getCurrentVerification.mockReturnValue(of(VERIFICATION));
    fixture = TestBed.createComponent(CustomerDetailPage);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(customers.getCurrentVerification).toHaveBeenCalledWith(CUSTOMER.id);
    expect(fixture.componentInstance['verification']()).toEqual(VERIFICATION);
    expect(fixture.nativeElement.textContent).toContain('Verified by');
    expect(fixture.nativeElement.textContent).toContain('valid until');
    expect(
      fixture.nativeElement.querySelector('input[formcontrolname="ticketNumber"]'),
    ).not.toBeNull();
  });

  it('leaves the profile unverified when no current verification exists', async () => {
    await render(of(null));

    expect(fixture.componentInstance['verification']()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      'Verify the customer before looking up a ticket for this call.',
    );
  });

  it('does not restore a response that has expired before the profile uses it', async () => {
    await render(of({ ...VERIFICATION, expiresAt: new Date('2000-01-01T00:00:00Z') }));

    expect(fixture.componentInstance['verification']()).toBeNull();
    expect(fixture.nativeElement.querySelector('input[formcontrolname="ticketNumber"]')).toBeNull();
  });

  it('uses the current verification id and opens Ticket Detail with a customer return path', async () => {
    await render();
    fixture.componentInstance['acceptVerification'](VERIFICATION);
    fixture.componentInstance['lookupForm'].controls.ticketNumber.setValue(
      '  tkt-4zfupc6w7zfjdewy  ',
    );

    fixture.componentInstance['lookupTicket'](CUSTOMER);

    expect(customers.lookupTicket).toHaveBeenCalledWith(
      CUSTOMER.id,
      'TKT-4ZFUPC6W7ZFJDEWY',
      VERIFICATION.id,
    );
    expect(router.navigate).toHaveBeenCalledWith(['/tickets', TICKET.id], {
      queryParams: { returnTo: '/customers/8' },
    });
  });

  it('rejects malformed input without calling the backend', async () => {
    await render();
    fixture.componentInstance['acceptVerification'](VERIFICATION);
    fixture.componentInstance['lookupForm'].controls.ticketNumber.setValue('TKT-123');

    fixture.componentInstance['lookupTicket'](CUSTOMER);

    expect(customers.lookupTicket).not.toHaveBeenCalled();
    expect(fixture.componentInstance['lookupForm'].controls.ticketNumber.touched).toBe(true);
  });

  it('shows the same safe result for an unavailable customer ticket', async () => {
    await render();
    customers.lookupTicket.mockReturnValueOnce(
      throwError(() => new AppError('not-found', 404, 'TICKET_NOT_FOUND')),
    );
    fixture.componentInstance['acceptVerification'](VERIFICATION);
    fixture.componentInstance['lookupForm'].controls.ticketNumber.setValue('TKT-AAAAAAAAAAAAAAAA');

    fixture.componentInstance['lookupTicket'](CUSTOMER);

    expect(fixture.componentInstance['lookupError']()).toBe('No ticket found for this customer.');
    expect(fixture.nativeElement.textContent).not.toContain(TICKET.title);
  });

  it('clears stale browser verification when the backend reports expiry', async () => {
    await render();
    customers.lookupTicket.mockReturnValueOnce(
      throwError(() => new AppError('validation', 422, 'CUSTOMER_VERIFICATION_INVALID')),
    );
    fixture.componentInstance['acceptVerification'](VERIFICATION);
    fixture.componentInstance['lookupForm'].controls.ticketNumber.setValue(TICKET.ticketNumber);

    fixture.componentInstance['lookupTicket'](CUSTOMER);

    expect(fixture.componentInstance['verification']()).toBeNull();
    expect(fixture.componentInstance['lookupError']()).toContain('Verify again');
  });
});
