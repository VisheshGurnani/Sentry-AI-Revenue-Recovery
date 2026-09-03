# Razorpay Autonomous Payment Recovery Service

An event-driven, production-ready payment recovery and telemetry platform designed to intercept, diagnose, and recover failed transactions at scale. Built with a FastAPI backend, a bounding state-machine policy engine, and a high-performance Vite/React dark-mode control center.

## Core Architecture & Features
- Deterministic State Machine (recovery.py): Replaces naive retry loops with a bounded policy engine. Automatically categorizes failures (GATEWAY_TIMEOUT, INSUFFICIENT_FUNDS, FRAUD_HOLD), enforces strict max-retry guards (MAX_RETRIES = 3), and routes capital safely.

- Cryptographic Security: Implements strict HMAC-SHA256 webhook signature validation (WEBHOOK_SECRET) to authenticate incoming gateway payloads and prevent unauthorized execution.

- Autonomous Batch Orchestration: Features a dedicated POST /recovery/sweep endpoint and global UI trigger to process pending transaction queues asynchronously.

- Audit & Telemetry Export: Provides real-time metric calculations—including Gross Loss Prevented (₹), Interventions Executed, and Irrecoverable Capital Halted—alongside a GET /audit/export endpoint for compliance logging.

- Institutional-Grade Frontend: Developed with React, Tailwind CSS, and custom DOM scrollbar optimizations for a high-contrast financial operations workspace.

## Tech Stack
- Backend: Python, FastAPI, Uvicorn, SQLAlchemy / SQLite

- Frontend: React, Vite, Tailwind CSS, Lucide Icons

- Infrastructure: Cloudflare Tunnels (cloudflared) for secure edge exposure
