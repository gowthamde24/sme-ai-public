"""The GST invoice as an e-mail to the person who asked for it (and, after a paid top-up, the receipt).

Plain words, in English: the invoice number, the date, what it is for, the amounts and, when the company details are entered, the seller's name and GSTIN. When they are not entered yet the e-mail says that
this is not yet a tax invoice (the same flag the screen shows). No card, bank or UPI detail exists anywhere in this system, so none can be in the message. Sent through the one e-mail sender the API already
has (BILLING_EMAIL_SENDER: `fake` locally, `resend` hosted)."""

# ruff: noqa: E501

from __future__ import annotations

import logging

from app.billing.mail import Email, EmailSender, to_html
from app.credits.models import InvoiceDetailOut

logger = logging.getLogger("app.credits.receipt_mail")

KIND_SUBJECT = {"topup": "Your Stack19 receipt", "credit_note": "Your Stack19 credit note", "subscription": "Your Stack19 invoice", "payg_fee": "Your Stack19 invoice"}


def compose_invoice_email(inv: InvoiceDetailOut, to: str) -> Email:
    lines = [f"{KIND_SUBJECT.get(inv.kind, 'Your Stack19 invoice')} {inv.number}, dated {inv.issued_at.date().isoformat()}.", inv.description + ".", f"Amount before GST: {inv.subtotal_text}. GST ({inv.gst_percent:g}%): {inv.gst_text}. Total: {inv.total_text}."]
    if inv.tax_split == "cgst_sgst":
        lines.append(f"GST is split into CGST and SGST of equal parts ({inv.gst_text} in all).")
    if inv.against_number:
        lines.append(f"This credit note is against invoice {inv.against_number}.")
    if inv.buyer_name:
        lines.append(f"Billed to: {inv.buyer_name}" + (f", GSTIN {inv.buyer_gstin}." if inv.buyer_gstin else "."))
    if inv.seller_details_missing:
        lines.append("The seller's company details are not entered yet, so this is not yet a valid tax invoice. We will send it again when they are.")
    else:
        lines.append(f"Seller: {inv.seller_name}, GSTIN {inv.seller_gstin}" + (f", SAC {inv.seller_sac}." if inv.seller_sac else "."))
    signoff = "Stack19"
    return Email(to=to, subject=f"{KIND_SUBJECT.get(inv.kind, 'Your Stack19 invoice')} {inv.number}", body="\n\n".join([*lines, signoff]) + "\n", html=to_html(lines, signoff), idempotency_key=f"invoice:{inv.number}:{inv.issued_at.date().isoformat()}")


def send_invoice(sender: EmailSender | None, inv: InvoiceDetailOut, to: str | None) -> bool:
    """True when the sender took the message. Never raises: a receipt that cannot be mailed must not undo a payment."""
    if sender is None or not to:
        return False
    try:
        return bool(sender.send(compose_invoice_email(inv, to)))
    except Exception:   # a sender's failure is logged by the sender; the caller only needs to know it did not go
        logger.warning("invoice e-mail was not sent")
        return False
