"""The daily Plivo balance check (owner decision, 19 Nov 2026): Plivo is prepaid and must never run dry (no auto-recharge exists for India accounts, so top-ups are manual).

Once per India day the worker reads the account from Plivo (`GET /v1/Account/<auth id>/`, a read only), compares the credits with a limit of Rs 300 and tells the database (`ops_plivo_balance_report`). The database keeps the day's
record and does the rest: ONE "Needs you" item for the platform owner in the staff console while the balance is low (cleared by a recovery), and whether the WhatsApp message to the owner's own number is still due. This module
sends that message at most once a day (the database says when it has gone) and never to a customer.

HOW THE BALANCE IS COMPARED. Plivo's documentation says `cash_credits` is "Account credits in USD" and the response names no currency, so the currency is a setting (PLIVO_BALANCE_CURRENCY, default USD) and so is the rate
(PLIVO_BALANCE_INR_PER_UNIT, rupees for one unit of that currency; with INR the credits are rupees already and no rate is used). rupees = credits x rate; low = rupees < PLIVO_BALANCE_MIN_INR (default 300). A rate that is missing
for a foreign currency stops the worker at start (a limit that cannot be compared is not a silent pass). Whether the account reports rupees on the first real read is the one thing to check then (docs/runbooks/plivo-balance-alert.md).

AUTO-RECHARGE. Plivo's `auto_recharge` field is reported in the alert and the message (on, off, or unknown when Plivo does not say); nothing here ever changes it.

WHAT NEVER HAPPENS. No Plivo call at import or in a test (the client is injected; a fake serves the tests); no number or credential in a log or in the database; no message to anyone but PLIVO_BALANCE_ALERT_TO, which comes
from the environment. A failed read is tried again an hour later and, after six failures in a day, becomes an item of its own."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any, Protocol
from zoneinfo import ZoneInfo

from app.config import ConfigurationError, Settings
from app.outbox.adapter import ChannelAdapter, OutgoingMessage, SendContext, TemplateRef
from app.rpc_base import RpcClient
from app.telephony.plivo_api import PlivoApi, PlivoError

logger = logging.getLogger("app.ops.plivo_balance")

INDIA = ZoneInfo("Asia/Kolkata")
_PHONE = re.compile(r"^\+?[0-9]{10,15}$")
_CURRENCY = re.compile(r"^[A-Z]{3}$")
_TEMPLATE = re.compile(r"^[a-z0-9_]{1,512}$")
_LANGUAGE = re.compile(r"^[a-z]{2}(_[A-Z]{2})?$")


class AccountReader(Protocol):
    """What the check needs from Plivo: the account's details. The real one is `PlivoApi`; tests give a fake."""

    def account_details(self) -> dict[str, Any]: ...


class BalanceRpc(Protocol):
    def object(self, token: str, function: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def call(self, token: str, function: str, args: dict[str, Any]) -> Any: ...


class OwnerNotice(Protocol):
    """One WhatsApp message to the platform owner's own number. `key` is the same for the same message, so a repeat is the same message."""

    def send(self, text: str, key: str) -> bool: ...


@dataclass(frozen=True)
class Limit:
    """The rupee limit and how Plivo's credits become rupees."""

    min_inr: Decimal
    currency: str
    inr_per_unit: Decimal

    @classmethod
    def build(cls, min_inr: int, currency: str, inr_per_unit: float) -> Limit:
        problems: list[str] = []
        code = (currency or "").strip().upper()
        if min_inr < 1:
            problems.append("PLIVO_BALANCE_MIN_INR must be at least 1")
        if not _CURRENCY.fullmatch(code):
            problems.append("PLIVO_BALANCE_CURRENCY must be a three-letter currency code (INR or USD)")
        rate = Decimal(str(inr_per_unit))
        if code != "INR" and rate <= 0:
            problems.append(f"PLIVO_BALANCE_INR_PER_UNIT is required (rupees for one {code or 'unit'}) because Plivo reports {code or 'the credits'}, not rupees")
        if problems:
            raise ConfigurationError("invalid Plivo balance check configuration: " + "; ".join(problems))
        return cls(Decimal(min_inr), code, Decimal(1) if code == "INR" else rate)

    def rupees(self, credits: Decimal) -> Decimal:
        return (credits * self.inr_per_unit).quantize(Decimal("0.01"), ROUND_HALF_UP)

    def is_low(self, credits: Decimal) -> bool:
        return self.rupees(credits) < self.min_inr


@dataclass(frozen=True)
class Account:
    credits: Decimal
    auto_recharge: bool | None   # None: Plivo did not say


def parse_account(body: dict[str, Any]) -> Account:
    """Plivo's account object as the two facts the check uses; anything unexpected is a bad_response (the read is counted as failed, never guessed)."""
    raw = body.get("cash_credits")
    if raw is None or isinstance(raw, bool):
        raise PlivoError("bad_response")
    try:
        credits = Decimal(str(raw).strip())
    except InvalidOperation:
        raise PlivoError("bad_response") from None
    if not credits.is_finite() or abs(credits) > Decimal("1000000000"):
        raise PlivoError("bad_response")
    flag = body.get("auto_recharge")
    if isinstance(flag, bool):
        recharge: bool | None = flag
    elif isinstance(flag, str) and flag.strip().lower() in ("true", "false"):
        recharge = flag.strip().lower() == "true"
    else:
        recharge = None
    return Account(credits, recharge)


def _recharge_word(recharge: bool | None) -> str:
    return "on" if recharge is True else "off" if recharge is False else "not reported"


def _whole_rupees(amount: Decimal) -> int:
    return int(amount.quantize(Decimal(1), ROUND_HALF_UP))


def _where(brand: str, kind: str) -> str:
    """Where to top up, in the words each provider's texts always used (Plivo: "the Plivo console" / "at plivo.com"; the owner reads these)."""
    if brand == "Plivo":
        return "in the Plivo console" if kind == "console" else "at plivo.com"
    return f"in the {brand} portal"


def cover_sentence(balance_inr: Decimal, calls_7d_paise: int | None) -> str:
    """How long the wallet lasts at the last 7 days' call use (our own cost ledger: calls only, the monthly number and channel fees are on top). Empty when the database did not say."""
    if calls_7d_paise is None or calls_7d_paise < 0:
        return ""
    if calls_7d_paise == 0:
        return " No calls were made in the last 7 days, so the days left cannot be worked out."
    per_day = Decimal(calls_7d_paise) / Decimal(700)   # paise -> rupees, over 7 days
    if balance_inr <= 0:
        return f" Calls used about Rs {_whole_rupees(per_day)} a day over the last 7 days: no days of cover are left."
    days = int((balance_inr / per_day).quantize(Decimal(1), ROUND_HALF_UP))
    return f" At the last 7 days' call use (about Rs {_whole_rupees(per_day)} a day) the balance covers about {days} more day{'' if days == 1 else 's'} of calls; the monthly number and channel fees come on top."


def alert_detail(account: Account, limit: Limit, brand: str = "Plivo", calls_7d_paise: int | None = None) -> str:
    """The sentence of the "Needs you" item: what Plivo said, what it comes to, the limit, auto-recharge, the days of cover left at the last 7 days' use, what to do. No number of a person, no key."""
    rupees = _whole_rupees(limit.rupees(account.credits))
    seen = f"{brand} reports {account.credits.normalize():f} {limit.currency}" + ("" if limit.currency == "INR" else f", about Rs {rupees} at Rs {limit.inr_per_unit.normalize():f} to the {limit.currency}") + "."
    return f"{seen} The limit is Rs {_whole_rupees(limit.min_inr)}. Auto-recharge is {_recharge_word(account.auto_recharge)}.{cover_sentence(limit.rupees(account.credits), calls_7d_paise)} Top up {_where(brand, 'console')} so calls keep working."


def whatsapp_text(balance_inr: Decimal, limit_inr: Decimal, recharge: bool | None, brand: str = "Plivo") -> str:
    """The one line sent to the owner (one template variable: no new line, short)."""
    return f"{brand} balance is low: about Rs {_whole_rupees(balance_inr)} left (limit Rs {_whole_rupees(limit_inr)}). Auto-recharge: {_recharge_word(recharge)}. Top up {_where(brand, 'text')} so calls keep working."


class AdapterOwnerNotice:
    """The message goes through the same channel adapter and approved-template path as every WhatsApp message of the worker, from the platform's own number, to the owner's own number. It is not an outbox message (the outbox is a
    workspace's, with a customer, consent and an approval; this is the platform telling its owner), so nothing here can reach a customer."""

    def __init__(self, adapter: ChannelAdapter, *, to_phone: str, phone_number_id: str, token_ref: str, template: str, language: str) -> None:
        self._adapter, self._to = adapter, to_phone
        self._ctx = (phone_number_id, token_ref, template, language)

    def __repr__(self) -> str:
        return "AdapterOwnerNotice(<owner number hidden>)"

    def send(self, text: str, key: str) -> bool:
        phone_number_id, token_ref, template, language = self._ctx
        ref = TemplateRef(template, language, text, "utility", (text,))
        message = OutgoingMessage(
            message_id=uuid.uuid5(uuid.NAMESPACE_URL, f"stack19-plivo-balance:{key}"),
            to_phone=self._to,
            body=text,
            language="en",
            wa=SendContext(phone_number_id=phone_number_id, token_ref=token_ref, window_open=False, template=ref),
        )
        try:
            return self._adapter.send(message).ok
        except Exception as exc:  # noqa: BLE001 - only the class is logged (the number and the text never are)
            logger.error("plivo balance: the WhatsApp message to the owner crashed: %s", exc.__class__.__name__)
            return False


@dataclass(frozen=True)
class PassResult:
    read: str   # idle (nothing was due) | ok | low | failed: what today's read said, when this pass made one
    told: bool  # the WhatsApp message to the owner went in this pass


class PlivoBalanceCheck:
    def __init__(self, reader: AccountReader, rpc: BalanceRpc, limit: Limit, notice: OwnerNotice | None = None, *, clock: Callable[[], datetime] | None = None, brand: str = "Plivo", recording_expected: bool = False) -> None:
        self._reader, self._rpc, self._limit, self._notice, self._brand = reader, rpc, limit, notice, brand
        self._clock = clock or (lambda: datetime.now(INDIA))
        self._recording_expected = recording_expected   # VOICELINK_RECORDING_EXPECTED: recording is ON on purpose (owner, 28 Nov 2026); the item is raised when the state differs from this

    def run(self, token: str) -> PassResult:
        """One pass (the worker calls it every tick; the database says whether anything is due, so a day has one read and at most one message)."""
        state = self._rpc.object(token, "ops_plivo_balance_due", {})
        read = "idle"
        if state.get("read_due") is True:
            spent = state.get("calls_7d_paise")
            state = self._read(token, spent if isinstance(spent, int) and not isinstance(spent, bool) else None)
            read = str(state.get("state") or "failed")
        told = state.get("whatsapp_due") is True and self._tell_owner(token, state)
        return PassResult(read, told)

    def _read(self, token: str, calls_7d_paise: int | None = None) -> dict[str, Any]:
        try:
            details = self._reader.account_details()
            account = parse_account(details)
        except PlivoError as exc:
            logger.warning("plivo balance: the account could not be read (%s)", exc.reason)   # a closed word: never a body, a key or a number
            if exc.reason == "auth" and self._brand == "VoiceLink":   # a known reason is a "Needs you" item at once (28 Nov 2026: the stored username was the display name; nothing showed for hours)
                return self._rpc.object(token, "ops_plivo_balance_report", {"p_state": "failed", "p_detail": f"VoiceLink refused our login (status {exc.status}). The username must be the REGISTERED username (VoiceLink Profile page), not the display name. Fix the secret sme-voicelink-username (or the password), then redeploy the API and the worker."})
            return self._rpc.object(token, "ops_plivo_balance_report", {"p_state": "failed"})
        low = self._limit.is_low(account.credits)
        args: dict[str, Any] = {"p_state": "low" if low else "ok", "p_balance_inr": float(self._limit.rupees(account.credits)), "p_auto_recharge": account.auto_recharge}
        if low:
            args["p_detail"] = alert_detail(account, self._limit, self._brand, calls_7d_paise)
        logger.info("plivo balance: read, state=%s auto_recharge=%s", args["p_state"], _recharge_word(account.auto_recharge))
        self._report_recording(token, details.get("recording_numbers"))
        return self._rpc.object(token, "ops_plivo_balance_report", args)

    def _report_recording(self, token: str, count: Any) -> None:
        """VoiceLink records a number's calls on its network when "call recording" is on for it (28 Nov 2026: it was, while the privacy text says calls are not recorded). The day's read also tells the database how many numbers
        record: an item for the owner while any does, cleared when none does. Best effort: a failure here (the function not pushed yet, a network error) never spoils the balance read."""
        if not isinstance(count, int) or isinstance(count, bool):
            return
        try:
            if self._recording_expected:   # on purpose: the call opening says so; an item only when VoiceLink shows NO number recording (then nothing is kept to review and the notice is untrue)
                ok = count > 0
                detail = None if ok else f"{self._brand} call recording is OFF for all our numbers, but calls are expected to be recorded (the opening tells callers so). Switch it on in the {self._brand} portal (the number's Call Recording setting) or set VOICELINK_RECORDING_EXPECTED to false and redeploy."
                self._rpc.call(token, "ops_telephony_setting_report", {"p_ok": ok, "p_detail": detail} if detail else {"p_ok": True})
            elif count > 0:
                self._rpc.call(token, "ops_telephony_setting_report", {"p_ok": False, "p_detail": f"{self._brand} call recording is ON for {count} of our numbers. Our privacy text says calls are not recorded: switch it off in the {self._brand} portal (the number's Call Recording setting), then check again tomorrow."})
            else:
                self._rpc.call(token, "ops_telephony_setting_report", {"p_ok": True})
        except Exception as exc:  # noqa: BLE001 - only the class is logged
            logger.warning("plivo balance: the recording check could not be reported (%s)", exc.__class__.__name__)

    def _tell_owner(self, token: str, state: dict[str, Any]) -> bool:
        if self._notice is None:
            return False
        try:
            balance = Decimal(str(state["balance_inr"]))
        except (KeyError, InvalidOperation):
            return False
        recharge = state.get("auto_recharge")
        text = whatsapp_text(balance, self._limit.min_inr, recharge if isinstance(recharge, bool) else None, self._brand)
        if not self._notice.send(text, self._clock().astimezone(INDIA).date().isoformat()):
            logger.warning("plivo balance: the WhatsApp message to the owner did not go; it is tried again on the next tick")
            return False
        self._rpc.call(token, "ops_plivo_balance_told", {})   # no second message today
        return True


def voicelink_in_use(settings: Settings) -> bool:
    """VoiceLink is the telephony provider here: TELEPHONY_PROVIDER says so, or it is unset and VoiceLink's login is given and Plivo's is not."""
    has_vl = bool(settings.voicelink_username and settings.voicelink_username.get_secret_value() and settings.voicelink_password and settings.voicelink_password.get_secret_value())
    choice = (settings.telephony_provider or "").strip().lower()
    return choice == "voicelink" or (choice == "" and has_vl and not (settings.plivo_auth_id and settings.plivo_auth_token))


def build_plivo_balance(settings: Settings, rest_url: str, anon_key: str, adapter: ChannelAdapter, *, reader: AccountReader | None = None, rpc: BalanceRpc | None = None) -> PlivoBalanceCheck | None:
    """The check for the worker, or None while PLIVO_BALANCE_CHECK is off (the default). A switch that is on but cannot work stops the worker at start (ConfigurationError) rather than failing quietly every day."""
    if not settings.plivo_balance_check:
        return None
    limit = Limit.build(settings.plivo_balance_min_inr, settings.plivo_balance_currency, settings.plivo_balance_inr_per_unit)
    brand = "Plivo"
    if reader is None and voicelink_in_use(settings):   # 24 Nov 2026 (owner): VoiceLink is the only telephony provider; the same daily check reads its wallet (the PLIVO_BALANCE_* settings keep their names: limit, currency, who is told)
        from app.telephony.voicelink_api import VoicelinkApi, VoicelinkBalanceReader

        reader = VoicelinkBalanceReader(VoicelinkApi(settings.voicelink_username.get_secret_value() if settings.voicelink_username else "", settings.voicelink_password.get_secret_value() if settings.voicelink_password else "", base_url=settings.voicelink_api_base), currency=limit.currency)
        brand = "VoiceLink"
    if reader is None:
        if not settings.plivo_auth_id or settings.plivo_auth_token is None or not settings.plivo_auth_token.get_secret_value():
            raise ConfigurationError("PLIVO_BALANCE_CHECK needs PLIVO_AUTH_ID and PLIVO_AUTH_TOKEN (or VOICELINK_USERNAME and VOICELINK_PASSWORD)")
        try:
            reader = PlivoApi(settings.plivo_auth_id, settings.plivo_auth_token.get_secret_value())
        except ValueError as exc:
            raise ConfigurationError(str(exc)) from None
    notice: OwnerNotice | None = None
    to_phone = (settings.plivo_balance_alert_to or "").replace(" ", "")
    if to_phone:
        problems = []
        if not _PHONE.fullmatch(to_phone):
            problems.append("PLIVO_BALANCE_ALERT_TO must be the owner's phone number with the country code")
        if not settings.whatsapp_phone_number_id:
            problems.append("PLIVO_BALANCE_ALERT_TO needs WHATSAPP_PHONE_NUMBER_ID (the platform's own WhatsApp number)")
        if not _TEMPLATE.fullmatch(settings.plivo_balance_template) or not _LANGUAGE.fullmatch(settings.plivo_balance_template_language):
            problems.append("PLIVO_BALANCE_TEMPLATE and PLIVO_BALANCE_TEMPLATE_LANGUAGE must be a template name and a language code")
        if problems:
            raise ConfigurationError("invalid Plivo balance check configuration: " + "; ".join(problems))
        if adapter.name == "whatsapp":
            assert settings.whatsapp_phone_number_id is not None  # noqa: S101 - checked above
            notice = AdapterOwnerNotice(adapter, to_phone=to_phone, phone_number_id=settings.whatsapp_phone_number_id, token_ref="platform", template=settings.plivo_balance_template, language=settings.plivo_balance_template_language)  # noqa: S106 - a token reference (a name), not a password
        else:
            logger.warning("plivo balance: the worker's channel is not WhatsApp (OUTBOX_ADAPTER), so only the Needs-you item is raised, no message goes to the owner")
    else:
        logger.warning("plivo balance: PLIVO_BALANCE_ALERT_TO is not set, so only the Needs-you item is raised, no message goes to the owner")
    return PlivoBalanceCheck(reader, rpc or RpcClient(rest_url, anon_key), limit, notice, brand=brand, recording_expected=settings.voicelink_recording_expected)


__all__ = ["voicelink_in_use", "Account", "AdapterOwnerNotice", "Limit", "PassResult", "PlivoBalanceCheck", "alert_detail", "build_plivo_balance", "parse_account", "whatsapp_text"]
