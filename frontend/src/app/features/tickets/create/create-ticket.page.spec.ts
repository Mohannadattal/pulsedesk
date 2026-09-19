import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Observable, of, Subject, throwError } from 'rxjs';
import { vi } from 'vitest';

import { TicketPriority } from '../../../api/generated/model/ticketPriority';
import { TicketStatus } from '../../../api/generated/model/ticketStatus';
import { AppError } from '../../../platform/http/app-error';
import { TicketsDataAccess } from '../data-access/tickets-data-access';
import { Ticket } from '../domain/ticket';
import { CreateTicketPage } from './create-ticket.page';

const CREATED_TICKET: Ticket = {
  id: 17,
  ticketNumber: 'TKT-17',
  title: 'Printer unavailable',
  description: 'The third-floor printer is offline.',
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

describe('CreateTicketPage', () => {
  let fixture: ComponentFixture<CreateTicketPage>;
  let component: CreateTicketPage;
  let router: Router;
  const tickets = {
    listActiveCategories: vi.fn<() => Observable<readonly { id: number; name: string }[]>>(),
    create: vi.fn<() => Observable<Ticket>>(),
  };

  async function render(
    categories: Observable<readonly { id: number; name: string }[]> = of([
      { id: 4, name: 'Hardware' },
    ]),
  ): Promise<void> {
    tickets.listActiveCategories.mockReturnValue(categories);
    await TestBed.configureTestingModule({
      imports: [CreateTicketPage],
      providers: [provideRouter([]), { provide: TicketsDataAccess, useValue: tickets }],
    }).compileComponents();
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(CreateTicketPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    tickets.create.mockReturnValue(of(CREATED_TICKET));
  });

  it('validates required ticket details before submission', async () => {
    await render();

    submitForm();

    expect(tickets.create).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Enter a title.');
    expect(fixture.nativeElement.textContent).toContain('Enter a description.');
  });

  it('creates a trimmed ticket and redirects to its detail page', async () => {
    await render();
    component.form.setValue({
      title: '  Printer unavailable  ',
      description: '  The third-floor printer is offline.  ',
      categoryId: 4,
    });

    submitForm();

    expect(tickets.create).toHaveBeenCalledWith({
      title: 'Printer unavailable',
      description: 'The third-floor printer is offline.',
      category_id: 4,
    });
    expect(router.navigate).toHaveBeenCalledWith(['/tickets', 17]);
    expect(component.hasUnsavedChanges()).toBe(false);
  });

  it('does not redirect when ticket creation completes after the component is destroyed', async () => {
    const response = new Subject<Ticket>();
    tickets.create.mockReturnValue(response);
    await render();
    component.form.setValue({
      title: 'Printer unavailable',
      description: 'The third-floor printer is offline.',
      categoryId: 4,
    });

    submitForm();
    fixture.destroy();
    expect(response.observed).toBe(false);
    response.next(CREATED_TICKET);

    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('prevents duplicate ticket submissions while creation is in flight', async () => {
    const response = new Subject<Ticket>();
    tickets.create.mockReturnValue(response);
    await render();
    component.form.setValue({
      title: 'Printer unavailable',
      description: 'The third-floor printer is offline.',
      categoryId: 4,
    });

    submitForm();
    submitForm();

    expect(tickets.create).toHaveBeenCalledOnce();
    response.complete();
  });

  it('shows a safe retry state when categories cannot be loaded', async () => {
    await render(throwError(() => new AppError('unavailable', 503)));

    expect(fixture.nativeElement.textContent).toContain('Categories are temporarily unavailable');
    expect(fixture.nativeElement.textContent).toContain('Your draft will be preserved');
  });

  it('maps normalized backend validation errors to the matching field', async () => {
    tickets.create.mockReturnValue(
      throwError(
        () =>
          new AppError('validation', 422, 'VALIDATION_ERROR', undefined, [
            { field: 'title', message: 'Title was not accepted.' },
          ]),
      ),
    );
    await render();
    component.form.setValue({
      title: 'Printer unavailable',
      description: 'The printer is offline.',
      categoryId: 4,
    });

    submitForm();

    expect(component.form.controls.title.hasError('server')).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Title was not accepted.');
  });

  it('reloads categories after a stale-category response while preserving the draft', async () => {
    tickets.create.mockReturnValue(throwError(() => new AppError('conflict', 409)));
    await render();
    component.form.setValue({
      title: 'Printer unavailable',
      description: 'The printer is offline.',
      categoryId: 4,
    });

    submitForm();

    expect(fixture.nativeElement.textContent).toContain('Reload the categories');
    const reloadButton = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((button) => button.textContent?.includes('Reload categories'));
    expect(reloadButton).toBeDefined();

    tickets.listActiveCategories.mockReturnValue(of([{ id: 5, name: 'Software' }]));
    reloadButton?.click();
    fixture.detectChanges();

    expect(tickets.listActiveCategories).toHaveBeenCalledTimes(2);
    expect(component.form.controls.title.value).toBe('Printer unavailable');
    expect(component.form.controls.description.value).toBe('The printer is offline.');
    expect(component.form.controls.categoryId.value).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('The selected category is no longer');
  });

  function submitForm(): void {
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }
});
