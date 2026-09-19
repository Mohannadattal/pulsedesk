from dataclasses import dataclass
from html import escape

from app.models.customer_email_delivery import (
    CustomerEmailDelivery,
    CustomerEmailType,
)


@dataclass(frozen=True)
class RenderedCustomerEmail:
    subject: str
    text_body: str
    html_body: str


class CustomerEmailTemplateRenderer:
    def __init__(self, *, product_name: str, support_name: str) -> None:
        self.product_name = product_name
        self.support_name = support_name

    def render(self, delivery: CustomerEmailDelivery) -> RenderedCustomerEmail:
        if delivery.email_type == CustomerEmailType.TICKET_CREATED.value:
            return self._render_created(delivery)
        if delivery.email_type == CustomerEmailType.TICKET_RESOLVED.value:
            return self._render_resolved(delivery)
        raise ValueError("Unsupported customer email type.")

    def _render_created(self, delivery: CustomerEmailDelivery) -> RenderedCustomerEmail:
        subject = f"We received your request — {delivery.ticket_number}"
        text_body = (
            f"Hello {delivery.customer_first_name},\n\n"
            "We received your support request and registered it successfully.\n\n"
            f"Ticket: {delivery.ticket_number}\n"
            f"Title: {delivery.ticket_title}\n\n"
            f"The {self.support_name} team will review your request.\n\n"
            f"Regards,\n{self.product_name}"
        )
        content = (
            '<p style="margin:0 0 20px">We received your support request '
            "and registered it successfully.</p>"
            f"{self._ticket_card(delivery)}"
            f'<p style="margin:20px 0 0">The {escape(self.support_name)} '
            "team will review your request.</p>"
        )
        return RenderedCustomerEmail(
            subject=subject,
            text_body=text_body,
            html_body=self._layout(delivery.customer_first_name, content),
        )

    def _render_resolved(
        self, delivery: CustomerEmailDelivery
    ) -> RenderedCustomerEmail:
        if delivery.resolution_summary is None:
            raise ValueError("Resolved customer email is missing a resolution summary.")
        subject = f"Your support request has been resolved — {delivery.ticket_number}"
        text_body = (
            f"Hello {delivery.customer_first_name},\n\n"
            "Your support request has been resolved.\n\n"
            f"Ticket: {delivery.ticket_number}\n"
            f"Title: {delivery.ticket_title}\n\n"
            "Resolution\n"
            f"{delivery.resolution_summary}\n\n"
            f"Regards,\n{self.product_name}"
        )
        resolution = escape(delivery.resolution_summary).replace("\n", "<br>")
        content = (
            '<p style="margin:0 0 20px">Your support request has been '
            "resolved.</p>"
            f"{self._ticket_card(delivery)}"
            '<div style="margin-top:20px;padding:18px;border-left:4px solid '
            '#2563eb;background:#eff6ff;border-radius:4px">'
            '<h2 style="margin:0 0 8px;font-size:16px;color:#172554">'
            "Resolution</h2>"
            f'<p style="margin:0;color:#1e293b">{resolution}</p></div>'
        )
        return RenderedCustomerEmail(
            subject=subject,
            text_body=text_body,
            html_body=self._layout(delivery.customer_first_name, content),
        )

    @staticmethod
    def _ticket_card(delivery: CustomerEmailDelivery) -> str:
        return (
            '<div style="padding:18px;background:#f8fafc;border:1px solid '
            '#e2e8f0;border-radius:8px">'
            '<div style="font-size:12px;text-transform:uppercase;letter-spacing:'
            '.08em;color:#64748b">Ticket reference</div>'
            f'<div style="margin-top:4px;font-size:20px;font-weight:700;color:'
            f'#0f172a">{escape(delivery.ticket_number)}</div>'
            f'<div style="margin-top:8px;color:#334155">'
            f"{escape(delivery.ticket_title)}</div></div>"
        )

    def _layout(self, customer_first_name: str, content: str) -> str:
        product = escape(self.product_name)
        return (
            '<!doctype html><html><head><meta name="viewport" '
            'content="width=device-width,initial-scale=1"></head>'
            '<body style="margin:0;background:#f1f5f9;font-family:Arial,'
            'Helvetica,sans-serif;color:#1e293b;line-height:1.5">'
            '<table role="presentation" width="100%" cellspacing="0" '
            'cellpadding="0" style="background:#f1f5f9;padding:24px 12px">'
            '<tr><td align="center"><table role="presentation" width="100%" '
            'cellspacing="0" cellpadding="0" style="max-width:600px">'
            '<tr><td style="padding:18px 24px;background:#0f172a;color:#fff;'
            f'font-size:22px;font-weight:700;border-radius:10px 10px 0 0">{product}'
            '</td></tr><tr><td style="padding:28px 24px;background:#fff">'
            f'<p style="margin:0 0 20px">Hello {escape(customer_first_name)},'
            f'</p>{content}</td></tr><tr><td style="padding:16px 24px;'
            "background:#f8fafc;color:#64748b;font-size:12px;text-align:center;"
            f'border-radius:0 0 10px 10px">Sent by {product}</td></tr>'
            "</table></td></tr></table></body></html>"
        )
