import hashlib
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr
from typing import Protocol

from app.models.customer_email_delivery import CustomerEmailDelivery
from app.services.customer_email_templates import RenderedCustomerEmail


class EmailTransport(Protocol):
    def send(self, message: EmailMessage) -> None: ...


def build_customer_email_message(
    delivery: CustomerEmailDelivery,
    rendered: RenderedCustomerEmail,
    *,
    from_address: str,
    from_name: str,
    reply_to: str | None,
) -> EmailMessage:
    message = EmailMessage()
    message["Subject"] = rendered.subject
    message["From"] = formataddr((from_name, from_address))
    message["To"] = delivery.recipient_email
    if reply_to:
        message["Reply-To"] = reply_to
    message["Message-ID"] = stable_message_id(
        delivery.idempotency_key,
        from_address=from_address,
    )
    message.set_content(rendered.text_body)
    message.add_alternative(rendered.html_body, subtype="html")
    return message


def stable_message_id(idempotency_key: str, *, from_address: str) -> str:
    digest = hashlib.sha256(idempotency_key.encode("utf-8")).hexdigest()[:32]
    domain = from_address.rpartition("@")[2] or "localhost"
    return f"<pulsedesk-{digest}@{domain}>"


class SmtpEmailTransport:
    def __init__(
        self,
        *,
        host: str,
        port: int,
        username: str | None,
        password: str | None,
        use_tls: bool,
        timeout_seconds: int,
    ) -> None:
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.use_tls = use_tls
        self.timeout_seconds = timeout_seconds

    def send(self, message: EmailMessage) -> None:
        with smtplib.SMTP(
            self.host,
            self.port,
            timeout=self.timeout_seconds,
        ) as client:
            client.ehlo()
            if self.use_tls:
                client.starttls(context=ssl.create_default_context())
                client.ehlo()
            if self.username is not None:
                client.login(self.username, self.password or "")
            client.send_message(message)
