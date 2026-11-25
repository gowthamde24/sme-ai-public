"""The provider-neutral SMS port, its fake, and the sign-up code sent through it."""

import pytest

from app.signup.sender import PhoneCodeUnavailable
from app.sms.sender import (
    FakeSms,
    NoSms,
    SmsCodeSender,
    SmsMessage,
    SmsUnavailable,
    build_sms_sender,
)


def test_off_cannot_send_and_fake_keeps_the_message() -> None:
    with pytest.raises(SmsUnavailable):
        NoSms().send(SmsMessage(to="+919876543210", text="hello"))
    fake = FakeSms()
    fake.send(SmsMessage(to="+919876543210", text="hello", template="t1"))
    last = fake.last_to("+919876543210")
    assert last is not None and last.text == "hello" and last.template == "t1"


def test_same_key_sends_once() -> None:
    fake = FakeSms()
    for _ in range(2):
        fake.send(SmsMessage(to="+919876543210", text="a", idempotency_key="k1"))
    assert len(fake.sent) == 1


def test_a_bad_number_or_text_is_refused_before_any_gateway() -> None:
    for number in ("9876543210", "+0123456789", "+91 98765"):
        with pytest.raises(ValueError):
            SmsMessage(to=number, text="x")
    with pytest.raises(ValueError):
        SmsMessage(to="+919876543210", text="   ")
    with pytest.raises(ValueError):
        SmsMessage(to="+919876543210", text="x" * 481)


def test_the_builder_knows_only_off_and_fake() -> None:
    assert isinstance(build_sms_sender("off"), NoSms)
    assert isinstance(build_sms_sender("fake"), FakeSms)
    with pytest.raises(ValueError):
        build_sms_sender("twilio")


def test_signup_code_goes_through_sms_and_a_failure_is_the_usual_unavailable() -> None:
    fake = FakeSms()
    SmsCodeSender(fake).send("+919876543210", "123456")
    sent = fake.last_to("+919876543210")
    assert sent is not None and "123456" in sent.text and sent.template == "signup_code"
    fake.fail_next = True
    with pytest.raises(PhoneCodeUnavailable):
        SmsCodeSender(fake).send("+919876543210", "654321")
