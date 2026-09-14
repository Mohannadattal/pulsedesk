import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, Observable, switchMap, tap, throwError } from 'rxjs';

import { LoginRequest } from '../../api/generated/model/loginRequest';
import { UserResponse } from '../../api/generated/model/userResponse';
import { normalizeHttpError } from '../http/app-error';
import { AuthApi } from './auth-api';
import { TokenStorage } from './token-storage';

export type AuthSessionState =
  | { readonly status: 'restoring' }
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
    return state.status === 'authenticated' ? state.user : null;
  });
  readonly isAuthenticated = computed(() => this.status() === 'authenticated');

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
      this.authApi.currentUser().subscribe({
        next: (user) => {
          this.sessionState.set({ status: 'authenticated', user });
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

  signIn(credentials: LoginRequest): Observable<UserResponse> {
    return this.authApi.login(credentials).pipe(
      tap((response) => this.tokenStorage.write(response.access_token)),
      switchMap(() => this.authApi.currentUser()),
      tap((user) => this.sessionState.set({ status: 'authenticated', user })),
      catchError((error: unknown) => {
        this.endSession();
        return throwError(() => normalizeHttpError(error));
      }),
    );
  }

  endSession(): void {
    this.tokenStorage.clear();
    this.sessionState.set({ status: 'anonymous' });
  }
}
