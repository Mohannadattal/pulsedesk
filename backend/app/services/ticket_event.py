from datetime import datetime
from typing import TYPE_CHECKING, Any

from app.exceptions.auth import AuthorizationError
from app.models.ticket_comment import CommentVisibility
from app.models.ticket_event import TicketEvent, TicketEventType
from app.models.user import User, UserRole
from app.repositories.category import CategoryRepository
from app.repositories.ticket_event import TicketEventRepository
from app.repositories.user import UserRepository
from app.schemas.ticket_event import (
    TicketEventActorResponse,
    TicketEventCommentResponse,
    TicketEventListFilters,
    TicketEventListResponse,
    TicketEventOrder,
    TicketEventResponse,
)

if TYPE_CHECKING:
    from app.services.ticket import TicketService

MAX_UNSIGNED_BIGINT = 18_446_744_073_709_551_615


class TicketEventRecorder:
    """Persists events inside the transaction owned by the calling service."""

    # Stable, intentionally small internal JSON shape. Enum changes stay in the
    # raw audit columns; metadata only preserves presentation identities.
    ACTOR_DISPLAY_NAME = "actor_display_name"
    OLD_ASSIGNEE_DISPLAY_NAME = "old_assignee_display_name"
    NEW_ASSIGNEE_DISPLAY_NAME = "new_assignee_display_name"
    OLD_CATEGORY_DISPLAY_NAME = "old_category_display_name"
    NEW_CATEGORY_DISPLAY_NAME = "new_category_display_name"

    def __init__(self, ticket_event_repository: TicketEventRepository) -> None:
        self.ticket_event_repository = ticket_event_repository

    def record(
        self,
        *,
        ticket_id: int,
        actor: User,
        event_type: TicketEventType,
        created_at: datetime,
        field_name: str | None = None,
        old_value: str | None = None,
        new_value: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> TicketEvent:
        event_metadata = dict(metadata or {})
        event_metadata[self.ACTOR_DISPLAY_NAME] = display_name(actor)
        event = TicketEvent(
            ticket_id=ticket_id,
            actor_id=actor.id,
            event_type=event_type.value,
            field_name=field_name,
            old_value=old_value,
            new_value=new_value,
            event_metadata=event_metadata,
            created_at=created_at,
        )
        return self.ticket_event_repository.create(event)


class TicketEventService:
    def __init__(
        self,
        ticket_service: "TicketService",
        ticket_event_repository: TicketEventRepository,
        user_repository: UserRepository,
        category_repository: CategoryRepository,
    ) -> None:
        self.ticket_service = ticket_service
        self.ticket_event_repository = ticket_event_repository
        self.user_repository = user_repository
        self.category_repository = category_repository

    def list_events(
        self,
        ticket_id: int,
        filters: TicketEventListFilters,
        actor: User,
    ) -> TicketEventListResponse:
        self.ticket_service.get_ticket(ticket_id, actor)
        if actor.role not in {UserRole.AGENT.value, UserRole.ADMIN.value}:
            raise AuthorizationError

        events, total = self.ticket_event_repository.list_for_ticket(
            ticket_id,
            page=filters.page,
            page_size=filters.page_size,
            descending=filters.order == TicketEventOrder.DESC,
        )
        items = self._build_responses(events)
        return TicketEventListResponse(
            items=items,
            page=filters.page,
            page_size=filters.page_size,
            total=total,
            total_pages=(total + filters.page_size - 1) // filters.page_size,
        )

    def _build_responses(self, events: list[TicketEvent]) -> list[TicketEventResponse]:
        user_ids: set[int] = set()
        category_ids: set[int] = set()
        sanitized_events = [
            (event, self._sanitize_metadata(event)) for event in events
        ]

        for event, metadata in sanitized_events:
            if (
                event.actor_id is not None
                and self._snapshot(metadata, TicketEventRecorder.ACTOR_DISPLAY_NAME)
                is None
            ):
                user_ids.add(event.actor_id)
            if self._is_assignment_change(event):
                self._collect_missing_reference(
                    event.old_value,
                    metadata,
                    TicketEventRecorder.OLD_ASSIGNEE_DISPLAY_NAME,
                    user_ids,
                )
                self._collect_missing_reference(
                    event.new_value,
                    metadata,
                    TicketEventRecorder.NEW_ASSIGNEE_DISPLAY_NAME,
                    user_ids,
                )
            elif self._is_category_change(event):
                self._collect_missing_reference(
                    event.old_value,
                    metadata,
                    TicketEventRecorder.OLD_CATEGORY_DISPLAY_NAME,
                    category_ids,
                )
                self._collect_missing_reference(
                    event.new_value,
                    metadata,
                    TicketEventRecorder.NEW_CATEGORY_DISPLAY_NAME,
                    category_ids,
                )

        users = {
            user.id: display_name(user)
            for user in self.user_repository.get_display_references_by_ids(user_ids)
        }
        categories = {
            category.id: category.name
            for category in self.category_repository.get_display_references_by_ids(
                category_ids
            )
        }
        return [
            self._build_response(event, metadata, users, categories)
            for event, metadata in sanitized_events
        ]

    def _build_response(
        self,
        event: TicketEvent,
        metadata: dict[str, Any],
        users: dict[int, str],
        categories: dict[int, str],
    ) -> TicketEventResponse:
        actor_name = self._snapshot(
            metadata,
            TicketEventRecorder.ACTOR_DISPLAY_NAME,
        )
        if actor_name is None and event.actor_id is not None:
            actor_name = users.get(event.actor_id)
        actor = (
            TicketEventActorResponse(id=event.actor_id, display_name=actor_name)
            if actor_name is not None
            else None
        )

        old_display_value = None
        new_display_value = None
        if self._is_assignment_change(event):
            old_display_value = self._reference_display_value(
                event.old_value,
                metadata,
                TicketEventRecorder.OLD_ASSIGNEE_DISPLAY_NAME,
                users,
                "An unavailable user",
            )
            new_display_value = self._reference_display_value(
                event.new_value,
                metadata,
                TicketEventRecorder.NEW_ASSIGNEE_DISPLAY_NAME,
                users,
                "An unavailable user",
            )
        elif self._is_category_change(event):
            old_display_value = self._reference_display_value(
                event.old_value,
                metadata,
                TicketEventRecorder.OLD_CATEGORY_DISPLAY_NAME,
                categories,
                "An unavailable category",
            )
            new_display_value = self._reference_display_value(
                event.new_value,
                metadata,
                TicketEventRecorder.NEW_CATEGORY_DISPLAY_NAME,
                categories,
                "An unavailable category",
            )

        return TicketEventResponse(
            id=event.id,
            ticket_id=event.ticket_id,
            actor_id=event.actor_id,
            event_type=event.event_type,
            actor=actor,
            field_name=event.field_name,
            old_value=event.old_value,
            new_value=event.new_value,
            old_display_value=old_display_value,
            new_display_value=new_display_value,
            comment=self._comment_projection(event, metadata),
            metadata=metadata,
            created_at=event.created_at,
        )

    @classmethod
    def _sanitize_metadata(cls, event: TicketEvent) -> dict[str, Any]:
        raw_metadata = event.event_metadata
        if not isinstance(raw_metadata, dict):
            return {}

        metadata: dict[str, Any] = {}

        def copy_snapshot(key: str) -> None:
            value = cls._snapshot(raw_metadata, key)
            if value is not None:
                metadata[key] = value

        copy_snapshot(TicketEventRecorder.ACTOR_DISPLAY_NAME)

        if event.event_type == TicketEventType.ASSIGNEE_CHANGED.value:
            copy_snapshot(TicketEventRecorder.OLD_ASSIGNEE_DISPLAY_NAME)
            copy_snapshot(TicketEventRecorder.NEW_ASSIGNEE_DISPLAY_NAME)
        elif event.event_type == TicketEventType.CATEGORY_CHANGED.value:
            copy_snapshot(TicketEventRecorder.OLD_CATEGORY_DISPLAY_NAME)
            copy_snapshot(TicketEventRecorder.NEW_CATEGORY_DISPLAY_NAME)
        elif event.event_type == TicketEventType.COMMENT_ADDED.value:
            comment_id = raw_metadata.get("comment_id")
            if (
                isinstance(comment_id, int)
                and not isinstance(comment_id, bool)
                and 0 < comment_id <= MAX_UNSIGNED_BIGINT
            ):
                metadata["comment_id"] = comment_id

            visibility = raw_metadata.get("visibility")
            if isinstance(visibility, str) and visibility in {
                member.value for member in CommentVisibility
            }:
                metadata["visibility"] = visibility

        return metadata

    @staticmethod
    def _snapshot(metadata: dict[str, Any], key: str) -> str | None:
        value = metadata.get(key)
        return value.strip() if isinstance(value, str) and value.strip() else None

    @classmethod
    def _collect_missing_reference(
        cls,
        raw_value: str | None,
        metadata: dict[str, Any],
        snapshot_key: str,
        target: set[int],
    ) -> None:
        if cls._snapshot(metadata, snapshot_key) is not None:
            return
        parsed = cls._parse_reference_id(raw_value)
        if parsed is not None:
            target.add(parsed)

    @classmethod
    def _reference_display_value(
        cls,
        raw_value: str | None,
        metadata: dict[str, Any],
        snapshot_key: str,
        resolved: dict[int, str],
        unavailable_label: str,
    ) -> str | None:
        if raw_value is None:
            return None
        snapshot = cls._snapshot(metadata, snapshot_key)
        if snapshot is not None:
            return snapshot
        reference_id = cls._parse_reference_id(raw_value)
        if reference_id is None:
            return unavailable_label
        return resolved.get(reference_id, unavailable_label)

    @staticmethod
    def _parse_reference_id(value: str | None) -> int | None:
        if value is None or not value.isascii() or not value.isdigit():
            return None
        parsed = int(value)
        return parsed if 0 < parsed <= MAX_UNSIGNED_BIGINT else None

    @staticmethod
    def _is_assignment_change(event: TicketEvent) -> bool:
        return (
            event.event_type == TicketEventType.ASSIGNEE_CHANGED.value
            and event.field_name == "assigned_to_id"
        )

    @staticmethod
    def _is_category_change(event: TicketEvent) -> bool:
        return (
            event.event_type == TicketEventType.CATEGORY_CHANGED.value
            and event.field_name == "category_id"
        )

    @staticmethod
    def _comment_projection(
        event: TicketEvent,
        metadata: dict[str, Any],
    ) -> TicketEventCommentResponse | None:
        if event.event_type != TicketEventType.COMMENT_ADDED.value:
            return None
        comment_id = metadata.get("comment_id")
        visibility = metadata.get("visibility")
        if (
            not isinstance(comment_id, int)
            or isinstance(comment_id, bool)
            or comment_id <= 0
            or visibility not in {member.value for member in CommentVisibility}
        ):
            return None
        return TicketEventCommentResponse(
            id=comment_id,
            visibility=CommentVisibility(visibility),
        )


def display_name(user: User) -> str:
    return f"{user.first_name} {user.last_name}".strip()
