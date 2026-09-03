"""Pydantic models for payment webhook payloads."""
from datetime import datetime
from enum import Enum
from typing import Optional, Any

from pydantic import BaseModel, Field, field_validator


class FailureCategory(Enum):
    """Categories of payment failures."""
    INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS"
    GATEWAY_TIMEOUT = "GATEWAY_TIMEOUT"
    FRAUD_HOLD = "FRAUD_HOLD"


class PaymentWebhookPayload(BaseModel):
    """Strict Pydantic model for incoming payment webhook payloads."""

    transaction_id: str = Field(
        ...,
        description="Unique identifier for the transaction",
        min_length=1,
        max_length=255
    )
    amount: float = Field(
        ...,
        gt=0,
        description="Transaction amount in the smallest currency unit (e.g., cents)"
    )
    raw_error_payload: dict = Field(
        ...,
        description="Raw error payload from the payment gateway",
        default_factory=dict
    )

    # Optional metadata fields for audit trail
    timestamp: datetime = Field(
        default_factory=datetime.utcnow,
        description="When the webhook was received"
    )
    source_ip: Optional[str] = Field(
        default=None,
        max_length=45,
        description="Source IP address of the webhook request"
    )
    user_agent: Optional[str] = Field(
        default=None,
        max_length=2048,
        description="User agent string from the webhook request"
    )

    @field_validator('transaction_id')
    @classmethod
    def validate_transaction_id(cls, v: str) -> str:
        """Ensure transaction_id is not empty."""
        if not v or not v.strip():
            raise ValueError('transaction_id cannot be empty')
        return v.strip()

    @field_validator('amount')
    @classmethod
    def validate_amount(cls, v: float) -> float:
        """Ensure amount is positive."""
        if v <= 0:
            raise ValueError('amount must be greater than zero')
        return round(v, 2)

    model_config = {
        'json_schema_extra': {
            'example': {
                'transaction_id': 'txn_123456789',
                'amount': 15000,  # e.g., $150.00 in cents
                'raw_error_payload': {
                    'error_code': 'insufficient_funds',
                    'error_message': 'Customer account balance insufficient',
                    'gateway_response': {'status': 'declined', 'reason': 'balance'}
                }
            }
        }
    }


class WebhookMetrics(BaseModel):
    """Metrics model for the /metrics endpoint."""

    total_failures_processed: int = Field(
        ...,
        description="Total number of failures processed"
    )
    current_state_distributions: dict[str, int] = Field(
        ...,
        description="Current distribution of failure categories"
    )
    raw_audit_log: list[dict] = Field(
        ...,
        description="Raw audit log entries"
    )
