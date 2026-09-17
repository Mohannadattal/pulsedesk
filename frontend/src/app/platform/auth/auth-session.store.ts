import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, Observable, tap, throwError } from 'rxjs';

import { AuthSessionResponse } from '../../api/generated/model/authSessionResponse';
import { CompletePasswordChangeRequest } from '../../api/generated/model/completePasswordChangeRequest';
import { LoginRequest } from '../../api/generated/model/loginRequest';
import { SessionType } from '../../api/generated/model/sessionType';
import { UserResponse } from '../../api/generated/model/userResponse';
import { normalizeHttpError } from '../http/app-error';
import { AuthApi } from './auth-api';
import { TokenStorage } from './token-storage';

export type AuthSessionState =
  | { readonly status: 'restoring' }
  | { readonly status: 'password-change-required'; readonly user: UserResponse }
  | { readonly status: 'authenticated'; readonly user: UserResponse }
  | { readonly status: 'anonymous' };

@Injectable({ providedIn: 'root' })
export class AuthSessionStore {
  private readonly authApi = inject(AuthApi);
  private readonly tokenStorage = inject(TokenStorage);
  private readonly sessionState = signal<AuthSessionState>({ status: 'restoring' });
  private restoration: Promise<void> | undefined;

  readonly state = this.sessionState.asReadonly();
  readonly status = computed(() => this.sessionState().status);
  readonly currentUser = computed(() => {
    const state = this.sessionState();
    return state.status === 'authenticated' || state.status === 'password-change-required'
      ? state.user
      : null;
  });
  readonly hasNormalSession = computed(() => this.status() === 'authenticated');
  readonly requiresPasswordChange = computed(() => this.status() === 'password-change-required');
  readonly isAuthenticated = this.hasNormalSession;

  restore(): Promise<void> {
    if (this.restoration) {
      return this.restoration;
    }

    const token = this.tokenStorage.read();
    if (!token) {
      this.sessionState.set({ status: 'anonymous' });
      this.restoration = Promise.resolve();
      return this.restoration;
    }

    this.restoration = new Promise<void>((resolve) => {
      this.authApi.currentSession().subscribe({
        next: (response) => {
          this.setSessionState(response.session_type, response.user);
          resolve();
        },
        error: (error: unknown) => {
          const appError = normalizeHttpError(error);
          if (appError.kind === 'authentication') {
            this.tokenStorage.clear();
          }
          this.sessionState.set({ status: 'anonymous' });
          resolve();
        },
      });
    });

    return this.restoration;
  }

  signIn(credentials: LoginRequest): Observable<AuthSessionResponse> {
    return this.authApi.login(credentials).pipe(
      tap((response) => this.acceptSession(response)),
      catchError((error: unknown) => {
        this.endSession();
        return throwError(() => normalizeHttpError(error));
      }),
    );
  }

  completePasswordChange(request: CompletePasswordChangeRequest): Observable<AuthSessionResponse> {
    return this.authApi.completePasswordChange(request).pipe(
      tap((response) => this.acceptSession(response)),
      catchError((error: unknown) => throwError(() => normalizeHttpError(error))),
    );
  }

  endSession(): void {
    this.tokenStorage.clear();
    this.sessionState.set({ status: 'anonymous' });
  }

  private acceptSession(response: AuthSessionResponse): void {
    this.tokenStorage.write(response.access_token);
    this.setSessionState(response.session_type, response.user);
  }

  private setSessionState(sessionType: SessionType, user: UserResponse): void {
    this.sessionState.set(
      sessionType === SessionType.PASSWORD_CHANGE_REQUIRED
        ? { status: 'password-change-required', user }
        : { status: 'authenticated', user },
    );
  }
}
