# PulseDesk

> Modern Service Management, Simplified.

PulseDesk is a modern service desk and ticket management platform
designed to help teams organize, prioritize, assign, and resolve
support requests through a centralized workspace.

## ✨ Features

- Secure authentication and role-based access control
- Ticket creation, assignment, and lifecycle management
- Priorities, statuses, and categories
- Ticket comments and activity tracking
- Advanced filtering, sorting, and pagination
- Service desk dashboard and statistics
- User and team management
- RESTful API

## 🛠 Tech Stack

### Frontend
- Angular
- TypeScript
- Reactive Forms
- Angular Signals

### Backend
- Python
- FastAPI
- SQLAlchemy
- Pydantic
- Alembic

### Database
- MySQL

### Infrastructure
- Docker
- Docker Compose

## 🏗 Architecture

PulseDesk follows a layered architecture with clear separation
of concerns:

API → Services → Repositories → ORM → Database

The backend is designed around OOP principles, dependency
injection, repository and service patterns, and modular
domain-oriented components.

## Notification retention

Notifications are retained for 90 days by default. Run the bounded cleanup command
once per day from the deployment scheduler (for example, cron or a platform scheduled
job):

```sh
docker compose exec -T backend python -m app.cli.cleanup_notifications
```

`NOTIFICATION_RETENTION_DAYS`, `NOTIFICATION_CLEANUP_BATCH_SIZE`, and
`NOTIFICATION_CLEANUP_MAX_BATCHES` configure the cutoff and the maximum work performed
by one invocation. The command deletes and commits one batch at a time and is safe to
run repeatedly.
