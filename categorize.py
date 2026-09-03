"""Failure categorization logic."""
from enum import Enum

from models import FailureCategory

def categorize_failure(payload: dict) -> FailureCategory:
    error_payload = payload.get("raw_error_payload", {})
    error_code = error_payload.get("error_code", "") or str(error_payload.get("error", "")).lower()
    
    if "insufficient" in error_code:
        return FailureCategory.INSUFFICIENT_FUNDS
    elif any(term in error_code for term in ("timeout", "unavailable", "gateway")):
        return FailureCategory.GATEWAY_TIMEOUT
    elif any(term in error_code for term in ("fraud", "risk", "suspected")):
        return FailureCategory.FRAUD_HOLD
    else:
        return FailureCategory.INSUFFICIENT_FUNDS
    # TODO: Implement categorization logic
    # Example implementation pattern:
    # error_code = payload.get("raw_error_payload", {}).get("error_code", "")
    # if error_code == "insufficient_funds":
    #     return FailureCategory.INSUFFICIENT_FUNDS
    # elif error_code in ("timeout", "gateway_unavailable"):
    #     return FailureCategory.GATEWAY_TIMEOUT
    # elif error_code in ("fraud_suspected", "high_risk"):
    #     return FailureCategory.FRAUD_HOLD
    # else:
    #     return FailureCategory.INSUFFICIENT_FUNDS  # default

    # Stub implementation - returns None
    return None
