import { TicketPriority } from '../../../api/generated/model/ticketPriority';
import { TicketStatus } from '../../../api/generated/model/ticketStatus';
import { mapTicket } from './ticket';

describe('mapTicket Customer projection', () => {
  const base = {
    id: 17,
    ticket_number: 'TKT-17',
    title: 'Help',
    description: 'Details',
    status: TicketStatus.OPEN,
    priority: TicketPriority.MEDIUM,
    category_id: 2,
    category: { id: 2, name: 'General' },
    created_by_id: 4,
    created_by: { id: 4, first_name: 'Eli', last_name: 'Employee' },
    assigned_to_id: null,
    assigned_to: null,
    resolution_summary: null,
    created_at: '2026-09-18T08:00:00Z',
    updated_at: '2026-09-18T08:00:00Z',
    resolved_at: null,
    closed_at: null,
  };

  it('maps only the narrow Customer reference and verification indicator', () => {
    const ticket = mapTicket({
      ...base,
      customer_id: 8,
      customer: { id: 8, customer_number: 'CUS-123', first_name: 'Thomas', last_name: 'Müller' },
      customer_was_verified: true,
    });
    expect(ticket.customer).toEqual({ id: 8, customerNumber: 'CUS-123', name: 'Thomas Müller' });
    expect(ticket.customerWasVerified).toBe(true);
    expect(ticket.customer).not.toHaveProperty('email');
  });

  it('preserves legacy tickets without a Customer', () => {
    const ticket = mapTicket({
      ...base,
      customer_id: null,
      customer: null,
      customer_was_verified: false,
    });
    expect(ticket.customer).toBeNull();
  });

  it('maps the stored customer-facing resolution summary', () => {
    const ticket = mapTicket({
      ...base,
      customer_id: null,
      customer: null,
      customer_was_verified: false,
      resolution_summary: 'Reconfigured the account and verified access.',
    });

    expect(ticket.resolutionSummary).toBe('Reconfigured the account and verified access.');
  });
});
