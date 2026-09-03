from database import SessionLocal, engine
from models_db import Base, TransactionFailure
from datetime import datetime
import json

# Recreate tables cleanly
Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)

db = SessionLocal()

failures = [
    TransactionFailure(
        transaction_id="tx_demo_001",
        amount=2499.00,
        failure_category="GATEWAY_TIMEOUT",
        recovery_status="RECEIVED",
        attempt_count=1,
        raw_error_payload=json.dumps({"error": "Gateway timeout during upstream call", "code": "GATEWAY_TIMEOUT"}),
        timestamp=datetime.utcnow()
    ),
    TransactionFailure(
        transaction_id="tx_demo_002",
        amount=12500.00,
        failure_category="INSUFFICIENT_FUNDS",
        recovery_status="PENDING",
        attempt_count=2,
        raw_error_payload=json.dumps({"error": "Bank declined due to insufficient funds", "code": "INSUFFICIENT_FUNDS"}),
        timestamp=datetime.utcnow()
    ),
    TransactionFailure(
        transaction_id="tx_demo_003",
        amount=4999.00,
        failure_category="FRAUD_HOLD",
        recovery_status="HALTED",
        attempt_count=1,
        raw_error_payload=json.dumps({"error": "Flagged by risk engine", "code": "FRAUD_HOLD"}),
        timestamp=datetime.utcnow()
    ),
    TransactionFailure(
        transaction_id="tx_demo_004",
        amount=899.00,
        failure_category="GATEWAY_TIMEOUT",
        recovery_status="DIAGNOSED",
        attempt_count=1,
        raw_error_payload=json.dumps({"error": "Recovered via retry", "code": "GATEWAY_TIMEOUT"}),
        timestamp=datetime.utcnow()
    )
]

for f in failures:
    db.add(f)

db.commit()
db.close()
print("Database re-initialized and seeded via ORM successfully.")