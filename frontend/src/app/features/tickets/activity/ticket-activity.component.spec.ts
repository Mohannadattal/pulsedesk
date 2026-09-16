import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of, Subject, throwError } from 'rxjs';
import { vi } from 'vitest';

import { AppError } from '../../../platform/http/app-error';
import { TicketsDataAccess } from '../data-access/tickets-data-access';
import { TicketActivityItem, TicketActivityPage } from '../domain/ticket-activity';
import { TicketActivityComponent } from './ticket-activity.component';

const FIRST: TicketActivityItem = {
  id: 3,
  description: 'Ada Agent created the ticket.',
  occurredAt: new Date('2026-09-15T10:00:00Z'),
  kind: 'created',
};
const OLDER: TicketActivityItem = {
  id: 2,
  description: 'Ada Agent changed priority from Low to Medium.',
  occurredAt: new Date('2026-09-15T09:00:00Z'),
  kind: 'priority',
};

function page(
  items: readonly TicketActivityItem[],
  rawPage = 1,
  rawTotalPages = 1,
): TicketActivityPage {
  return { items, rawPage, rawPageSize: 20, rawTotalPages };
}

describe('TicketActivityComponent', () => {
  let fixture: ComponentFixture<TicketActivityComponent>;
  const tickets = {
    listActivity:
      vi.fn<
        (ticketId: number, rawPage: number, pageSize: number) => Observable<TicketActivityPage>
      >(),
  };

  async function render(response?: Observable<TicketActivityPage>): Promise<void> {
    if (response) {
      tickets.listActivity.mockReturnValue(response);
    }
    await TestBed.configureTestingModule({
      imports: [TicketActivityComponent],
      providers: [{ provide: TicketsDataAccess, useValue: tickets }],
    }).compileComponents();
    fixture = TestBed.createComponent(TicketActivityComponent);
    fixture.componentRef.setInput('ticketId', 17);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    tickets.listActivity.mockReturnValue(of(page([FIRST])));
  });

  it('loads newest-first page one and renders semantic list and time elements', async () => {
    await render();

    expect(tickets.listActivity).toHaveBeenCalledWith(17, 1, 20);
    expect(fixture.nativeElement.querySelectorAll('ol > li')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('time').getAttribute('datetime')).toBe(
      '2026-09-15T10:00:00.000Z',
    );
    expect(fixture.nativeElement.querySelector('h2').textContent).toContain('Activity');
  });

  it('shows an empty state', async () => {
    await render(of(page([])));

    expect(fixture.nativeElement.textContent).toContain('No activity yet.');
  });

  it('retries an initial failure without requiring a page reload', async () => {
    await render(throwError(() => new AppError('network', 0)));
    tickets.listActivity.mockReturnValue(of(page([FIRST])));

    fixture.nativeElement.querySelector('[role="alert"] button').click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(tickets.listActivity).toHaveBeenLastCalledWith(17, 1, 20);
    expect(fixture.componentInstance['items']()).toEqual([FIRST]);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('loads older items and deduplicates shifted offset results by event ID', async () => {
    tickets.listActivity.mockImplementation((_ticketId, rawPage) =>
      of(rawPage === 1 ? page([FIRST], 1, 2) : page([FIRST, OLDER], 2, 2)),
    );
    await render();
    tickets.listActivity.mockClear();

    fixture.nativeElement.querySelector('.activity__older button').click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(tickets.listActivity).toHaveBeenCalledWith(17, 2, 20);
    expect(fixture.componentInstance['items']()).toEqual([FIRST, OLDER]);
  });

  it('continues through a suppressed-only raw page until visible activity is found', async () => {
    tickets.listActivity.mockImplementation((_ticketId, rawPage) =>
      of(rawPage === 1 ? page([], 1, 2) : page([OLDER], 2, 2)),
    );

    await render();

    expect(tickets.listActivity.mock.calls.map((call) => call[1])).toEqual([1, 2]);
    expect(fixture.componentInstance['items']()).toEqual([OLDER]);
    expect(fixture.componentInstance['hasMore']()).toBe(false);
  });

  it('preserves confirmed content when refresh fails and retries the refresh operation', async () => {
    await render(of(page([FIRST])));
    tickets.listActivity.mockReturnValue(throwError(() => new AppError('network', 0)));

    fixture.componentInstance.refresh();
    fixture.detectChanges();

    expect(fixture.componentInstance['items']()).toEqual([FIRST]);
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      'Check your connection',
    );
    expect(fixture.nativeElement.querySelector('ol')).not.toBeNull();
  });

  it('preserves confirmed content when loading older activity fails', async () => {
    await render(of(page([FIRST], 1, 2)));
    tickets.listActivity.mockReturnValue(throwError(() => new AppError('unavailable', 503)));

    fixture.componentInstance['loadOlder']();
    fixture.detectChanges();

    expect(fixture.componentInstance['items']()).toEqual([FIRST]);
    expect(fixture.nativeElement.textContent).toContain('temporarily unavailable');
  });

  it.each([
    ['forbidden', 403, 'do not have access'],
    ['network', 0, 'Check your connection'],
    ['unavailable', 503, 'temporarily unavailable'],
    ['unexpected', 500, 'could not be loaded'],
  ] as const)('renders a stable %s error state', async (kind, status, message) => {
    await render(throwError(() => new AppError(kind, status)));

    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(message);
  });

  it('notifies the parent when the ticket becomes unavailable', async () => {
    await TestBed.configureTestingModule({
      imports: [TicketActivityComponent],
      providers: [{ provide: TicketsDataAccess, useValue: tickets }],
    }).compileComponents();
    tickets.listActivity.mockReturnValue(throwError(() => new AppError('not-found', 404)));
    fixture = TestBed.createComponent(TicketActivityComponent);
    const notFound = vi.fn();
    fixture.componentInstance.ticketNotFound.subscribe(notFound);
    fixture.componentRef.setInput('ticketId', 17);
    fixture.detectChanges();

    expect(notFound).toHaveBeenCalledOnce();
  });

  it('cancels the old request and rejects stale results when the ticket changes', async () => {
    const first = new Subject<TicketActivityPage>();
    const second = new Subject<TicketActivityPage>();
    tickets.listActivity.mockImplementation((ticketId) => (ticketId === 17 ? first : second));
    await render();

    fixture.componentRef.setInput('ticketId', 18);
    fixture.detectChanges();
    first.next(page([FIRST]));
    second.next(page([OLDER]));
    fixture.detectChanges();

    expect(first.observed).toBe(false);
    expect(fixture.componentInstance['items']()).toEqual([OLDER]);
  });
});
