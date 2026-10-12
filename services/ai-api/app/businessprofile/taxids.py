"""The two GSTINs an order or a quote shows (job CA, ADR 0081): the customer's, from the company of the lead, and the shop's own, from the business profile. Read LIVE with the caller's token when the
document is shown (not copied onto the quote or the order): a quote's text and hash are fixed by the pinned engine, and a corrected GSTIN should show on the next view. A failed read is a missing value,
never a failed screen."""

from __future__ import annotations

import logging
import uuid

from app.auth.deps import Runtime, TenantContext
from app.tenancy.repository import RepositoryError

logger = logging.getLogger("app.businessprofile.taxids")


def tax_ids(runtime: Runtime, ctx: TenantContext, lead_id: uuid.UUID | None) -> tuple[str | None, str | None]:
    """(the customer's GSTIN, the shop's GSTIN); each None when there is none or it could not be read."""
    token, tenant = ctx.principal.token, ctx.tenant.id
    customer: str | None = None
    shop: str | None = None
    try:
        if lead_id is not None:
            lead = runtime.crm.get_row(token, "leads", tenant, lead_id)
            if lead is not None and lead.company_id is not None:
                company = runtime.crm.get_row(token, "companies", tenant, lead.company_id)
                customer = company.gstin if company is not None else None
        if runtime.business_profile is not None:
            shop = runtime.business_profile.get(token, tenant).get("gstin")
    except RepositoryError as exc:
        logger.warning("tax ids: a read failed (%s)", exc.__class__.__name__)
    return customer, shop
