import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { vi } from 'vitest';

import { pendingTicketChangesGuard, PendingTicketChanges } from './pending-ticket-changes.guard';

describe('pendingTicketChangesGuard', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('allows navigation when the form has no meaningful unsaved changes', () => {
    const confirm = vi.fn();
    vi.stubGlobal('confirm', confirm);

    const result = pendingTicketChangesGuard(
      { hasUnsavedChanges: () => false },
      {} as ActivatedRouteSnapshot,
      {} as RouterStateSnapshot,
      {} as RouterStateSnapshot,
    );

    expect(result).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks before discarding a meaningful draft and honors cancellation', () => {
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirm);
    const component: PendingTicketChanges = { hasUnsavedChanges: () => true };

    const result = pendingTicketChangesGuard(
      component,
      {} as ActivatedRouteSnapshot,
      {} as RouterStateSnapshot,
      {} as RouterStateSnapshot,
    );

    expect(result).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
  });
});
