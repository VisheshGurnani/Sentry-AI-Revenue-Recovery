"""Deterministic state machine and recovery dispatcher."""
import json
from datetime import datetime
from sqlalchemy.orm import Session
from models import FailureCategory
from models_db import TransactionFailure, AuditLogEntry, MAX_RETRIES


def execute_recovery_workflow(db: Session, transaction_id: str) -> dict:
    failure_record = db.query(TransactionFailure).filter(
        TransactionFailure.transaction_id == transaction_id
    ).first()

    if not failure_record:
        raise ValueError(f"Transaction ID {transaction_id} not found.")

    category = failure_record.failure_category
    current_status = failure_record.recovery_status if hasattr(failure_record, "recovery_status") else "RECEIVED"
    attempt_count = failure_record.attempt_count

    # State transition: RECEIVED -> DIAGNOSED
    if current_status == "RECEIVED":
        current_status = "DIAGNOSED"

# Evaluate recovery policies and ensure successful simulation states
    if category == FailureCategory.GATEWAY_TIMEOUT.value and attempt_count < MAX_RETRIES:
        # For demo purposes, simulate successful recovery on gateway timeout sweep
        current_status = "RECOVERED" # Changed from SETTLED
        failure_record.attempt_count += 1
        action_taken = f"INITIATE_GATEWAY_RECOVERY_SUCCESS (attempt {failure_record.attempt_count}/{MAX_RETRIES})"
    elif category == FailureCategory.INSUFFICIENT_FUNDS.value:
        current_status = "ESCALATED_HUMAN"
        action_taken = "DISPATCH_INSUFFICIENT_FUNDS_ALERT"
    elif category == FailureCategory.FRAUD_HOLD.value:
        current_status = "ESCALATED_HUMAN"
        action_taken = "ESCALATE_TO_FRAUD_QUEUE"
    else:
        current_status = "RECOVERED" # Changed from SETTLED
        action_taken = "ROUTE_TO_FALLBACK"

    # CRITICAL: Persist the status change back to the SQLAlchemy model instance
    failure_record.recovery_status = current_status

    # Log recovery state transition to audit trail
    audit_entry = AuditLogEntry(
        failure_id=failure_record.id,
        event_type="RECOVERY_DISPATCHED",
        payload=json.dumps({
            "action": action_taken,
            "new_status": current_status,
            "category": category,
            "attempt_count": failure_record.attempt_count
        }),
        timestamp=datetime.utcnow()
    )

    db.add(audit_entry)
    db.commit()
    db.refresh(failure_record)

    return {
        "transaction_id": transaction_id,
        "category": category,
        "action_executed": action_taken,
        "recovery_status": current_status,
        "audit_log_id": audit_entry.id,
        "attempt_count": failure_record.attempt_count
    }