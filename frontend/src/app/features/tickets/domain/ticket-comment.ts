import { CommentVisibility } from '../../../api/generated/model/commentVisibility';
import { TicketCommentResponse } from '../../../api/generated/model/ticketCommentResponse';
import { DisplayReference, parseUtcTimestamp } from './ticket';

export interface TicketComment {
  readonly id: number;
  readonly ticketId: number;
  readonly authorId: number;
  readonly author: DisplayReference;
  readonly content: string;
  readonly visibility: CommentVisibility;
  readonly createdAt: Date;
}

export interface TicketCommentPage {
  readonly items: readonly TicketComment[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export function mapTicketComment(dto: TicketCommentResponse): TicketComment {
  return {
    id: dto.id,
    ticketId: dto.ticket_id,
    authorId: dto.author_id,
    author: {
      id: dto.author.id,
      name: `${dto.author.first_name} ${dto.author.last_name}`.trim(),
    },
    content: dto.content,
    visibility: dto.visibility,
    createdAt: parseUtcTimestamp(dto.created_at),
  };
}
