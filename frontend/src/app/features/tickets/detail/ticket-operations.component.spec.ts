import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of, Subject, throwError } from 'rxjs';
import { vi } from 'vitest';

import { TicketPriority } from '../../../api/generated/model/ticketPriority';
import { TicketStatus } from '../../../api/generated/model/ticketStatus';
import { UserRole } from '../../../api/generated/model/userRole';
import { AppError } from '../../../platform/http/app-error';
import { TicketsDataAccess } from '../data-access/tickets-data-access';
import { Ticket } from '../domain/ticket';
import { canOperateTicket, TicketOperationsComponent } from './ticket-operations.component';

const TICKET: Ticket = {
  id: 17,
  ticketNumber: 'TKT-17',
  title: 'Printer unavailable',
  description: 'The third-floor printer is offline.',
  status: TicketStatus.OPEN,
  priority: TicketPriority.MEDIUM,
  category: { id: 4, name: 'Historical hardware' },
  creator: { id: 9, name: 'Eli Employee' },
  assignee: { id: 21, name: 'Former Agent' },
  customer: null,
  customerWasVerified: false,
  resolutionSummary: null,
  createdAt: new Date('2026-09-15T08:00:00Z'),
  updatedAt: new Date('2026-09-15T08:00:00Z'),
  resolvedAt: null,
  closedAt: null,
};

const UPDATED: Ticket = {
  ...TICKET,
  status: TicketStatus.IN_PROGRESS,
  priority: TicketPriority.HIGH,
  assignee: null,
  updatedAt: new Date('2026-09-15T09:00:00Z'),
};

const RESOLVED: Ticket = {
  ...UPDATED,
  status: TicketStatus.RESOLVED,
  resolutionSummary: 'Replaced the damaged network cable.',
  resolvedAt: new Date('2026-09-15T10:00:00Z'),
};

describe('TicketOperationsComponent', () => {
  let fixture: ComponentFixture<TicketOperationsComponent>;
  const tickets = {
    get: vi.fn<() => Observable<Ticket>>(),
    listActiveAgents: vi.fn(),
    listActiveCategories: vi.fn(),
    updateAssignment: vi.fn<() => Observable<Ticket>>(),
    updateStatus: vi.fn<() => Observable<Ticket>>(),
    updatePriority: vi.fn<() => Observable<Ticket>>(),
    updateCategory: vi.fn<() => Observable<Ticket>>(),
  };

  async function render(ticket: Ticket = TICKET): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [TicketOperationsComponent],
      providers: [{ provide: TicketsDataAccess, useValue: tickets }],
    }).compileComponents();
    fixture = TestBed.createComponent(TicketOperationsComponent);
    fixture.componentRef.setInput('ticket', ticket);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    tickets.get.mockReturnValue(of(TICKET));
    tickets.listActiveAgents.mockReturnValue(
      of([
        { id: 21, name: 'Former Agent' },
        { id: 5, name: 'Active Agent' },
      ]),
    );
    tickets.listActiveCategories.mockReturnValue(
      of([
        { id: 4, name: 'Historical hardware' },
        { id: 6, name: 'Active category' },
      ]),
    );
    tickets.updateAssignment.mockReturnValue(of(UPDATED));
    tickets.updateStatus.mockReturnValue(of(UPDATED));
    tickets.updatePriority.mockReturnValue(of(UPDATED));
    tickets.updateCategory.mockReturnValue(of(UPDATED));
  });

  it('allows AGENT and ADMIN operations but excludes EMPLOYEE', () => {
    expect(canOperateTicket(UserRole.AGENT)).toBe(true);
    expect(canOperateTicket(UserRole.ADMIN)).toBe(true);
    expect(canOperateTicket(UserRole.EMPLOYEE)).toBe(false);
  });

  it('does not allow historical inactive references to be resubmitted as choices', async () => {
    tickets.listActiveAgents.mockReturnValue(of([{ id: 5, name: 'Active Agent' }]));
    tickets.listActiveCategories.mockReturnValue(of([{ id: 6, name: 'Active category' }]));
    await render();

    expect(fixture.componentInstance['assignmentIsEligible']()).toBe(false);
    expect(fixture.componentInstance['categoryIsActive']()).toBe(false);
    fixture.componentInstance['updateAssignment']();
    fixture.componentInstance['updateCategory']();

    expect(tickets.updateAssignment).not.toHaveBeenCalled();
    expect(tickets.updateCategory).not.toHaveBeenCalled();
  });

  it('presents only the single next status action and no action for CLOSED', async () => {
    await render();
    expect(text()).toContain('Move to In Progress');
    expect(text()).not.toContain('Move to Resolved');

    fixture.componentRef.setInput('ticket', { ...TICKET, status: TicketStatus.CLOSED });
    fixture.detectChanges();

    expect(text()).toContain('Closed — workflow complete');
    expect(text()).not.toContain('Move to In Progress');
  });

  it('sends assignment and unassignment intent and emits the returned ticket unchanged', async () => {
    await render();
    const emitted = vi.fn();
    fixture.componentInstance.ticketUpdated.subscribe(emitted);
    fixture.componentInstance['assignment'].setValue(null);

    click('Apply assignment');

    expect(tickets.updateAssignment).toHaveBeenCalledWith(17, null);
    expect(emitted).toHaveBeenCalledWith(UPDATED);
  });

  it('sends priority, category, and forward-status mutations', async () => {
    await render();
    fixture.componentInstance['priority'].setValue(TicketPriority.URGENT);
    fixture.componentInstance['category'].setValue(6);

    click('Apply priority');
    click('Apply category');
    click('Move to In Progress');

    expect(tickets.updatePriority).toHaveBeenCalledWith(17, TicketPriority.URGENT);
    expect(tickets.updateCategory).toHaveBeenCalledWith(17, 6);
    expect(tickets.updateStatus).toHaveBeenCalledWith(17, TicketStatus.IN_PROGRESS);
  });

  it('opens a required customer-facing summary form before resolving', async () => {
    await render({ ...TICKET, status: TicketStatus.IN_PROGRESS });

    click('Move to Resolved');

    expect(text()).toContain('Resolve ticket');
    expect(text()).toContain('customer-facing');
    expect(fixture.componentInstance['resolutionSummary'].hasError('required')).toBe(true);
    expect(resolveSubmitButton().disabled).toBe(true);
    expect(tickets.updateStatus).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only and over-2,000-character summaries without truncating input', async () => {
    await render({ ...TICKET, status: TicketStatus.IN_PROGRESS });
    click('Move to Resolved');

    setResolution('   \n  ');
    expect(fixture.componentInstance['resolutionSummary'].hasError('whitespace')).toBe(true);
    expect(resolveSubmitButton().disabled).toBe(true);

    const oversized = 'x'.repeat(2_001);
    setResolution(oversized);
    expect(fixture.componentInstance['resolutionSummary'].hasError('maxlength')).toBe(true);
    expect((fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement).value).toBe(
      oversized,
    );
    expect(text()).toContain('2001 / 2000');
    expect(tickets.updateStatus).not.toHaveBeenCalled();
  });

  it('submits one trimmed resolution and blocks duplicate submission while in flight', async () => {
    const pending = new Subject<Ticket>();
    tickets.updateStatus.mockReturnValue(pending);
    await render({ ...TICKET, status: TicketStatus.IN_PROGRESS });
    click('Move to Resolved');
    setResolution('  Replaced the damaged network cable.  ');

    submitResolution();
    fixture.componentInstance['resolveTicket']();

    expect(tickets.updateStatus).toHaveBeenCalledOnce();
    expect(tickets.updateStatus).toHaveBeenCalledWith(
      17,
      TicketStatus.RESOLVED,
      'Replaced the damaged network cable.',
    );
    expect(resolveSubmitButton().disabled).toBe(true);
  });

  it('closes and resets the form after the returned resolved ticket is emitted', async () => {
    tickets.updateStatus.mockReturnValue(of(RESOLVED));
    await render({ ...TICKET, status: TicketStatus.IN_PROGRESS });
    const emitted = vi.fn((ticket: Ticket) => fixture.componentRef.setInput('ticket', ticket));
    fixture.componentInstance.ticketUpdated.subscribe(emitted);
    click('Move to Resolved');
    setResolution('Replaced the damaged network cable.');

    submitResolution();
    fixture.detectChanges();

    expect(emitted).toHaveBeenCalledWith(RESOLVED);
    expect(fixture.nativeElement.querySelector('.resolution-form')).toBeNull();
    expect(fixture.componentInstance['resolutionSummary'].value).toBe('');
    expect(text()).toContain('Ticket resolved.');
    expect(text()).toContain('Move to Closed');
    expect(text()).not.toContain('Email sent');
  });

  it('keeps the prior ticket and typed summary visible after resolution fails', async () => {
    tickets.updateStatus.mockReturnValue(
      throwError(() => new AppError('validation', 422, 'INVALID_RESOLUTION_SUMMARY')),
    );
    await render({ ...TICKET, status: TicketStatus.IN_PROGRESS });
    const emitted = vi.fn();
    fixture.componentInstance.ticketUpdated.subscribe(emitted);
    click('Move to Resolved');
    setResolution('Customer can now sign in.');

    submitResolution();

    expect(emitted).not.toHaveBeenCalled();
    expect(fixture.componentInstance['resolutionFormOpen']()).toBe(true);
    expect(fixture.componentInstance['resolutionSummary'].value).toBe('Customer can now sign in.');
    expect(text()).toContain('between 1 and 2,000 characters');
    expect(text()).toContain('Current status: In Progress');
    expect(text()).not.toContain('Ticket resolved.');
  });

  it('keeps the resolution form and summary after a transport failure', async () => {
    tickets.updateStatus.mockReturnValue(throwError(() => new AppError('unavailable', 503)));
    await render({ ...TICKET, status: TicketStatus.IN_PROGRESS });
    const emitted = vi.fn();
    fixture.componentInstance.ticketUpdated.subscribe(emitted);
    click('Move to Resolved');
    setResolution('Customer can now sign in.');

    submitResolution();

    expect(emitted).not.toHaveBeenCalled();
    expect(fixture.componentInstance['resolutionFormOpen']()).toBe(true);
    expect(fixture.componentInstance['resolutionSummary'].value).toBe('Customer can now sign in.');
    expect(text()).toContain('temporarily unavailable');
    expect(text()).toContain('Current status: In Progress');
    expect(text()).not.toContain('Ticket resolved.');
  });

  it('closes a resolved ticket directly without a new summary', async () => {
    await render(RESOLVED);

    click('Move to Closed');

    expect(fixture.nativeElement.querySelector('.resolution-form')).toBeNull();
    expect(tickets.updateStatus).toHaveBeenCalledWith(17, TicketStatus.CLOSED);
  });

  it('uses one gate to prevent simultaneous field mutations', async () => {
    const pending = new Subject<Ticket>();
    tickets.updateAssignment.mockReturnValue(pending);
    await render();

    click('Apply assignment');
    fixture.componentInstance['updatePriority']();

    expect(tickets.updateAssignment).toHaveBeenCalledOnce();
    expect(tickets.updatePriority).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.operations').getAttribute('aria-busy')).toBe(
      'true',
    );
    pending.next(UPDATED);
    pending.complete();
  });

  it('reloads the authoritative ticket after a stale status conflict', async () => {
    tickets.updateStatus.mockReturnValue(
      throwError(() => new AppError('conflict', 409, 'INVALID_TICKET_STATUS_TRANSITION')),
    );
    tickets.get.mockReturnValue(of({ ...TICKET, status: TicketStatus.RESOLVED }));
    await render();
    const emitted = vi.fn();
    fixture.componentInstance.ticketUpdated.subscribe(emitted);

    click('Move to In Progress');
    fixture.detectChanges();

    expect(tickets.get).toHaveBeenCalledWith(17);
    expect(emitted).toHaveBeenCalledWith({ ...TICKET, status: TicketStatus.RESOLVED });
    expect(text()).toContain('Ticket reloaded');
  });

  it('refreshes ticket and categories after an inactive-category conflict', async () => {
    tickets.updateCategory.mockReturnValue(
      throwError(() => new AppError('conflict', 409, 'CATEGORY_INACTIVE')),
    );
    await render();
    fixture.componentInstance['category'].setValue(6);

    click('Apply category');

    expect(tickets.get).toHaveBeenCalledWith(17);
    expect(tickets.listActiveCategories).toHaveBeenCalledTimes(2);
    expect(text()).toContain('active categories refreshed');
  });

  it('refreshes ticket and Agents after an invalid-assignee response', async () => {
    tickets.updateAssignment.mockReturnValue(
      throwError(() => new AppError('validation', 422, 'INVALID_TICKET_ASSIGNEE')),
    );
    await render();

    click('Apply assignment');

    expect(tickets.get).toHaveBeenCalledWith(17);
    expect(tickets.listActiveAgents).toHaveBeenCalledTimes(2);
    expect(text()).toContain('eligible Agents refreshed');
  });

  it('retains an authoritative ticket when category recovery fails independently', async () => {
    const ticketReload = new Subject<Ticket>();
    const categoryReload = new Subject<readonly { id: number; name: string }[]>();
    const agentReload = new Subject<readonly { id: number; name: string }[]>();
    await render();
    tickets.get.mockReturnValue(ticketReload);
    tickets.listActiveCategories.mockReturnValue(categoryReload);
    tickets.listActiveAgents.mockReturnValue(agentReload);
    const emitted = vi.fn();
    fixture.componentInstance.ticketUpdated.subscribe(emitted);

    fixture.componentInstance['retryRecovery']();
    ticketReload.next(UPDATED);

    expect(emitted).toHaveBeenCalledWith(UPDATED);

    categoryReload.error(new AppError('unavailable', 503));
    agentReload.next([{ id: 5, name: 'Active Agent' }]);
    agentReload.complete();
    fixture.detectChanges();

    expect(fixture.componentInstance['recoveryRequired']()).toBe(false);
    expect(fixture.componentInstance['categoriesUnavailable']()).toBe(true);
    expect(fixture.componentInstance['agentsUnavailable']()).toBe(false);
    expect(fixture.componentInstance['priority'].disabled).toBe(false);
    expect(fixture.componentInstance['category'].disabled).toBe(true);
    expect(fixture.componentInstance['assignment'].disabled).toBe(false);
    expect(text()).toContain('Ticket reloaded, but active categories could not be refreshed');
    expect(text()).toContain('Retry categories');
  });

  it('retains an authoritative ticket when Agent recovery fails independently', async () => {
    const ticketReload = new Subject<Ticket>();
    const categoryReload = new Subject<readonly { id: number; name: string }[]>();
    const agentReload = new Subject<readonly { id: number; name: string }[]>();
    await render();
    tickets.get.mockReturnValue(ticketReload);
    tickets.listActiveCategories.mockReturnValue(categoryReload);
    tickets.listActiveAgents.mockReturnValue(agentReload);
    const emitted = vi.fn();
    fixture.componentInstance.ticketUpdated.subscribe(emitted);

    fixture.componentInstance['retryRecovery']();
    ticketReload.next(UPDATED);
    agentReload.error(new AppError('network'));
    categoryReload.next([{ id: 6, name: 'Active category' }]);
    categoryReload.complete();
    fixture.detectChanges();

    expect(emitted).toHaveBeenCalledWith(UPDATED);
    expect(fixture.componentInstance['recoveryRequired']()).toBe(false);
    expect(fixture.componentInstance['agentsUnavailable']()).toBe(true);
    expect(fixture.componentInstance['categoriesUnavailable']()).toBe(false);
    expect(fixture.componentInstance['priority'].disabled).toBe(false);
    expect(fixture.componentInstance['assignment'].disabled).toBe(true);
    expect(fixture.componentInstance['category'].disabled).toBe(false);
    expect(text()).toContain('Ticket reloaded, but eligible Agents could not be refreshed');
    expect(text()).toContain('Retry directory');
  });

  it('enforces recovery single-flight and keeps mutations blocked while recovery is active', async () => {
    const ticketReload = new Subject<Ticket>();
    const categoryReload = new Subject<readonly { id: number; name: string }[]>();
    const agentReload = new Subject<readonly { id: number; name: string }[]>();
    await render();
    tickets.get.mockReturnValue(ticketReload);
    tickets.listActiveCategories.mockReturnValue(categoryReload);
    tickets.listActiveAgents.mockReturnValue(agentReload);

    fixture.componentInstance['retryRecovery']();
    fixture.componentInstance['retryRecovery']();
    fixture.componentInstance['updatePriority']();

    expect(tickets.get).toHaveBeenCalledOnce();
    expect(tickets.listActiveCategories).toHaveBeenCalledTimes(2);
    expect(tickets.listActiveAgents).toHaveBeenCalledTimes(2);
    expect(tickets.updatePriority).not.toHaveBeenCalled();
  });

  it('does not start recovery during an active mutation', async () => {
    const mutation = new Subject<Ticket>();
    tickets.updatePriority.mockReturnValue(mutation);
    await render();

    fixture.componentInstance['updatePriority']();
    fixture.componentInstance['retryRecovery']();

    expect(tickets.get).not.toHaveBeenCalled();
  });

  it('does not emit a stale recovery ticket over a newer input authority', async () => {
    const ticketReload = new Subject<Ticket>();
    await render();
    tickets.get.mockReturnValue(ticketReload);
    const emitted = vi.fn();
    fixture.componentInstance.ticketUpdated.subscribe(emitted);

    fixture.componentInstance['retryRecovery']();
    fixture.componentRef.setInput('ticket', UPDATED);
    fixture.detectChanges();
    ticketReload.next(TICKET);

    expect(emitted).not.toHaveBeenCalled();
  });

  it('keeps controls and ticket context on 403 without ending the session', async () => {
    tickets.updatePriority.mockReturnValue(
      throwError(() => new AppError('forbidden', 403, 'FORBIDDEN')),
    );
    await render();

    click('Apply priority');

    expect(text()).toContain('permission to change this ticket’s priority');
    expect(text()).toContain('Current status: Open');
  });

  it('emits terminal not-found without replacing the confirmed ticket', async () => {
    tickets.updateAssignment.mockReturnValue(
      throwError(() => new AppError('not-found', 404, 'TICKET_NOT_FOUND')),
    );
    await render();
    const updated = vi.fn();
    const missing = vi.fn();
    fixture.componentInstance.ticketUpdated.subscribe(updated);
    fixture.componentInstance.ticketNotFound.subscribe(missing);

    click('Apply assignment');

    expect(missing).toHaveBeenCalledOnce();
    expect(updated).not.toHaveBeenCalled();
  });

  it.each([new AppError('network'), new AppError('unavailable', 503)])(
    'preserves a retryable mutation intent for %s failures',
    async (failure) => {
      tickets.updatePriority
        .mockReturnValueOnce(throwError(() => failure))
        .mockReturnValueOnce(of(UPDATED));
      await render();

      click('Apply priority');
      fixture.detectChanges();
      expect(text()).toContain('last confirmed ticket');
      click('Retry this change');

      expect(tickets.updatePriority).toHaveBeenCalledTimes(2);
    },
  );

  function click(label: string): void {
    const button = [...fixture.nativeElement.querySelectorAll('button')].find((candidate) =>
      (candidate as HTMLElement).textContent?.includes(label),
    ) as HTMLButtonElement | undefined;
    expect(button, `button containing "${label}"`).toBeTruthy();
    button?.click();
    fixture.detectChanges();
  }

  function text(): string {
    fixture.detectChanges();
    return fixture.nativeElement.textContent as string;
  }

  function setResolution(value: string): void {
    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = value;
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function resolveSubmitButton(): HTMLButtonElement {
    const buttons = [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    const button = buttons.find(
      (candidate) =>
        candidate.type === 'submit' && candidate.textContent?.includes('Resolve ticket'),
    );
    expect(button).toBeTruthy();
    return button as HTMLButtonElement;
  }

  function submitResolution(): void {
    const form = fixture.nativeElement.querySelector('.resolution-form') as HTMLFormElement;
    const event = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    fixture.detectChanges();
  }
});
