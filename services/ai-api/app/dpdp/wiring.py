"""Builds the DPDP collaborators from settings (job DQ part 4): the API's runtime and the worker's jobs. A bad captcha configuration stops the process at start, like the other providers."""

from __future__ import annotations

from app.billing.mail import EmailSender
from app.config import Settings
from app.dpdp.captcha import build_captcha
from app.dpdp.mail import DpdpJobs, IntakeMail, LapseErasure
from app.dpdp.repository import PostgrestDpdpRepository
from app.dpdp.runtime import DpdpRuntime


def build_dpdp(settings: Settings, rest_url: str, anon_key: str) -> DpdpRuntime:
    secret = settings.captcha_secret.get_secret_value() if settings.captcha_secret else None
    return DpdpRuntime(
        PostgrestDpdpRepository(rest_url, anon_key),
        privacy_email=settings.privacy_email,
        hello_email=settings.hello_email,
        captcha=build_captcha(settings.captcha_provider, secret),
    )


def build_dpdp_jobs(settings: Settings, rest_url: str, anon_key: str, sender: EmailSender) -> DpdpJobs:
    repository = PostgrestDpdpRepository(rest_url, anon_key)
    return DpdpJobs(IntakeMail(repository, sender, settings.privacy_email, settings.hello_email), LapseErasure(repository, sender), repository)
