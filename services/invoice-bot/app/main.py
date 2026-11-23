"""Invoice Bot service — FastAPI entry (ticket 26)."""

from __future__ import annotations

import re
from typing import Any

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from agentos import auth, create_app, hitl, store

app = create_app()
app.title = "Invoice Bot"

INVOICES = "invoices"


class LineItem(BaseModel):
    description: str | None = None
    quantity: float | None = None
    unitPrice: float | None = None
    amount: float | None = None


class ParseInvoiceInput(BaseModel):
    text: str | None = None
    vendor: str | None = None
    amount: float | None = None
    currency: str | None = None
    dueDate: str | None = None
    lineItems: list[LineItem] | None = None
    id: str | None = None


class RequestPayoutInput(BaseModel):
    invoiceId: str
    note: str | None = None


def _parse_amount(text: str) -> float | None:
    match = re.search(
        r"(?:total|amount|due)\s*[:$]?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)",
        text,
        re.IGNORECASE,
    )
    if not match:
        match = re.search(r"\$\s*([\d,]+(?:\.\d{1,2})?)", text)
    if not match:
        return None
    try:
        return float(match.group(1).replace(",", ""))
    except ValueError:
        return None


def _parse_vendor(text: str) -> str | None:
    for pattern in (
        r"(?:from|vendor|bill\s*from)\s*[:\-]\s*(.+)",
        r"^([A-Z][A-Za-z0-9 &.,'-]{2,})",
    ):
        match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
        if match:
            vendor = match.group(1).strip().splitlines()[0].strip()
            if vendor:
                return vendor[:120]
    return None


def _parse_due_date(text: str) -> str | None:
    match = re.search(
        r"(?:due|due\s*date)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{2,4})",
        text,
        re.IGNORECASE,
    )
    return match.group(1) if match else None


def _build_invoice_data(body: ParseInvoiceInput) -> dict[str, Any]:
    text = (body.text or "").strip()
    vendor = body.vendor or (_parse_vendor(text) if text else None) or "Unknown vendor"
    amount = body.amount
    if amount is None and text:
        amount = _parse_amount(text)
    currency = (body.currency or "USD").upper()
    due_date = body.dueDate or (_parse_due_date(text) if text else None)

    data: dict[str, Any] = {
        "vendor": vendor,
        "amount": amount if amount is not None else 0,
        "currency": currency,
        "status": "parsed",
        "rawText": text or None,
    }
    if due_date:
        data["dueDate"] = due_date
    if body.lineItems:
        data["lineItems"] = [item.model_dump(exclude_none=True) for item in body.lineItems]
    return data


def _invoices(session: auth.AuthSession):
    """Org-scoped invoices collection (peer header; Python services do not forward cookies)."""
    if not session.orgId:
        raise HTTPException(
            status_code=400,
            detail={"error": "organization required"},
        )
    return store.db_store.collection(INVOICES, org_id=session.orgId)


@app.get("/invoices")
async def list_invoices(
    session: auth.AuthSession = Depends(auth.require_permissions("invoice.read")),
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    result = await _invoices(session).query(
        {"limit": limit, "offset": offset},
    )
    return {"items": [row.model_dump() for row in result.items]}


@app.post("/tools/parse_invoice")
async def parse_invoice(
    body: ParseInvoiceInput,
    session: auth.AuthSession = Depends(auth.require_permissions("invoice.write")),
) -> dict[str, Any]:
    if not body.text and body.amount is None and not body.vendor:
        raise HTTPException(
            status_code=400,
            detail={"error": "Provide text and/or vendor/amount fields"},
        )

    data = _build_invoice_data(body)
    doc = await _invoices(session).insert(
        {"id": body.id, "data": data} if body.id else {"data": data},
    )
    return doc.model_dump()


@app.post("/tools/request_payout_approval")
async def request_payout_approval(
    body: RequestPayoutInput,
    session: auth.AuthSession = Depends(auth.require_permissions("invoice.write")),
) -> dict[str, Any]:
    invoice_id = body.invoiceId.strip()
    if not invoice_id:
        raise HTTPException(status_code=400, detail={"error": "invoiceId is required"})

    invoices = _invoices(session)
    # Document id is top-level; query where filters document `data` only.
    all_rows = await invoices.query({"limit": 200})
    row = next((item for item in all_rows.items if item.id == invoice_id), None)
    if row is None:
        raise HTTPException(status_code=404, detail={"error": "invoice not found"})

    vendor = str(row.data.get("vendor") or "vendor")
    amount = row.data.get("amount")
    currency = str(row.data.get("currency") or "USD")
    title = f"Payout approval: {vendor} ({currency} {amount})"
    note = body.note.strip() if body.note else None
    approval_body = note or f"Approve payout for invoice {invoice_id}."

    approval = await hitl.create_approval(
        {
            "title": title,
            "body": approval_body,
            "metadata": {
                "invoiceId": invoice_id,
                "vendor": vendor,
                "amount": amount,
                "currency": currency,
            },
        },
    )

    updated = await invoices.update(
        {
            "id": invoice_id,
            "data": {
                "status": "pending_approval",
                "approvalId": approval.id,
            },
            "merge": True,
        },
    )

    return {
        "invoice": updated.model_dump(),
        "approval": approval.model_dump(),
    }
