"""Which sign-up providers this system OFFERS (job CK, blueprint section 3.1). Google and Facebook sign-in is done by Supabase Auth; the API only says whether to show the buttons, and it says yes only when the
provider's PUBLIC client id is configured here (AUTH_GOOGLE_CLIENT_ID, AUTH_FACEBOOK_APP_ID). Missing = off. The secrets are set in Supabase Auth, never here (docs/runbooks/social-sign-up.md)."""

from __future__ import annotations

from app.config import Settings
from app.packs.models import AuthProvidersOut


def providers_from_settings(settings: Settings) -> AuthProvidersOut:
    return AuthProvidersOut(
        email=True,
        google=bool((settings.auth_google_client_id or "").strip()),
        facebook=bool((settings.auth_facebook_app_id or "").strip()),
    )
