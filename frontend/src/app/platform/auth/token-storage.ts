import { inject, Injectable, InjectionToken } from '@angular/core';

const ACCESS_TOKEN_KEY = 'pulsedesk.access-token';

export const SESSION_STORAGE = new InjectionToken<Storage>('SESSION_STORAGE', {
  factory: () => sessionStorage,
});

@Injectable({ providedIn: 'root' })
export class TokenStorage {
  private readonly storage = inject(SESSION_STORAGE);

  read(): string | null {
    try {
      return this.storage.getItem(ACCESS_TOKEN_KEY);
    } catch {
      return null;
    }
  }

  write(token: string): void {
    this.storage.setItem(ACCESS_TOKEN_KEY, token);
  }

  clear(): void {
    try {
      this.storage.removeItem(ACCESS_TOKEN_KEY);
    } catch {
      // A denied storage operation must not keep the in-memory session alive.
    }
  }
}
