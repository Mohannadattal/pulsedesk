import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject, Observable, of, Subject } from 'rxjs';
import { vi } from 'vitest';

import { TicketPriority } from '../../../api/generated/model/ticketPriority';
import { TicketStatus } from '../../../api/generated/model/ticketStatus';
import { UserRole } from '../../../api/generated/model/userRole';
import { AuthSessionStore } from '../../../platform/auth/auth-session.store';
import { TicketsDataAccess } from '../data-access/tickets-data-access';
import { Ticket } from '../domain/ticket';
import { TicketDetailPage } from './ticket-detail.page';

const TICKET: Ticket = {
  id: 17,
  ticketNumber: 'TKT-17',
  title: 'Printer unavailable',
  description: 'Offline',
  status: TicketStatus.OPEN,
  priority: TicketPriority.MEDIUM,
  category: { id: 4, name: 'Hardware' },
  creator: { id: 9, name: 'Eli Employee' },
  assignee: null,
  createdAt: new Date('2026-09-15T08:00:00Z'),
  updatedAt: new Date('2026-09-15T08:00:00Z'),
  resolvedAt: null,
  closedAt: null,
};

const UPDATED: Ticket = {
  ...TICKET,
  status: TicketStatus.IN_PROGRESS,
  priority: TicketPriority.HIGH,
  updatedAt: new Date('2026-09-15T09:00:00Z'),
};

describe('TicketDetailPage authoritative ticket state', () => {
  let fixture: ComponentFixture<TicketDetailPage>;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  const tickets = { get: vi.fn<(_id: number) => Observable<Ticket>>() };
  const session = { currentUser: vi.fn(() => ({ id: 5, role: UserRole.AGENT })) };

  async function render(response: Observable<Ticket> = of(TICKET)): Promise<void> {
    params = new BehaviorSubject(convertToParamMap({ id: '17' }));
    tickets.get.mockReturnValue(response);
    await TestBed.configureTestingModule({
      imports: [TicketDetailPage],
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: params } },
        { provide: AuthSessionStore, useValue: session },
        { provide: TicketsDataAccess, useValue: tickets },
      ],
    })
      .overrideComponent(TicketDetailPage, { set: { template: '' } })
      .compileComponents();
    fixture = TestBed.createComponent(TicketDetailPage);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => vi.clearAllMocks());

  it('establishes the initial route result as the single displayed ticket', async () => {
    await render();

    expect(fixture.componentInstance['state']()).toEqual({ kind: 'loaded', ticket: TICKET });
  });

  it('replaces that same authority after a mutation or recovery result', async () => {
    await render();

    fixture.componentInstance['replaceTicket'](UPDATED);

    expect(fixture.componentInstance['state']()).toEqual({ kind: 'loaded', ticket: UPDATED });

    const recovered = { ...UPDATED, status: TicketStatus.RESOLVED };
    fixture.componentInstance['replaceTicket'](recovered);

    expect(fixture.componentInstance['state']()).toEqual({ kind: 'loaded', ticket: recovered });
  });

  it('does not let an older retry response restore a replaced ticket', async () => {
    await render();
    const staleRetry = new Subject<Ticket>();
    tickets.get.mockReturnValue(staleRetry);

    fixture.componentInstance['retry']();
    fixture.componentInstance['replaceTicket'](UPDATED);
    staleRetry.next(TICKET);
    staleRetry.complete();

    expect(fixture.componentInstance['state']()).toEqual({ kind: 'loaded', ticket: UPDATED });
  });

  it('cancels an older route request when the ticket route changes', async () => {
    const first = new Subject<Ticket>();
    await render(first);
    const second = new Subject<Ticket>();
    const ticket18 = { ...TICKET, id: 18, ticketNumber: 'TKT-18' };
    tickets.get.mockReturnValue(second);

    params.next(convertToParamMap({ id: '18' }));
    first.next(TICKET);
    second.next(ticket18);

    expect(fixture.componentInstance['state']()).toEqual({ kind: 'loaded', ticket: ticket18 });
  });
});
