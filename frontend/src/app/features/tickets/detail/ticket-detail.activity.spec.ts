import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { TicketPriority } from '../../../api/generated/model/ticketPriority';
import { TicketStatus } from '../../../api/generated/model/ticketStatus';
import { UserRole } from '../../../api/generated/model/userRole';
import { AuthSessionStore } from '../../../platform/auth/auth-session.store';
import { TicketsDataAccess } from '../data-access/tickets-data-access';
import { TicketCommentsComponent } from '../comments/ticket-comments.component';
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
  customer: null,
  customerWasVerified: false,
  resolutionSummary: null,
  createdAt: new Date('2026-09-15T08:00:00Z'),
  updatedAt: new Date('2026-09-15T08:00:00Z'),
  resolvedAt: null,
  closedAt: null,
};

describe('TicketDetailPage activity access', () => {
  const tickets = {
    get: vi.fn(() => of(TICKET)),
    listComments: vi.fn(() => of({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 })),
    listActivity: vi.fn(() => of({ items: [], rawPage: 1, rawPageSize: 20, rawTotalPages: 0 })),
    listActiveAgents: vi.fn(() => of([])),
    listActiveCategories: vi.fn(() => of([{ id: 4, name: 'Hardware' }])),
  };

  async function render(role: UserRole): Promise<ComponentFixture<TicketDetailPage>> {
    await TestBed.configureTestingModule({
      imports: [TicketDetailPage],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: '17' })) },
        },
        {
          provide: AuthSessionStore,
          useValue: { currentUser: vi.fn(() => ({ id: 5, role })) },
        },
        { provide: TicketsDataAccess, useValue: tickets },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(TicketDetailPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => vi.clearAllMocks());

  it.each([UserRole.AGENT, UserRole.ADMIN])('instantiates Activity for %s', async (role) => {
    const fixture = await render(role);

    expect(fixture.nativeElement.querySelector('app-ticket-activity')).not.toBeNull();
    expect(tickets.listActivity).toHaveBeenCalledWith(17, 1, 20);
  });

  it('does not instantiate or request Activity for an Employee', async () => {
    const fixture = await render(UserRole.EMPLOYEE);

    expect(fixture.nativeElement.querySelector('app-ticket-activity')).toBeNull();
    expect(tickets.listActivity).not.toHaveBeenCalled();
  });

  it('renders an existing resolution summary read-only for an Employee', async () => {
    tickets.get.mockReturnValueOnce(
      of({
        ...TICKET,
        status: TicketStatus.RESOLVED,
        resolutionSummary: 'Restored access and confirmed the account is working.',
      }),
    );

    const fixture = await render(UserRole.EMPLOYEE);

    expect(fixture.nativeElement.querySelector('.resolution')?.textContent).toContain(
      'Restored access and confirmed the account is working.',
    );
    expect(fixture.nativeElement.querySelector('app-ticket-operations')).toBeNull();
  });

  it('refreshes Activity after successful local mutations and comments', async () => {
    const fixture = await render(UserRole.AGENT);
    tickets.listActivity.mockClear();

    fixture.componentInstance['mutationSucceeded']({ ...TICKET, priority: TicketPriority.HIGH });
    fixture.debugElement
      .query(By.directive(TicketCommentsComponent))
      .componentInstance.commentAdded.emit();

    expect(tickets.listActivity).toHaveBeenCalledTimes(2);
  });
});
