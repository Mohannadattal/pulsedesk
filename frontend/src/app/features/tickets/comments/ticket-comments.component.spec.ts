import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of, Subject, throwError } from 'rxjs';
import { vi } from 'vitest';

import { CommentVisibility } from '../../../api/generated/model/commentVisibility';
import { TicketPriority } from '../../../api/generated/model/ticketPriority';
import { TicketStatus } from '../../../api/generated/model/ticketStatus';
import { UserRole } from '../../../api/generated/model/userRole';
import { AuthSessionStore } from '../../../platform/auth/auth-session.store';
import { AppError } from '../../../platform/http/app-error';
import { TicketsDataAccess } from '../data-access/tickets-data-access';
import { TicketComment, TicketCommentPage } from '../domain/ticket-comment';
import { Ticket } from '../domain/ticket';
import { TicketCommentsComponent } from './ticket-comments.component';

const TICKET: Ticket = {
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
  createdAt: new Date('2026-09-15T08:00:00Z'),
  updatedAt: new Date('2026-09-15T08:00:00Z'),
  resolvedAt: null,
  closedAt: null,
};

const COMMENT: TicketComment = {
  id: 3,
  ticketId: 17,
  authorId: 9,
  author: { id: 9, name: 'Eli Employee' },
  content: 'Any update?',
  visibility: CommentVisibility.PUBLIC,
  createdAt: new Date('2026-09-15T09:00:00Z'),
};

const EMPTY_PAGE: TicketCommentPage = {
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 0,
};

describe('TicketCommentsComponent', () => {
  let fixture: ComponentFixture<TicketCommentsComponent>;
  const session = {
    currentUser: vi.fn(),
  };
  const tickets = {
    listComments: vi.fn<() => Observable<TicketCommentPage>>(),
    addComment: vi.fn<() => Observable<TicketComment>>(),
  };

  async function render(
    role: UserRole = UserRole.EMPLOYEE,
    comments: Observable<TicketCommentPage> = of(EMPTY_PAGE),
  ): Promise<void> {
    session.currentUser.mockReturnValue({
      id: 9,
      first_name: 'Eli',
      last_name: 'Employee',
      email: 'eli@example.com',
      role,
      is_active: true,
      created_at: '2026-09-01T08:00:00Z',
      updated_at: '2026-09-01T08:00:00Z',
    });
    tickets.listComments.mockReturnValue(comments);
    await TestBed.configureTestingModule({
      imports: [TicketCommentsComponent],
      providers: [
        { provide: AuthSessionStore, useValue: session },
        { provide: TicketsDataAccess, useValue: tickets },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TicketCommentsComponent);
    fixture.componentRef.setInput('ticket', TICKET);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    tickets.addComment.mockReturnValue(of(COMMENT));
  });

  it('does not expose an INTERNAL choice to an employee', async () => {
    await render();

    expect(fixture.nativeElement.querySelector('mat-select')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('INTERNAL');
    expect(fixture.nativeElement.textContent).toContain('Visible to you and the service team.');
  });

  it('rejects a whitespace-only comment without calling the API', async () => {
    await render();

    enterComment('   ');
    submitForm();

    expect(tickets.addComment).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Enter a comment.');
  });

  it('adds a trimmed public comment and refetches the server page', async () => {
    await render();
    tickets.listComments.mockReturnValue(
      of({ ...EMPTY_PAGE, items: [COMMENT], total: 1, totalPages: 1 }),
    );

    enterComment('  Any update?  ');
    submitForm();
    fixture.detectChanges();

    expect(tickets.addComment).toHaveBeenCalledWith(17, 'Any update?', CommentVisibility.PUBLIC);
    expect(tickets.listComments).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.textContent).toContain('Any update?');
    const successStatus = fixture.nativeElement.querySelector(
      '[role="status"][aria-live="polite"]',
    ) as HTMLElement;
    expect(successStatus.textContent).toContain('Comment added. Showing the newest comments.');
    expect((fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
  });

  it('resets the employee composer without displaying required validation after success', async () => {
    await render(UserRole.EMPLOYEE);

    enterComment('Employee update');
    submitForm();

    expect(tickets.addComment).toHaveBeenCalledWith(
      17,
      'Employee update',
      CommentVisibility.PUBLIC,
    );
    expectComposerToBeClean();
  });

  it('displays required validation when an employee submits empty after a successful reset', async () => {
    await render(UserRole.EMPLOYEE);

    enterComment('Employee update');
    submitForm();
    submitForm();

    expect(tickets.addComment).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.textContent).toContain('Enter a comment.');
  });

  it('uses authoritative post-submit totals to load the newest page', async () => {
    await render(UserRole.EMPLOYEE, of({ ...EMPTY_PAGE, page: 1, total: 19, totalPages: 1 }));
    tickets.listComments
      .mockReturnValueOnce(
        of({
          ...EMPTY_PAGE,
          page: 1,
          total: 42,
          totalPages: 3,
        }),
      )
      .mockReturnValueOnce(
        of({
          ...EMPTY_PAGE,
          items: [COMMENT],
          page: 3,
          total: 42,
          totalPages: 3,
        }),
      );

    enterComment('Any update?');
    submitForm();
    fixture.detectChanges();

    expect(tickets.listComments).toHaveBeenNthCalledWith(2, 17, 1, 20);
    expect(tickets.listComments).toHaveBeenNthCalledWith(3, 17, 3, 20);
    expect(fixture.nativeElement.textContent).toContain('Any update?');
    expect(fixture.nativeElement.textContent).toContain('42 comments');
  });

  it('prevents duplicate comment submissions while one is in flight', async () => {
    const response = new Subject<TicketComment>();
    tickets.addComment.mockReturnValue(response);
    await render();

    enterComment('Any update?');
    submitForm();
    submitForm();

    expect(tickets.addComment).toHaveBeenCalledOnce();
    response.complete();
  });

  it('does not mutate comment state or refresh after destruction', async () => {
    const response = new Subject<TicketComment>();
    tickets.addComment.mockReturnValue(response);
    await render();

    enterComment('Keep this draft');
    submitForm();
    const callsBeforeDestroy = tickets.listComments.mock.calls.length;
    fixture.destroy();

    response.next(COMMENT);
    response.complete();

    expect(fixture.componentInstance['commentForm'].controls.content.value).toBe('Keep this draft');
    expect(fixture.componentInstance['submissionSuccess']()).toBeNull();
    expect(fixture.componentInstance['submissionError']()).toBeNull();
    expect(tickets.listComments).toHaveBeenCalledTimes(callsBeforeDestroy);
  });

  it('does not clear or reset valid user-entered text after a failed submission', async () => {
    tickets.addComment.mockReturnValue(
      throwError(
        () =>
          new AppError('validation', 422, 'VALIDATION_ERROR', undefined, [
            { field: 'content', message: 'Comment was not accepted.' },
          ]),
      ),
    );
    await render();

    enterComment('Any update?');
    blurComment();
    submitForm();

    expect(fixture.nativeElement.textContent).toContain('Comment was not accepted.');
    expect((fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement).value).toBe(
      'Any update?',
    );
    expect(fixture.componentInstance['commentForm'].controls.content.dirty).toBe(true);
    expect(fixture.componentInstance['commentForm'].controls.content.touched).toBe(true);
  });

  it('resets an Agent INTERNAL composer without displaying required validation after success', async () => {
    await render(
      UserRole.AGENT,
      of({
        ...EMPTY_PAGE,
        items: [{ ...COMMENT, visibility: CommentVisibility.INTERNAL }],
        total: 1,
        totalPages: 1,
      }),
    );

    fixture.componentInstance['commentForm'].controls.visibility.setValue(
      CommentVisibility.INTERNAL,
    );
    enterComment('  Agent-only note  ');
    submitForm();

    expect(tickets.addComment).toHaveBeenCalledWith(
      17,
      'Agent-only note',
      CommentVisibility.INTERNAL,
    );
    expect(fixture.componentInstance['commentForm'].controls.visibility.value).toBe(
      CommentVisibility.INTERNAL,
    );
    expectComposerToBeClean();
    expect(fixture.nativeElement.textContent).toContain('Internal');
  });

  it('resets an Admin PUBLIC composer without displaying required validation after success', async () => {
    await render(UserRole.ADMIN);

    enterComment('Requester update');
    submitForm();

    expect(tickets.addComment).toHaveBeenCalledWith(
      17,
      'Requester update',
      CommentVisibility.PUBLIC,
    );
    expect(fixture.componentInstance['commentForm'].controls.visibility.value).toBe(
      CommentVisibility.PUBLIC,
    );
    expectComposerToBeClean();
  });

  it('allows an Agent to submit a PUBLIC comment explicitly', async () => {
    await render(UserRole.AGENT);

    enterComment('Public Agent update');
    submitForm();

    expect(tickets.addComment).toHaveBeenCalledWith(
      17,
      'Public Agent update',
      CommentVisibility.PUBLIC,
    );
  });

  it('displays required validation when support submits empty after a successful reset', async () => {
    await render(UserRole.AGENT);
    fixture.componentInstance['commentForm'].controls.visibility.setValue(
      CommentVisibility.INTERNAL,
    );

    enterComment('Agent-only note');
    submitForm();
    submitForm();

    expect(tickets.addComment).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.textContent).toContain('Enter a comment.');
    expect(fixture.componentInstance['commentForm'].controls.visibility.value).toBe(
      CommentVisibility.INTERNAL,
    );
  });

  it('does not change the current comment page when visibility changes', async () => {
    await render(UserRole.AGENT, of({ ...EMPTY_PAGE, page: 2, total: 30, totalPages: 2 }));
    const callsBefore = tickets.listComments.mock.calls.length;

    fixture.componentInstance['commentForm'].controls.visibility.setValue(
      CommentVisibility.INTERNAL,
    );
    fixture.detectChanges();

    expect(tickets.listComments).toHaveBeenCalledTimes(callsBefore);
  });

  function enterComment(value: string): void {
    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = value;
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function blurComment(): void {
    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    textarea.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
  }

  function expectComposerToBeClean(): void {
    const content = fixture.componentInstance['commentForm'].controls.content;
    expect((fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
    expect(content.pristine).toBe(true);
    expect(content.untouched).toBe(true);
    expect(fixture.nativeElement.textContent).not.toContain('Enter a comment.');
  }

  function submitForm(): void {
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }
});
