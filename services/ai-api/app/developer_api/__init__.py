"""The Stack19 developer API (ADR 0121; docs/contracts/developer-api.md). Test mode only: an `sk_test_` key reads and writes the workspace's sandbox, never its real leads, and nothing is ever
called or sent. A key is a credential the database checks (its SHA-256, through the developer_api_* functions run as the worker account); the secret is shown once and never stored."""

# ruff: noqa: E501
