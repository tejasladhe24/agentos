"""AgentOS Python SDK for services/ (ticket 24 / 82)."""

from agentos import (
    ai,
    audit,
    auth,
    events,
    files,
    hitl,
    inbound_email,
    integrations,
    notifications,
    oauth,
    secrets,
    store,
    vector_store,
    webhook,
    worker,
)
from agentos.create_app import create_app

__version__ = "0.0.0"

__all__ = [
    "ai",
    "audit",
    "auth",
    "create_app",
    "events",
    "files",
    "hitl",
    "inbound_email",
    "integrations",
    "notifications",
    "oauth",
    "secrets",
    "store",
    "vector_store",
    "webhook",
    "worker",
    "__version__",
]
