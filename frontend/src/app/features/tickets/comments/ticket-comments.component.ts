import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  filter,
  finalize,
  map,
  Observable,
  of,
  startWith,
  Subject,
  switchMap,
  take,
} from 'rxjs';

import { AuthSessionStore } from '../../../platform/auth/auth-session.store';
import { AppError, normalizeHttpError } from '../../../platform/http/app-error';
import { PageMessageComponent } from '../../../shared/ui/page-message/page-message.component';
import { LocalDateTimePipe } from '../../../shared/util/local-date-time.pipe';
import { TicketsDataAccess } from '../data-access/tickets-data-access';
import { TicketComment, TicketCommentPage } from '../domain/ticket-comment';
import { Ticket } from '../domain/ticket';

type CommentsState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly page: TicketCommentPage }
  | { readonly kind: 'error'; readonly error: AppError };

const COMMENTS_PAGE_SIZE = 20;

type CommentsPageRequest =
  | { readonly kind: 'page'; readonly page: number }
  | { readonly kind: 'newest' };

const nonWhitespace: ValidatorFn = (control: AbstractControl<string>): ValidationErrors | null =>
  control.value.trim().length > 0 ? null : { whitespace: true };

const maxUtf8Bytes =
  (maximum: number): ValidatorFn =>
  (control: AbstractControl<string>): ValidationErrors | null =>
    new TextEncoder().encode(control.value).length <= maximum ? null : { maxUtf8Bytes: true };

@Component({
  selector: 'app-ticket-comments',
  imports: [
    LocalDateTimePipe,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    PageMessageComponent,
    ReactiveFormsModule,
  ],
  templateUrl: './ticket-comments.component.html',
  styleUrl: './ticket-comments.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TicketCommentsComponent {
  private readonly tickets = inject(TicketsDataAccess);
  private readonly pageRequests = new BehaviorSubject<CommentsPageRequest>({
    kind: 'page',
    page: 1,
  });
  private readonly reloadRequests = new Subject<void>();

  readonly ticket = input<Ticket | null>(null);
  protected readonly session = inject(AuthSessionStore);
  protected readonly submitting = signal(false);
  protected readonly submissionError = signal<string | null>(null);
  protected readonly submissionSuccess = signal<string | null>(null);
  protected readonly contentServerError = signal<string | null>(null);
  protected readonly commentForm = new FormGroup({
    content: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, nonWhitespace, maxUtf8Bytes(65_535)],
    }),
  });

  private readonly commentRequests = combineLatest([
    toObservable(this.ticket).pipe(filter((ticket): ticket is Ticket => ticket !== null)),
    this.pageRequests,
    this.reloadRequests.pipe(startWith(undefined)),
  ]).pipe(
    switchMap(([ticket, pageRequest]) =>
      this.loadRequestedPage(ticket.id, pageRequest).pipe(
        map((commentPage): CommentsState => ({ kind: 'loaded', page: commentPage })),
        startWith<CommentsState>({ kind: 'loading' }),
        catchError((error: unknown) =>
          of<CommentsState>({ kind: 'error', error: normalizeHttpError(error) }),
        ),
      ),
    ),
  );

  protected readonly state = toSignal(this.commentRequests, {
    initialValue: { kind: 'loading' } as CommentsState,
  });

  constructor() {
    this.commentForm.controls.content.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.contentServerError.set(null);
      this.submissionError.set(null);
      this.submissionSuccess.set(null);
      const control = this.commentForm.controls.content;
      if (control.hasError('server')) {
        const remainingErrors = { ...control.errors };
        delete remainingErrors['server'];
        control.setErrors(Object.keys(remainingErrors).length > 0 ? remainingErrors : null);
      }
    });
  }

  protected changePage(event: PageEvent): void {
    this.pageRequests.next({ kind: 'page', page: event.pageIndex + 1 });
  }

  protected retry(): void {
    this.reloadRequests.next();
  }

  protected submitComment(): void {
    const ticket = this.ticket();
    if (
      ticket === null ||
      this.session.currentUser()?.role !== 'EMPLOYEE' ||
      this.commentForm.invalid ||
      this.submitting()
    ) {
      this.commentForm.markAllAsTouched();
      return;
    }

    const content = this.commentForm.controls.content.value.trim();
    this.submissionError.set(null);
    this.submissionSuccess.set(null);
    this.contentServerError.set(null);
    this.submitting.set(true);
    this.tickets
      .addPublicComment(ticket.id, content)
      .pipe(
        take(1),
        finalize(() => this.submitting.set(false)),
      )
      .subscribe({
        next: () => {
          this.commentForm.reset();
          this.submissionSuccess.set('Comment added. Showing the newest comments.');
          this.pageRequests.next({ kind: 'newest' });
        },
        error: (error: unknown) => this.handleSubmissionError(normalizeHttpError(error)),
      });
  }

  protected authorLabel(comment: TicketComment): string {
    const user = this.session.currentUser();
    if (user?.id === comment.authorId) {
      return `${comment.author.name} (you)`;
    }
    return comment.author.name;
  }

  protected commentsErrorTitle(error: AppError): string {
    switch (error.kind) {
      case 'forbidden':
        return 'You do not have access to these comments';
      case 'not-found':
        return 'Comments are no longer available';
      case 'network':
        return 'Comments could not be reached';
      case 'unavailable':
        return 'Comments are temporarily unavailable';
      default:
        return 'Comments could not be loaded';
    }
  }

  protected canRetry(error: AppError): boolean {
    return !['forbidden', 'not-found'].includes(error.kind);
  }

  private loadRequestedPage(
    ticketId: number,
    request: CommentsPageRequest,
  ): Observable<TicketCommentPage> {
    if (request.kind === 'page') {
      return this.tickets.listComments(ticketId, request.page, COMMENTS_PAGE_SIZE);
    }

    return this.tickets.listComments(ticketId, 1, COMMENTS_PAGE_SIZE).pipe(
      switchMap((firstPage) => {
        const lastPage = Math.max(1, firstPage.totalPages);
        return lastPage === 1
          ? of(firstPage)
          : this.tickets.listComments(ticketId, lastPage, COMMENTS_PAGE_SIZE);
      }),
    );
  }

  protected commentsErrorDetail(error: AppError): string {
    switch (error.kind) {
      case 'forbidden':
        return 'Your account is signed in, but it cannot view this conversation.';
      case 'not-found':
        return 'The ticket may have been removed or is no longer visible to your account.';
      default:
        return 'Try loading the conversation again.';
    }
  }

  private handleSubmissionError(error: AppError): void {
    const contentError = error.validationErrors.find((item) => item.field === 'content');
    if (error.kind === 'validation' && contentError) {
      this.contentServerError.set(contentError.message);
      this.commentForm.controls.content.setErrors({
        ...this.commentForm.controls.content.errors,
        server: true,
      });
      return;
    }

    switch (error.kind) {
      case 'forbidden':
        this.submissionError.set('Your account does not have permission to add this comment.');
        break;
      case 'not-found':
        this.submissionError.set('This ticket is no longer available.');
        break;
      case 'conflict':
        this.submissionError.set(
          'The comment conflicts with the ticket’s current state. Reload and try again.',
        );
        break;
      case 'network':
        this.submissionError.set(
          'PulseDesk could not be reached. Check your connection and try again.',
        );
        break;
      case 'unavailable':
        this.submissionError.set('Comments are temporarily unavailable. Please try again shortly.');
        break;
      default:
        this.submissionError.set('The comment could not be added. Please try again.');
    }
  }
}
