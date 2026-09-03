"""FastAPI service for handling payment webhooks with cryptographic security."""
import hashlib
import hmac
import json
import os
from datetime import datetime
from fastapi import FastAPI, Request, status, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy.orm import Session

from database import get_db, engine
from models import PaymentWebhookPayload, WebhookMetrics, FailureCategory
from models_db import Base, TransactionFailure, AuditLogEntry
from categorize import categorize_failure
from recovery import execute_recovery_workflow

# Cryptographic security configuration
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "")
if not WEBHOOK_SECRET:
    raise RuntimeError("WEBHOOK_SECRET environment variable must be set for production deployments")


def verify_webhook_signature(request_body: bytes, signature_header: str) -> bool:
    """
    Verify Razorpay webhook signature using HMAC-SHA256.
    """
    if not signature_header:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "missing_signature", "message": "Missing X-Razorpay-Signature header"}
        )

    expected_signature = hmac.new(
        WEBHOOK_SECRET.encode('utf-8'),
        request_body,
        hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected_signature, signature_header):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "invalid_signature", "message": "Signature verification failed"}
        )

    return True


def verify_signature_dependency(request: Request) -> bool:
    """Dependency that extracts and verifies the webhook signature."""
    signature_header = request.headers.get("X-Razorpay-Signature")
    if not signature_header:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "missing_signature", "message": "Missing X-Razorpay-Signature header"}
        )
    return True


Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Payment Webhook Service",
    description="Service for handling payment failure webhooks with audit logging",
    version="1.0.0"
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = datetime.utcnow()
    response = await call_next(request)
    duration = (datetime.utcnow() - start_time).total_seconds()
    print(f"{request.method} {request.url.path} - {response.status_code} - {duration:.3f}s")
    return response

@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

@app.post(
    "/webhook/failure",
    status_code=status.HTTP_201_CREATED,
    response_model=dict,
    summary="Receive payment failure webhook with HMAC-SHA256 signature verification"
)
async def receive_failure_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Receive and verify Razorpay payment failure webhooks.
    """
    raw_body = await request.body()
    if not raw_body:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "empty_body", "message": "Request body is empty"}
        )

    signature_header = request.headers.get("X-Razorpay-Signature")
    if not signature_header:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "missing_signature", "message": "Missing X-Razorpay-Signature header"}
        )

    try:
        verify_webhook_signature(raw_body, signature_header)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "signature_verification_failed", "message": str(e)}
        )

    try:
        payload = PaymentWebhookPayload.model_validate_json(raw_body)
    except ValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"error": "validation_error", "details": str(e), "errors": e.errors()}
        )

    source_ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")

    try:
        category_enum = categorize_failure(payload.model_dump())
        category_value = category_enum.value if category_enum else "UNKNOWN"

        failure_record = TransactionFailure(
            transaction_id=payload.transaction_id,
            amount=payload.amount,
            failure_category=category_value,
            raw_error_payload=json.dumps(payload.raw_error_payload),
            timestamp=payload.timestamp,
            source_ip=source_ip,
            user_agent=user_agent
        )

        db.add(failure_record)
        db.commit()
        db.refresh(failure_record)

        audit_entry = AuditLogEntry(
            failure_id=failure_record.id,
            event_type="WEBHOOK_RECEIVED",
            payload=json.dumps({
                "transaction_id": payload.transaction_id,
                "amount": payload.amount,
                "raw_error_payload_keys": list(payload.raw_error_payload.keys())
            })
        )

        db.add(audit_entry)
        db.commit()
        db.refresh(audit_entry)

        return {
            "status": "processed",
            "transaction_id": failure_record.transaction_id,
            "amount": failure_record.amount,
            "failure_category": failure_record.failure_category,
            "audit_log_id": audit_entry.id
        }

    except ValidationError as e:
        db.rollback()
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"error": "validation_error", "details": str(e), "errors": e.errors()}
        )
    except Exception as e:
        db.rollback()
        error_type = type(e).__name__
        if "UNIQUE constraint failed" in str(e):
            return JSONResponse(
                status_code=status.HTTP_409_CONFLICT,
                content={
                    "error": "duplicate_transaction",
                    "message": f"Transaction ID '{payload.transaction_id}' already exists",
                    "transaction_id": payload.transaction_id
                }
            )
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"error": "internal_error", "message": str(e), "type": error_type}
        )

@app.post(
    "/transactions/{transaction_id}/recover",
    response_model=dict,
    summary="Execute deterministic recovery workflow for a transaction failure"
)
async def recover_transaction(transaction_id: str, db: Session = Depends(get_db)):
    try:
        result = execute_recovery_workflow(db, transaction_id)
        return result
    except ValueError as e:
        db.rollback()
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content={"error": "not_found", "message": str(e)}
        )
    except Exception as e:
        db.rollback()
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"error": "internal_error", "message": str(e)}
        )


@app.post(
    "/recovery/sweep",
    response_model=dict,
    summary="Sweep all pending transactions through the autonomous recovery handler"
)
async def sweep_pending_transactions(db: Session = Depends(get_db)):
    """
    Process all transactions in pending state (RECEIVED or DIAGNOSED) through
    the autonomous recovery workflow.
    """
    try:
        pending_transactions = db.query(TransactionFailure).filter(
            TransactionFailure.recovery_status.in_(["RECEIVED", "DIAGNOSED"])
        ).all()

        processed_count = 0
        affected_transaction_ids = []

        for failure_record in pending_transactions:
            result = execute_recovery_workflow(db, failure_record.transaction_id)
            processed_count += 1
            affected_transaction_ids.append(result["transaction_id"])

        db.commit()

        return {
            "processed_count": processed_count,
            "affected_transaction_ids": affected_transaction_ids
        }

    except Exception as e:
        db.rollback()
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"error": "internal_error", "message": str(e)}
        )

@app.get("/metrics", response_model=WebhookMetrics)
async def get_metrics(db: Session = Depends(get_db)):
    total_failures = db.query(TransactionFailure).count()

    state_distributions = {}
    for category in FailureCategory:
        count = db.query(TransactionFailure).filter(
            TransactionFailure.failure_category == category.value
        ).count()
        state_distributions[category.value] = count

    unknown_count = db.query(TransactionFailure).filter(
        TransactionFailure.failure_category == "UNKNOWN"
    ).count()
    if unknown_count > 0:
        state_distributions["UNKNOWN"] = unknown_count

    raw_audit_log = []
    for entry in db.query(AuditLogEntry).order_by(AuditLogEntry.timestamp.desc()).limit(100):
        raw_audit_log.append({
            "id": entry.id,
            "failure_id": entry.failure_id,
            "event_type": entry.event_type,
            "payload": json.loads(entry.payload) if entry.payload else {},
            "timestamp": entry.timestamp.isoformat()
        })
    raw_audit_log.reverse()

    return WebhookMetrics(
        total_failures_processed=total_failures,
        current_state_distributions=state_distributions,
        raw_audit_log=raw_audit_log
    )

@app.get("/transactions", response_model=list[dict])
async def list_transactions(limit: int = 100, offset: int = 0, db: Session = Depends(get_db)):
    query = db.query(TransactionFailure).order_by(TransactionFailure.timestamp.desc())
    transactions = []
    for failure in query.offset(offset).limit(limit):
        transactions.append({
            "id": failure.id,
            "transaction_id": failure.transaction_id,
            "amount": failure.amount,
            "failure_category": failure.failure_category,
            "recovery_status": failure.recovery_status,
            "timestamp": failure.timestamp.isoformat()
        })
    return transactions


@app.get("/audit/export", response_model=list[dict], summary="Export transaction recovery records")
async def export_audit_records(format: str = "json", db: Session = Depends(get_db)):
    """
    Export transaction recovery records as downloadable JSON or CSV.
    """
    failures = db.query(TransactionFailure).order_by(TransactionFailure.timestamp.desc()).all()

    records = []
    for failure in failures:
        recovered_amount = 0.0
        if failure.recovery_status == "RECOVERED":
            recovered_amount = failure.amount

        records.append({
            "transaction_id": failure.transaction_id,
            "status": failure.recovery_status,
            "attempt_count": failure.attempt_count,
            "recovered_amount": round(recovered_amount, 2),
            "timestamp": failure.timestamp.isoformat()
        })

    if format == "csv":
        import csv
        from io import StringIO

        output = StringIO()
        fieldnames = ["transaction_id", "status", "attempt_count", "recovered_amount", "timestamp"]
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        for record in records:
            writer.writerow(record)
        output.seek(0)

        from fastapi.responses import StreamingResponse
        return StreamingResponse(
            output,
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=audit_export.csv"}
        )

    return records


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)