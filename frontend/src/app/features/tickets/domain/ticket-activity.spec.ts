import { CommentVisibility } from '../../../api/generated/model/commentVisibility';
import { TicketEventResponse } from '../../../api/generated/model/ticketEventResponse';
import { TicketEventType } from '../../../api/generated/model/ticketEventType';
import { mapTicketActivity } from './ticket-activity';

const BASE: TicketEventResponse = {
  id: 1,
  ticket_id: 17,
  event_type: TicketEventType.TICKET_CREATED,
  actor_id: 4,
  actor: { id: 4, display_name: 'Ada Agent' },
  field_name: null,
  old_value: null,
  new_value: null,
  old_display_value: null,
  new_display_value: null,
  comment: null,
  metadata: { should_not_appear: 'secret payload' },
  created_at: '2026-09-15T08:00:00Z',
};

function event(overrides: Partial<TicketEventResponse>): TicketEventResponse {
  return { ...BASE, ...overrides };
}

describe('mapTicketActivity', () => {
  it.each([
    [TicketEventType.TICKET_CREATED, 'Ada Agent created the ticket.', 'created'],
    [TicketEventType.TICKET_RESOLVED, 'Ada Agent resolved the ticket.', 'resolved'],
    [TicketEventType.TICKET_CLOSED, 'Ada Agent closed the ticket.', 'closed'],
  ] as const)('maps %s lifecycle activity', (eventType, description, kind) => {
    expect(mapTicketActivity(event({ event_type: eventType }))).toMatchObject({
      id: 1,
      description,
      kind,
    });
  });

  it('maps status and priority values to friendly labels', () => {
    expect(
      mapTicketActivity(
        event({
          event_type: TicketEventType.STATUS_CHANGED,
          field_name: 'status',
          old_value: 'OPEN',
          new_value: 'IN_PROGRESS',
        }),
      )?.description,
    ).toBe('Ada Agent changed status from Open to In progress.');
    expect(
      mapTicketActivity(
        event({
          event_type: TicketEventType.PRIORITY_CHANGED,
          field_name: 'priority',
          old_value: 'MEDIUM',
          new_value: 'URGENT',
        }),
      )?.description,
    ).toBe('Ada Agent changed priority from Medium to Urgent.');
  });

  it.each(['RESOLVED', 'CLOSED'])('suppresses the paired status transition to %s', (status) => {
    expect(
      mapTicketActivity(
        event({
          event_type: TicketEventType.STATUS_CHANGED,
          field_name: 'status',
          old_value: 'OPEN',
          new_value: status,
        }),
      ),
    ).toBeNull();
  });

  it('maps assignment, reassignment, and unassignment without exposing IDs', () => {
    const assigned = mapTicketActivity(
      event({
        event_type: TicketEventType.ASSIGNEE_CHANGED,
        field_name: 'assigned_to_id',
        new_value: '7',
        new_display_value: 'Grace Helper',
      }),
    );
    const reassigned = mapTicketActivity(
      event({
        event_type: TicketEventType.ASSIGNEE_CHANGED,
        field_name: 'assigned_to_id',
        old_value: '7',
        new_value: '8',
        old_display_value: 'Grace Helper',
        new_display_value: 'Lin Support',
      }),
    );
    const unassigned = mapTicketActivity(
      event({
        event_type: TicketEventType.ASSIGNEE_CHANGED,
        field_name: 'assigned_to_id',
        old_value: '8',
        old_display_value: 'Lin Support',
      }),
    );

    expect(assigned?.description).toBe('Ada Agent assigned the ticket to Grace Helper.');
    expect(reassigned?.description).toBe(
      'Ada Agent reassigned the ticket from Grace Helper to Lin Support.',
    );
    expect(unassigned?.description).toBe('Ada Agent unassigned the ticket.');
    expect(
      [assigned, reassigned, unassigned].map((item) => item?.description).join(' '),
    ).not.toMatch(/\b[78]\b/);
  });

  it('uses safe missing-reference and missing-actor labels', () => {
    expect(
      mapTicketActivity(
        event({
          actor: null,
          event_type: TicketEventType.ASSIGNEE_CHANGED,
          field_name: 'assigned_to_id',
          new_value: '9281',
          new_display_value: 'An unavailable user',
        }),
      )?.description,
    ).toBe('An unavailable user assigned the ticket to An unavailable user.');
    expect(
      mapTicketActivity(
        event({
          event_type: TicketEventType.CATEGORY_CHANGED,
          field_name: 'category_id',
          old_value: '44',
          new_value: '45',
          old_display_value: 'An unavailable category',
          new_display_value: 'Networking',
        }),
      )?.description,
    ).toBe('Ada Agent changed category from An unavailable category to Networking.');
  });

  it.each([
    [CommentVisibility.PUBLIC, 'Ada Agent added a public comment.'],
    [CommentVisibility.INTERNAL, 'Ada Agent added an internal comment.'],
  ])('maps %s comments as content-free actions', (visibility, description) => {
    const mapped = mapTicketActivity(
      event({
        event_type: TicketEventType.COMMENT_ADDED,
        comment: { id: 19, visibility },
        metadata: { comment_id: 19, visibility, content: 'must not render' },
      }),
    );

    expect(mapped?.description).toBe(description);
    expect(mapped?.description).not.toContain('must not render');
  });

  it.each([
    event({ event_type: 'FUTURE_EVENT' as TicketEventType }),
    event({
      event_type: TicketEventType.STATUS_CHANGED,
      field_name: 'status',
      old_value: 'OPEN',
      new_value: 'FUTURE',
    }),
    event({
      event_type: TicketEventType.PRIORITY_CHANGED,
      field_name: 'priority',
      old_value: null,
      new_value: 'HIGH',
    }),
    event({ event_type: TicketEventType.ASSIGNEE_CHANGED, field_name: 'assigned_to_id' }),
    event({
      event_type: TicketEventType.ASSIGNEE_CHANGED,
      field_name: 'assigned_to_id',
      old_value: undefined,
      new_value: '2',
      new_display_value: 'Grace Helper',
    }),
    event({
      event_type: TicketEventType.CATEGORY_CHANGED,
      field_name: 'category_id',
      old_value: '1',
      new_value: null,
    }),
    event({ event_type: TicketEventType.COMMENT_ADDED, comment: null }),
  ])('renders malformed or unknown data as a neutral fallback', (value) => {
    const mapped = mapTicketActivity(value);

    expect(mapped?.description).toBe('Unsupported ticket activity.');
    expect(mapped?.description).not.toContain('FUTURE');
  });

  it.each([
    event({
      event_type: TicketEventType.STATUS_CHANGED,
      field_name: null,
      old_value: 'OPEN',
      new_value: 'IN_PROGRESS',
    }),
    event({
      event_type: TicketEventType.STATUS_CHANGED,
      field_name: 'priority',
      old_value: 'OPEN',
      new_value: 'IN_PROGRESS',
    }),
    event({
      event_type: TicketEventType.PRIORITY_CHANGED,
      field_name: 'status',
      old_value: 'LOW',
      new_value: 'HIGH',
    }),
    event({
      event_type: TicketEventType.ASSIGNEE_CHANGED,
      field_name: 'category_id',
      old_value: null,
      new_value: '7',
      new_display_value: 'Grace Helper',
    }),
    event({
      event_type: TicketEventType.CATEGORY_CHANGED,
      field_name: 'assigned_to_id',
      old_value: '10',
      new_value: '11',
      old_display_value: 'Hardware',
      new_display_value: 'Networking',
    }),
  ])('requires the event-specific field contract', (value) => {
    expect(mapTicketActivity(value)).toMatchObject({
      description: 'Unsupported ticket activity.',
      kind: 'unsupported',
    });
  });

  it.each([
    event({
      event_type: TicketEventType.STATUS_CHANGED,
      field_name: 'priority',
      old_value: 'OPEN',
      new_value: 'RESOLVED',
    }),
    event({
      event_type: TicketEventType.STATUS_CHANGED,
      field_name: 'status',
      old_value: null,
      new_value: 'RESOLVED',
    }),
    event({
      event_type: TicketEventType.STATUS_CHANGED,
      field_name: 'status',
      old_value: 'FUTURE',
      new_value: 'RESOLVED',
    }),
  ])('does not suppress a malformed status-to-resolved event', (value) => {
    expect(mapTicketActivity(value)).toMatchObject({
      description: 'Unsupported ticket activity.',
      kind: 'unsupported',
    });
  });

  it.each([
    event({
      event_type: TicketEventType.ASSIGNEE_CHANGED,
      field_name: 'assigned_to_id',
      old_value: null,
      new_value: '7',
      new_display_value: null,
    }),
    event({
      event_type: TicketEventType.ASSIGNEE_CHANGED,
      field_name: 'assigned_to_id',
      old_value: '7',
      new_value: null,
      old_display_value: null,
    }),
    event({
      event_type: TicketEventType.CATEGORY_CHANGED,
      field_name: 'category_id',
      old_value: '10',
      new_value: '11',
      old_display_value: 'Hardware',
      new_display_value: null,
    }),
    event({
      event_type: TicketEventType.COMMENT_ADDED,
      comment: { id: 0, visibility: CommentVisibility.PUBLIC },
    }),
  ])('rejects malformed enriched presentation shapes', (value) => {
    expect(mapTicketActivity(value)?.description).toBe('Unsupported ticket activity.');
  });

  it('uses a neutral missing-time value for malformed timestamps', () => {
    expect(mapTicketActivity(event({ created_at: 'not-a-date' }))?.occurredAt).toBeNull();
  });
});
