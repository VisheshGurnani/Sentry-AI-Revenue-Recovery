"""SQLAlchemy ORM models for payment webhooks."""
from datetime import datetime
from typing import Optional, List

from sqlalchemy import Column, Integer, String, Float, Text, DateTime, ForeignKey, CheckConstraint
from sqlalchemy.orm import relationship

from database import Base


class TransactionFailure(Base):
    """Model for storing transaction failure records with unique constraint on transaction_id."""

    __tablename__ = "transaction_failures"

    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(String(255), nullable=False, unique=True, index=True, comment="Unique transaction identifier")
    amount = Column(Float, nullable=False, comment="Transaction amount in smallest currency unit")
    failure_category = Column(String(50), nullable=False, comment="Category: INSUFFICIENT_FUNDS, GATEWAY_TIMEOUT, FRAUD_HOLD")
    raw_error_payload = Column(Text, nullable=False, comment="JSON-encoded raw error payload from gateway")
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    source_ip = Column(String(45), nullable=True, comment="Source IP of webhook request")
    user_agent = Column(Text, nullable=True, comment="User agent string from webhook request")
    recovery_status = Column(String(50), default="PENDING", comment="Recovery state: RECEIVED -> DIAGNOSED -> RETRY_SCHEDULED/ESCALATED_HUMAN/TERMINAL_ABORT -> SETTLED")
    attempt_count = Column(Integer, default=0, comment="Atomic retry counter enforcing MAX_RETRIES=3 stopping rule")

    # Relationship to audit log entries
    audit_entries = relationship("AuditLogEntry", back_populates="failure", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint(
            "failure_category IN ('INSUFFICIENT_FUNDS', 'GATEWAY_TIMEOUT', 'FRAUD_HOLD')",
            name="check_valid_failure_category"
        ),
    )


# State machine constants for bounded policy enforcement
RECOVERY_STATES = {
    "RECEIVED": "Initial webhook ingestion state",
    "DIAGNOSED": "Failure categorized and analyzed",
    "RETRY_SCHEDULED": "Retry action queued for execution",
    "ESCALATED_HUMAN": "Escalated to manual review queue",
    "TERMINAL_ABORT": "Permanent failure - terminal state",
    "SETTLED": "Final resolved state"
}

MAX_RETRIES = 3  # Strict stopping rule: maximum retry attempts before terminal abort


class AuditLogEntry(Base):
    """Model for audit log entries."""

    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, index=True)
    failure_id = Column(Integer, ForeignKey("transaction_failures.id", ondelete="CASCADE"), nullable=False)
    event_type = Column(String(50), nullable=False, comment="Type of audit event: WEBHOOK_RECEIVED, CATEGORIZED, etc.")
    payload = Column(Text, nullable=False, comment="JSON-encoded event payload")
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    # Relationship back to failure
    failure = relationship("TransactionFailure", back_populates="audit_entries")
