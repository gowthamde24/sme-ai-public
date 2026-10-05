"""The outside world for agents (T007 M1): the real page fetcher and its guards, the offline fakes.

This package may open sockets; the agent sandbox (`app.agents`) may not, and only sees the
interfaces in `app.agents.web`. Nothing here reads the environment, a key or a cookie.
"""
