import { CanDeactivateFn } from '@angular/router';

export interface PendingTicketChanges {
  hasUnsavedChanges(): boolean;
}

export const pendingTicketChangesGuard: CanDeactivateFn<PendingTicketChanges> = (component) =>
  !component.hasUnsavedChanges() ||
  globalThis.confirm('Discard this ticket draft and leave the page?');
