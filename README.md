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

## Customer email delivery

Customer-facing ticket email is staged transactionally in
`customer_email_deliveries` and sent outside HTTP requests.

The local development stack includes Mailpit. Start it with the rest of the stack and
open its web UI at <http://localhost:8025>:

```sh
docker compose up -d
```

Local Compose email delivery is enabled and fixed to the unauthenticated, non-TLS
Mailpit SMTP service at `mailpit:1025`. Mailpit is a local-only test sink: it captures
messages addressed to any recipient (including Gmail or Outlook addresses) without
delivering them to the public Internet. Prefer an obviously synthetic recipient such
as `thomas.mueller@example.com` for manual testing.

The `customer-email-worker` Compose service starts with the normal stack and processes
deliveries automatically. It drains bounded batches without delay while work remains,
then polls every five seconds by default. It exposes no port and can be restarted
independently from the API. Stop it gracefully with Compose as usual.

The one-shot processor remains available for diagnostics:

```sh
docker compose exec -T backend python -m app.cli.process_customer_email_deliveries
```

`EMAIL_DELIVERY_BATCH_SIZE` defaults to 50,
`EMAIL_PROCESSING_LEASE_MINUTES` defaults to 10, and
`EMAIL_DELIVERY_POLL_INTERVAL_SECONDS` defaults to 5 (valid range: greater than zero
through 300 seconds). Setting `EMAIL_DELIVERY_ENABLED=false` leaves the worker running
and polling without claiming or sending deliveries. Concurrent processors claim rows
with MySQL row locks and `SKIP LOCKED`, commit those claims before SMTP, and recover
stale claims after the lease. SMTP can accept a message immediately before a worker
dies without persisting `SENT`; a later retry can therefore duplicate that message.
The stable Message-ID improves traceability but is not an exactly-once guarantee.

Outside the local Compose environment, production remains provider-independent:
configure `SMTP_HOST`, `SMTP_PORT`, optional `SMTP_USERNAME` and `SMTP_PASSWORD`,
`SMTP_USE_TLS`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, and optional
`EMAIL_REPLY_TO`, then explicitly set `EMAIL_DELIVERY_ENABLED=true`. A configured
production SMTP provider can deliver to normal external customer addresses.
