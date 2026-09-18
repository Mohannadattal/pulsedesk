import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { catchError, map, of, startWith, Subject, switchMap, tap } from 'rxjs';

import { CustomerSearchKind } from '../../../api/generated/model/customerSearchKind';
import { UserRole } from '../../../api/generated/model/userRole';
import { AuthSessionStore } from '../../../platform/auth/auth-session.store';
import { AppError, normalizeHttpError } from '../../../platform/http/app-error';
import { PageMessageComponent } from '../../../shared/ui/page-message/page-message.component';
import { CustomersDataAccess } from '../data-access/customers-data-access';
import { CustomerPage } from '../domain/customer';

type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly page: CustomerPage }
  | { readonly kind: 'error'; readonly error: AppError; readonly query: Query };

interface Query {
  readonly kind: CustomerSearchKind;
  readonly value: string;
  readonly showInactive: boolean;
  readonly page: number;
  readonly pageSize: number;
}

interface SearchRequest {
  readonly query: Query;
  readonly clearDraftOnSuccess: boolean;
}

@Component({
  selector: 'app-customer-list-page',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatSelectModule,
    PageMessageComponent,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './customer-list.page.html',
  styleUrl: './customer-list.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerListPage {
  private readonly customers = inject(CustomersDataAccess);
  protected readonly session = inject(AuthSessionStore);
  protected readonly isAdmin = this.session.currentUser()?.role === UserRole.ADMIN;
  protected readonly searchKinds = [
    { value: CustomerSearchKind.NAME, label: 'Name' },
    { value: CustomerSearchKind.CUSTOMER_NUMBER, label: 'Customer number' },
    { value: CustomerSearchKind.EMAIL, label: 'Email' },
    { value: CustomerSearchKind.PHONE, label: 'Phone' },
  ];
  protected readonly form = new FormGroup({
    kind: new FormControl(CustomerSearchKind.NAME, { nonNullable: true }),
    value: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(254)] }),
    includeInactive: new FormControl(false, { nonNullable: true }),
  });
  protected readonly state = signal<State>({ kind: 'idle' });
  private readonly searchValueInput = viewChild<ElementRef<HTMLInputElement>>('searchValueInput');
  private currentQuery: Query | null = null;
  private readonly requests = new Subject<SearchRequest | null>();

  constructor() {
    this.requests
      .pipe(
        switchMap((request) => {
          if (!request) return of<State>({ kind: 'idle' });
          const { query } = request;
          const isActive = query.showInactive ? false : true;
          return this.customers
            .search(query.kind, query.value, isActive, query.page, query.pageSize)
            .pipe(
              tap(() => {
                this.currentQuery = query;
                if (
                  request.clearDraftOnSuccess &&
                  this.form.controls.value.value.trim() === query.value
                ) {
                  this.form.controls.value.setValue('');
                  this.searchValueInput()?.nativeElement.focus();
                }
              }),
              map((page): State => ({ kind: 'loaded', page })),
              startWith<State>({ kind: 'loading' }),
              catchError((error: unknown) =>
                of<State>({ kind: 'error', error: normalizeHttpError(error), query }),
              ),
            );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.state.set(state));
  }

  protected submitSearch(): void {
    if (this.form.invalid) return;
    const value = this.form.controls.value.value.trim();
    if (!value) return;
    this.requests.next({
      query: {
        kind: this.form.controls.kind.value,
        value,
        showInactive: this.isAdmin && this.form.controls.includeInactive.value,
        page: 1,
        pageSize: this.currentQuery?.pageSize ?? 20,
      },
      clearDraftOnSuccess: true,
    });
  }

  protected clearSearch(): void {
    this.form.reset({
      kind: CustomerSearchKind.NAME,
      value: '',
      includeInactive: false,
    });
    this.currentQuery = null;
    this.requests.next(null);
  }

  protected pageChanged(event: PageEvent): void {
    if (!this.currentQuery) return;
    this.requests.next({
      query: {
        ...this.currentQuery,
        page: event.pageIndex + 1,
        pageSize: event.pageSize,
      },
      clearDraftOnSuccess: false,
    });
  }

  protected retry(): void {
    const state = this.state();
    if (state.kind === 'error')
      this.requests.next({ query: state.query, clearDraftOnSuccess: true });
  }
}
