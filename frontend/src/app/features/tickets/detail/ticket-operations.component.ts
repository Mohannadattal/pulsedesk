import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { catchError, forkJoin, map, Observable, of, take, tap } from 'rxjs';

import { TicketPriority } from '../../../api/generated/model/ticketPriority';
import { TicketStatus } from '../../../api/generated/model/ticketStatus';
import { UserRole } from '../../../api/generated/model/userRole';
import { AppError, normalizeHttpError } from '../../../platform/http/app-error';
import { TicketsDataAccess } from '../data-access/tickets-data-access';
import { Category } from '../domain/category';
import { Ticket } from '../domain/ticket';
import { TICKET_PRIORITIES } from '../domain/ticket-filters';
import { AgentDirectoryEntry } from '../domain/user-directory';

type OperationKind = 'assignment' | 'status' | 'priority' | 'category';

interface MutationIntent {
  readonly kind: OperationKind;
  readonly value: number | null | TicketStatus | TicketPriority;
  readonly resolutionSummary?: string;
}

type RecoveryOutcome<T> =
  | { readonly kind: 'success'; readonly value: T }
  | { readonly kind: 'failure'; readonly error: AppError };

const NEXT_STATUS: Partial<Record<TicketStatus, TicketStatus>> = {
  [TicketStatus.OPEN]: TicketStatus.IN_PROGRESS,
  [TicketStatus.IN_PROGRESS]: TicketStatus.RESOLVED,
  [TicketStatus.RESOLVED]: TicketStatus.CLOSED,
};

const RESOLUTION_SUMMARY_MAX_LENGTH = 2_000;
const nonWhitespace: ValidatorFn = (control: AbstractControl<string>): ValidationErrors | null =>
  control.value.trim().length > 0 ? null : { whitespace: true };

export function canOperateTicket(role: UserRole | undefined): boolean {
  return role === UserRole.AGENT || role === UserRole.ADMIN;
}

@Component({
  selector: 'app-ticket-operations',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    ReactiveFormsModule,
  ],
  templateUrl: './ticket-operations.component.html',
  styleUrl: './ticket-operations.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TicketOperationsComponent {
  private readonly tickets = inject(TicketsDataAccess);
  private readonly destroyRef = inject(DestroyRef);

  readonly ticket = input.required<Ticket>();
  readonly ticketUpdated = output<Ticket>();
  readonly ticketNotFound = output<void>();

  protected readonly priorities = TICKET_PRIORITIES;
  protected readonly agents = signal<readonly AgentDirectoryEntry[]>([]);
  protected readonly categories = signal<readonly Category[]>([]);
  protected readonly agentsUnavailable = signal(false);
  protected readonly categoriesUnavailable = signal(false);
  protected readonly busyOperation = signal<OperationKind | 'recovery' | null>(null);
  protected readonly recoveryRequired = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly successMessage = signal<string | null>(null);
  protected readonly retryIntent = signal<MutationIntent | null>(null);
  protected readonly resolutionFormOpen = signal(false);

  protected readonly assignment = new FormControl<number | null>(null);
  protected readonly priority = new FormControl<TicketPriority>(TicketPriority.MEDIUM, {
    nonNullable: true,
  });
  protected readonly category = new FormControl<number | null>(null);
  protected readonly resolutionSummary = new FormControl('', {
    nonNullable: true,
    validators: [
      Validators.required,
      nonWhitespace,
      Validators.maxLength(RESOLUTION_SUMMARY_MAX_LENGTH),
    ],
  });
  protected readonly resolutionSummaryMaxLength = RESOLUTION_SUMMARY_MAX_LENGTH;

  constructor() {
    effect(() => {
      const ticket = this.ticket();
      this.assignment.setValue(ticket.assignee?.id ?? null, { emitEvent: false });
      this.priority.setValue(ticket.priority, { emitEvent: false });
      this.category.setValue(ticket.category.id, { emitEvent: false });
    });
    effect(() => {
      const gated = this.busyOperation() !== null || this.recoveryRequired();
      this.setControlDisabled(this.assignment, gated || this.agentsUnavailable());
      this.setControlDisabled(this.priority, gated);
      this.setControlDisabled(this.category, gated || this.categoriesUnavailable());
    });
    this.loadAgents();
    this.loadCategories();
  }

  protected get controlsDisabled(): boolean {
    return this.busyOperation() !== null || this.recoveryRequired();
  }

  protected nextStatus(): TicketStatus | undefined {
    return NEXT_STATUS[this.ticket().status];
  }

  protected updateAssignment(): void {
    if (!this.assignmentIsEligible()) {
      return;
    }
    this.mutate({ kind: 'assignment', value: this.assignment.value });
  }

  protected advanceStatus(): void {
    const status = this.nextStatus();
    if (status === TicketStatus.RESOLVED) {
      this.openResolutionForm();
    } else if (status) {
      this.mutate({ kind: 'status', value: status });
    }
  }

  protected openResolutionForm(): void {
    if (!this.controlsDisabled) {
      this.errorMessage.set(null);
      this.successMessage.set(null);
      this.resolutionFormOpen.set(true);
    }
  }

  protected cancelResolution(): void {
    if (this.busyOperation() !== null) {
      return;
    }
    this.resolutionFormOpen.set(false);
    this.resolutionSummary.reset();
    this.errorMessage.set(null);
    this.retryIntent.set(null);
  }

  protected resolveTicket(event?: Event): void {
    event?.preventDefault();
    this.resolutionSummary.markAsTouched();
    if (this.resolutionSummary.invalid || this.controlsDisabled) {
      return;
    }
    this.mutate({
      kind: 'status',
      value: TicketStatus.RESOLVED,
      resolutionSummary: this.resolutionSummary.value.trim(),
    });
  }

  protected updatePriority(): void {
    this.mutate({ kind: 'priority', value: this.priority.value });
  }

  protected updateCategory(): void {
    const categoryId = this.category.value;
    if (categoryId !== null && this.categoryIsActive()) {
      this.mutate({ kind: 'category', value: categoryId });
    }
  }

  protected assignmentIsEligible(): boolean {
    const selected = this.assignment.value;
    return selected === null || this.agents().some((agent) => agent.id === selected);
  }

  protected categoryIsActive(): boolean {
    const selected = this.category.value;
    return selected !== null && this.categories().some((category) => category.id === selected);
  }

  protected retryMutation(): void {
    const intent = this.retryIntent();
    if (intent) {
      this.mutate(intent);
    }
  }

  protected retryRecovery(): void {
    this.recover('all', 'Ticket data refreshed. Review the current values before trying again.');
  }

  protected retryAgents(): void {
    this.loadAgents();
  }

  protected retryCategories(): void {
    this.loadCategories();
  }

  protected progressLabel(): string {
    const operation = this.busyOperation();
    return operation === 'recovery'
      ? 'Refreshing ticket data…'
      : `Saving ${operation ?? 'ticket'} change…`;
  }

  protected enumLabel(value: TicketStatus | TicketPriority): string {
    return value
      .toLowerCase()
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private mutate(intent: MutationIntent): void {
    if (this.controlsDisabled) {
      return;
    }

    this.busyOperation.set(intent.kind);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.retryIntent.set(null);
    this.requestFor(intent)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (ticket) => {
          this.busyOperation.set(null);
          this.ticketUpdated.emit(ticket);
          if (intent.kind === 'status' && intent.value === TicketStatus.RESOLVED) {
            this.resolutionFormOpen.set(false);
            this.resolutionSummary.reset();
            this.successMessage.set('Ticket resolved.');
          } else {
            this.successMessage.set(this.successFor(intent.kind));
          }
        },
        error: (error: unknown) => this.handleMutationError(intent, normalizeHttpError(error)),
      });
  }

  private requestFor(intent: MutationIntent): Observable<Ticket> {
    const ticketId = this.ticket().id;
    switch (intent.kind) {
      case 'assignment':
        return this.tickets.updateAssignment(ticketId, intent.value as number | null);
      case 'status': {
        const status = intent.value as TicketStatus;
        return status === TicketStatus.RESOLVED
          ? this.tickets.updateStatus(ticketId, status, intent.resolutionSummary)
          : this.tickets.updateStatus(ticketId, status);
      }
      case 'priority':
        return this.tickets.updatePriority(ticketId, intent.value as TicketPriority);
      case 'category':
        return this.tickets.updateCategory(ticketId, intent.value as number);
    }
  }

  private handleMutationError(intent: MutationIntent, error: AppError): void {
    if (
      error.kind === 'not-found' &&
      !(intent.kind === 'category' && error.code === 'CATEGORY_NOT_FOUND')
    ) {
      this.busyOperation.set(null);
      this.ticketNotFound.emit();
      return;
    }

    if (intent.kind === 'status' && error.kind === 'conflict') {
      this.errorMessage.set(
        'The displayed workflow was stale. PulseDesk is reloading the authoritative ticket.',
      );
      this.busyOperation.set(null);
      this.recover(
        'ticket',
        'The displayed workflow was stale. Ticket reloaded; review its current status.',
      );
      return;
    }

    if (
      intent.kind === 'category' &&
      (error.kind === 'conflict' ||
        (error.kind === 'not-found' && error.code === 'CATEGORY_NOT_FOUND'))
    ) {
      this.errorMessage.set(
        'That category is no longer an active choice. PulseDesk is refreshing the ticket and categories.',
      );
      this.busyOperation.set(null);
      this.recover(
        'category',
        'That category is no longer active. Ticket and active categories refreshed.',
      );
      return;
    }

    if (
      intent.kind === 'assignment' &&
      error.kind === 'validation' &&
      error.code === 'INVALID_TICKET_ASSIGNEE'
    ) {
      this.errorMessage.set(
        'The selected Agent is no longer eligible. PulseDesk is refreshing the ticket and Agent directory.',
      );
      this.busyOperation.set(null);
      this.recover(
        'assignment',
        'The selected Agent is no longer eligible. Ticket and eligible Agents refreshed.',
      );
      return;
    }

    this.busyOperation.set(null);
    if (
      intent.kind === 'status' &&
      intent.value === TicketStatus.RESOLVED &&
      error.code === 'INVALID_RESOLUTION_SUMMARY'
    ) {
      this.errorMessage.set(
        'Enter a customer-facing resolution summary between 1 and 2,000 characters.',
      );
      return;
    }
    if (error.kind === 'forbidden') {
      this.errorMessage.set(`You do not have permission to change this ticket’s ${intent.kind}.`);
      return;
    }
    if (error.kind === 'validation') {
      this.errorMessage.set(
        error.validationErrors.map((item) => item.message).join(' ') ||
          `The ${intent.kind} value was not accepted.`,
      );
      return;
    }
    if (error.kind === 'network' || error.kind === 'unavailable') {
      if (!(intent.kind === 'status' && intent.value === TicketStatus.RESOLVED)) {
        this.retryIntent.set(intent);
      }
      this.errorMessage.set(
        error.kind === 'network'
          ? 'PulseDesk could not be reached. The last confirmed ticket is still shown.'
          : 'Ticket updates are temporarily unavailable. The last confirmed ticket is still shown.',
      );
      return;
    }
    this.errorMessage.set(
      'The ticket could not be updated. The last confirmed values are still shown.',
    );
  }

  private recover(
    scope: 'ticket' | 'category' | 'assignment' | 'all',
    successMessage: string,
  ): void {
    if (this.busyOperation() !== null) {
      return;
    }

    const recoveryTicket = this.ticket();
    this.busyOperation.set('recovery');
    this.recoveryRequired.set(true);
    this.retryIntent.set(null);

    const ticketRequest = this.recoveryOutcome(
      this.tickets.get(recoveryTicket.id).pipe(
        tap((ticket) => {
          if (this.ticket() === recoveryTicket) {
            this.ticketUpdated.emit(ticket);
          }
        }),
      ),
    );
    const categoryRequest =
      scope === 'category' || scope === 'all'
        ? this.recoveryOutcome(this.tickets.listActiveCategories())
        : of(null);
    const agentRequest =
      scope === 'assignment' || scope === 'all'
        ? this.recoveryOutcome(this.tickets.listActiveAgents())
        : of(null);

    forkJoin({ ticket: ticketRequest, categories: categoryRequest, agents: agentRequest })
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          if (result.categories?.kind === 'success') {
            this.categories.set(result.categories.value);
            this.categoriesUnavailable.set(false);
          } else if (result.categories?.kind === 'failure') {
            this.categoriesUnavailable.set(true);
          }
          if (result.agents?.kind === 'success') {
            this.agents.set(result.agents.value);
            this.agentsUnavailable.set(false);
          } else if (result.agents?.kind === 'failure') {
            this.agentsUnavailable.set(true);
          }
          this.busyOperation.set(null);

          if (result.ticket.kind === 'failure') {
            const error = result.ticket.error;
            if (error.kind === 'not-found' && error.code !== 'CATEGORY_NOT_FOUND') {
              this.recoveryRequired.set(false);
              this.ticketNotFound.emit();
              return;
            }
            this.errorMessage.set(
              error.kind === 'forbidden'
                ? 'You do not have permission to reload current ticket data. Operational controls remain disabled.'
                : 'Current ticket data could not be reloaded. Operational controls remain disabled.',
            );
            return;
          }

          this.recoveryRequired.set(false);
          const categoriesFailed = result.categories?.kind === 'failure';
          const agentsFailed = result.agents?.kind === 'failure';
          if (categoriesFailed || agentsFailed) {
            this.successMessage.set(null);
            this.errorMessage.set(
              categoriesFailed && agentsFailed
                ? 'Ticket reloaded, but active categories and eligible Agents could not be refreshed. Those controls remain unavailable.'
                : categoriesFailed
                  ? 'Ticket reloaded, but active categories could not be refreshed. Category changes remain unavailable.'
                  : 'Ticket reloaded, but eligible Agents could not be refreshed. Assignment changes remain unavailable.',
            );
          } else {
            this.errorMessage.set(null);
            this.successMessage.set(successMessage);
          }
        },
      });
  }

  private recoveryOutcome<T>(request: Observable<T>): Observable<RecoveryOutcome<T>> {
    return request.pipe(
      take(1),
      map((value): RecoveryOutcome<T> => ({ kind: 'success', value })),
      catchError((error: unknown) =>
        of<RecoveryOutcome<T>>({ kind: 'failure', error: normalizeHttpError(error) }),
      ),
    );
  }

  private loadAgents(): void {
    this.tickets
      .listActiveAgents()
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (agents) => {
          this.agents.set(agents);
          this.agentsUnavailable.set(false);
        },
        error: () => this.agentsUnavailable.set(true),
      });
  }

  private loadCategories(): void {
    this.tickets
      .listActiveCategories()
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (categories) => {
          this.categories.set(categories);
          this.categoriesUnavailable.set(false);
        },
        error: () => this.categoriesUnavailable.set(true),
      });
  }

  private successFor(kind: OperationKind): string {
    switch (kind) {
      case 'assignment':
        return 'Assignment updated.';
      case 'status':
        return 'Status updated.';
      case 'priority':
        return 'Priority updated.';
      case 'category':
        return 'Category updated.';
    }
  }

  private setControlDisabled<T>(control: FormControl<T>, disabled: boolean): void {
    if (disabled && control.enabled) {
      control.disable({ emitEvent: false });
    } else if (!disabled && control.disabled) {
      control.enable({ emitEvent: false });
    }
  }
}
