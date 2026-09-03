"""Database configuration with Write-Ahead Logging (WAL) mode."""
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import StaticPool

# SQLite database URL - WAL mode enabled for concurrent access safety
DATABASE_URL = "sqlite:///./payment_webhooks.db"

# Create engine with WAL mode and strict foreign keys
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},  # Safe for single-threaded apps
    poolclass=StaticPool,
    echo=False,
)

# Enable WAL mode via raw connection event
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    """Configure SQLite with WAL mode and unique constraints."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA synchronous=NORMAL")  # Balance durability and performance
    cursor.close()

# Create Base for declarative models
Base = declarative_base()

# Session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    """Dependency that provides a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
