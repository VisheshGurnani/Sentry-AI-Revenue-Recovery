import { AnimatePresence, motion } from "framer-motion";
import React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button } from "./ui.jsx";

const API_BASE_URL = "/api";
const POLL_INTERVAL_MS = 2000;
const CATEGORY_ORDER = [
  "GATEWAY_TIMEOUT",
  "INSUFFICIENT_FUNDS",
  "FRAUD_HOLD",
  "MANDATE_RETRY",
  "CHECKOUT_DROP_OFF",
];

function injectTailwindRuntime() {
  if (document.getElementById("tailwind-cdn-runtime")) {
    return;
  }

  const config = document.createElement("script");
  config.textContent = `
    tailwind = {
      theme: {
        extend: {
          fontFamily: {
            sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
            mono: ["JetBrains Mono", "SFMono-Regular", "Consolas", "monospace"]
          }
        }
      }
    }
  `;
  document.head.appendChild(config);

  const script = document.createElement("script");
  script.id = "tailwind-cdn-runtime";
  script.src = "https://cdn.tailwindcss.com";
  document.head.appendChild(script);
}

function firstDefined(source, keys, fallback = undefined) {
  for (const key of keys) {
    if (source?.[key] !== undefined && source?.[key] !== null) {
      return source[key];
    }
  }
  return fallback;
}

function toArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function formatPercent(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? `${numberValue.toFixed(2)}%` : "0.00%";
}

function formatNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toLocaleString("en-IN") : "0";
}

function formatCurrency(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue)
    ? numberValue.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })
    : "0.00";
}

function formatDate(value) {
  if (!value) {
    return "Pending timestamp";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function formatCell(value) {
  if (value === undefined || value === null || value === "") {
    return "-";
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function getTransactionId(entry) {
  return firstDefined(entry, ["transaction_id", "transactionId", "txn_id", "id"], "");
}

function getCategory(entry) {
  return String(
    firstDefined(
      entry,
      ["failure_category", "failureCategory", "root_cause", "rootCause", "category", "classification"],
      "UNKNOWN",
    ),
  ).toUpperCase();
}

function getStatus(entry) {
  return firstDefined(entry, ["recovery_status", "recovery_state", "recoveryState", "state", "status"], "FAILED");
}

function isIdempotencyLockBlocked(entry, duplicateCounts) {
  const transactionId = getTransactionId(entry);
  const explicitBlocked = firstDefined(entry, [
    "idempotency_lock_blocked",
    "idempotencyLockBlocked",
    "blocked_by_idempotency_lock",
    "blockedByIdempotencyLock",
    "duplicate_blocked",
    "duplicateBlocked",
  ]);

  if (explicitBlocked === true) {
    return true;
  }

  const lockText = [
    entry?.status,
    entry?.reason,
    entry?.error,
    entry?.message,
    entry?.event_type,
    entry?.eventType,
    entry?.raw_error_payload?.error_code,
    entry?.raw_error_payload?.error_message,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    (transactionId && duplicateCounts.get(transactionId) > 1) ||
    (lockText.includes("duplicate") && lockText.includes("idempot")) ||
    lockText.includes("idempotency lock")
  );
}

function normalizeAuditLog(metrics, transactions) {
  const sourceRows = transactions.length
    ? transactions
    : toArray(firstDefined(metrics, ["raw_audit_log", "auditLog", "audit_log", "failures"], []));

  const duplicateCounts = new Map();
  for (const entry of sourceRows) {
    const transactionId = getTransactionId(entry);
    if (transactionId) {
      duplicateCounts.set(transactionId, (duplicateCounts.get(transactionId) || 0) + 1);
    }
  }

  return sourceRows.map((entry, index) => {
    const transactionId = getTransactionId(entry);
    const category = getCategory(entry);

    return {
      amount: Number(firstDefined(entry, ["amount", "revenue_at_risk", "revenueAtRisk"], 0)),
      category,
      idempotencyBlocked: isIdempotencyLockBlocked(entry, duplicateCounts),
      key: firstDefined(entry, ["audit_id", "auditId", "id"], `${transactionId || "row"}-${index}`),
      raw: entry,
      rootCause: firstDefined(entry, ["root_cause", "rootCause", "reason"], category),
      status: getStatus(entry),
      timestamp: firstDefined(entry, ["timestamp", "received_at", "receivedAt", "created_at", "createdAt"]),
      transactionId,
    };
  });
}

function normalizeMetrics(metrics, transactions) {
  const auditLog = normalizeAuditLog(metrics, transactions);
  const distributions = firstDefined(metrics, [
    "current_state_distributions",
    "currentStateDistributions",
    "state_distributions",
    "failure_category_distributions",
  ], {});
  const totalFailuresProcessed = Number(firstDefined(metrics, [
    "total_failures_processed",
    "totalFailuresProcessed",
    "total_failures",
  ], auditLog.length));
  const recoveredCount = Number(firstDefined(metrics, [
    "strict_recovered_count",
    "recovered_count",
    "recoveredCount",
  ], auditLog.filter((row) => String(row.status).toUpperCase().includes("RECOVER")).length));
  const strictNetRecoveryPercentage = firstDefined(metrics, [
    "strict_net_recovery_percentage",
    "strictNetRecoveryPercentage",
    "net_recovery_percentage",
    "netRecoveryPercentage",
  ], totalFailuresProcessed ? (recoveredCount / totalFailuresProcessed) * 100 : 0);
  const totalRevenueAtRisk = firstDefined(metrics, [
    "total_revenue_at_risk",
    "totalRevenueAtRisk",
    "revenue_at_risk",
    "revenueAtRisk",
  ], auditLog.reduce((sum, row) => sum + row.amount, 0));
  const activeInterventions = firstDefined(metrics, [
    "active_interventions",
    "activeInterventions",
    "interventions_active",
  ], auditLog.filter((row) => /PENDING|RETRY|INTERVENTION|PROCESSING/i.test(String(row.status))).length);

  // Calculate new metrics for Phase 3
  const grossLossPrevented = firstDefined(metrics, [
    "gross_loss_prevented",
    "grossLossPrevented",
    "loss_prevented",
    "lossPrevented",
  ], auditLog.filter((row) => /RECOVER|SETTLED/i.test(String(row.status))).reduce((sum, row) => sum + row.amount, 0));
  const interventionsExecuted = firstDefined(metrics, [
    "interventions_executed",
    "interventionsExecuted",
    "interventions_executed_count",
    "interventionsExecutedCount",
  ], auditLog.filter((row) => /RECOVERY|INTERVENTION/i.test(String(row.event_type) || row.raw?.event_type || "")).length);
  const irrecoverableCapitalHalted = firstDefined(metrics, [
    "irrecoverable_capital_halted",
    "irrecoverableCapitalHalted",
    "capital_halted",
    "capitalHalted",
  ], auditLog.filter((row) => /TERMINAL_ABORT|FAILED|ERROR/i.test(String(row.status))).reduce((sum, row) => sum + row.amount, 0));

  return {
    activeInterventions: Number(activeInterventions) || 0,
    auditLog,
    distributions,
    duplicateLockBlocks: auditLog.filter((row) => row.idempotencyBlocked).length,
    exceptions: toArray(firstDefined(metrics, ["unresolvable_exceptions", "unresolvableExceptions", "exceptions"], [])),
    strictNetRecoveryPercentage,
    totalFailuresProcessed: Number.isFinite(totalFailuresProcessed) ? totalFailuresProcessed : auditLog.length,
    totalRevenueAtRisk: Number(totalRevenueAtRisk) || 0,
    grossLossPrevented: Number(grossLossPrevented) || 0,
    interventionsExecuted: Number(interventionsExecuted) || 0,
    irrecoverableCapitalHalted: Number(irrecoverableCapitalHalted) || 0,
  };
}

function categoryTone(category) {
  switch (String(category).toUpperCase()) {
    case "GATEWAY_TIMEOUT":
      return {
        bar: "from-cyan-400 to-sky-500",
        badge: "border-cyan-300/40 bg-cyan-300/15 text-cyan-100 shadow-cyan-500/20",
        glow: "shadow-cyan-500/20",
        text: "text-cyan-200",
      };
    case "INSUFFICIENT_FUNDS":
      return {
        bar: "from-amber-300 to-orange-500",
        badge: "border-amber-300/40 bg-amber-300/15 text-amber-100 shadow-amber-500/20",
        glow: "shadow-amber-500/20",
        text: "text-amber-200",
      };
    case "FRAUD_HOLD":
      return {
        bar: "from-rose-400 to-fuchsia-500",
        badge: "border-rose-300/40 bg-rose-300/15 text-rose-100 shadow-rose-500/20",
        glow: "shadow-rose-500/20",
        text: "text-rose-200",
      };
    case "MANDATE_RETRY":
      return {
        bar: "from-violet-400 to-indigo-500",
        badge: "border-violet-300/40 bg-violet-300/15 text-violet-100 shadow-violet-500/20",
        glow: "shadow-violet-500/20",
        text: "text-violet-200",
      };
    case "CHECKOUT_DROP_OFF":
      return {
        bar: "from-emerald-300 to-teal-500",
        badge: "border-emerald-300/40 bg-emerald-300/15 text-emerald-100 shadow-emerald-500/20",
        glow: "shadow-emerald-500/20",
        text: "text-emerald-200",
      };
    default:
      return {
        bar: "from-slate-400 to-slate-600",
        badge: "border-slate-400/40 bg-slate-400/15 text-slate-100 shadow-slate-500/20",
        glow: "shadow-slate-500/20",
        text: "text-slate-200",
      };
  }
}

function GlassPanel({ children, className = "", delay = 0 }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, duration: 0.45, ease: "easeOut" }}
      className={`rounded-2xl border border-white/10 bg-white/[0.055] shadow-2xl shadow-black/35 backdrop-blur-xl ${className}`}
    >
      {children}
    </motion.section>
  );
}

function MetricCard({ accent, delay, label, sublabel, value }) {
  return (
    <GlassPanel className="relative overflow-hidden p-5" delay={delay}>
      <div className={`absolute -right-10 -top-10 h-28 w-28 rounded-full ${accent} opacity-20 blur-3xl`} />
      <div className="relative">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
        <motion.div
          key={String(value)}
          initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.35 }}
          className="mt-3 font-mono text-3xl font-semibold tracking-tight text-white md:text-4xl"
        >
          {value}
        </motion.div>
        <p className="mt-2 text-sm text-slate-400">{sublabel}</p>
      </div>
    </GlassPanel>
  );
}

function ControlCenterGrid({ distributions, totalFailuresProcessed }) {
  const rows = CATEGORY_ORDER.map((category) => ({
    category,
    count: Number(distributions?.[category] || 0),
    tone: categoryTone(category),
  }));
  const max = Math.max(1, ...rows.map((row) => row.count));

  return (
    <GlassPanel className="p-5" delay={0.2}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">Control center grid</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Failure State Distribution</h2>
        </div>
        <div className="rounded-full border border-white/10 bg-black/25 px-3 py-1 font-mono text-sm text-slate-300">
          {formatNumber(totalFailuresProcessed)} processed
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {rows.map((row) => (
          <motion.article
            key={row.category}
            layout
            whileHover={{ y: -3 }}
            className={`rounded-xl border border-white/10 bg-slate-950/50 p-4 shadow-xl ${row.tone.glow}`}
          >
            <div className="flex items-center justify-between gap-3">
              <Badge className={`${row.tone.badge} shadow-lg`}>{row.category}</Badge>
              <span className={`font-mono text-2xl font-semibold ${row.tone.text}`}>{row.count}</span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800/80">
              <motion.div
                className={`h-full rounded-full bg-gradient-to-r ${row.tone.bar}`}
                initial={false}
                animate={{ width: `${(row.count / max) * 100}%` }}
                transition={{ duration: 0.55, ease: "easeOut" }}
              />
            </div>
            <p className="mt-3 text-xs text-slate-500">
              {max === 1 && row.count === 0 ? "No active volume" : `${Math.round((row.count / max) * 100)}% relative load`}
            </p>
          </motion.article>
        ))}
      </div>
    </GlassPanel>
  );
}

function statusTone(status) {
  if (/RECOVER/i.test(String(status))) {
    return "border-emerald-300/40 bg-emerald-300/15 text-emerald-100";
  }
  if (/PROCESS|INTERVENTION|RETRY/i.test(String(status))) {
    return "border-cyan-300/40 bg-cyan-300/15 text-cyan-100";
  }
  if (/FAILED|ERROR|BLOCK/i.test(String(status))) {
    return "border-red-300/40 bg-red-300/15 text-red-100";
  }
  return "border-slate-400/40 bg-slate-400/15 text-slate-100";
}

function RecoveryAuditTable({ rows, onRecover, recoveringIds }) {
  const [expandedRow, setExpandedRow] = useState("");

  return (
    <GlassPanel className="overflow-hidden" delay={0.25}>
      <div className="border-b border-white/10 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">Autonomous recovery fabric</p>
            <h2 className="mt-2 text-xl font-semibold text-white">Live Recovery Audit & Action Table</h2>
          </div>
          <Badge className="border-emerald-300/40 bg-emerald-300/15 text-emerald-100 shadow-lg shadow-emerald-500/20">
            Live every 2s
          </Badge>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1060px] text-left text-sm">
          <thead className="bg-black/30 text-xs uppercase tracking-[0.16em] text-slate-500">
            <tr>
              <th className="px-5 py-4 font-semibold">Timestamp</th>
              <th className="px-5 py-4 font-semibold">Transaction</th>
              <th className="px-5 py-4 font-semibold">Amount at Risk</th>
              <th className="px-5 py-4 font-semibold">Root Cause</th>
              <th className="px-5 py-4 font-semibold">Current Status</th>
              <th className="px-5 py-4 font-semibold">Intervention</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            <AnimatePresence initial={false}>
              {rows.length === 0 ? (
                <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <td className="px-5 py-12 text-center text-slate-400" colSpan="6">
                    No processed failures are available from /metrics or /transactions yet.
                  </td>
                </motion.tr>
              ) : (
                rows.map((row) => {
                  const tone = categoryTone(row.category);
                  const isExpanded = expandedRow === row.key;

                  return (
                    <React.Fragment key={row.key}>
                      <motion.tr
                        layout
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        onClick={() => setExpandedRow(isExpanded ? "" : row.key)}
                        className={`cursor-pointer transition hover:bg-white/[0.045] ${
                          row.idempotencyBlocked
                            ? "bg-red-500/15 shadow-[inset_4px_0_0_rgb(248_113_113)]"
                            : "bg-slate-950/35"
                        }`}
                      >
                        <td className="px-5 py-4 text-slate-300">{formatDate(row.timestamp)}</td>
                        <td className="px-5 py-4">
                          <div className="font-mono text-slate-100">{formatCell(row.transactionId)}</div>
                          {row.idempotencyBlocked && (
                            <div className="mt-1 text-xs font-semibold text-red-200">
                              Duplicate blocked by backend idempotency lock
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-4 font-mono text-slate-100">₹{formatCurrency(row.amount)}</td>
                        <td className="px-5 py-4">
                          <Badge className={`${tone.badge} shadow-lg`}>{formatCell(row.rootCause)}</Badge>
                        </td>
                        <td className="px-5 py-4">
                          <Badge className={statusTone(row.status)}>{formatCell(row.status)}</Badge>
                        </td>
                        <td className="px-5 py-4">
                          <Button
                            disabled={!row.transactionId || recoveringIds.has(row.transactionId)}
                            onClick={(event) => {
                              event.stopPropagation();
                              onRecover(row.transactionId);
                            }}
                            className="border-cyan-300/40 bg-cyan-300/15 text-cyan-50 shadow-lg shadow-cyan-500/10"
                          >
                            {recoveringIds.has(row.transactionId) ? "Executing" : "Execute AI Intervention"}
                          </Button>
                        </td>
                      </motion.tr>
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.tr
                            layout
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="bg-black/25"
                          >
                            <td className="px-5 py-4" colSpan="6">
                              <div className="grid gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-4 md:grid-cols-3">
                                <div>
                                  <p className="text-xs uppercase tracking-wide text-slate-500">Category</p>
                                  <p className={`mt-1 font-semibold ${tone.text}`}>{row.category}</p>
                                </div>
                                <div>
                                  <p className="text-xs uppercase tracking-wide text-slate-500">Lock disposition</p>
                                  <p className="mt-1 font-semibold text-slate-200">
                                    {row.idempotencyBlocked ? "Idempotency block enforced" : "No duplicate lock block"}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs uppercase tracking-wide text-slate-500">Raw audit payload</p>
                                  <code className="mt-1 block max-h-28 overflow-auto break-words text-xs text-slate-300">
                                    {formatCell(row.raw)}
                                  </code>
                                </div>
                              </div>
                            </td>
                          </motion.tr>
                        )}
                      </AnimatePresence>
                    </React.Fragment>
                  );
                })
              )}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
    </GlassPanel>
  );
}

function ExceptionsPanel({ exceptions }) {
  return (
    <GlassPanel className="p-5" delay={0.3}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-red-200">Exception queue</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Unresolvable Exceptions</h2>
        </div>
        <span className="rounded-full border border-red-300/30 bg-red-300/10 px-3 py-1 font-mono text-sm text-red-100">
          {exceptions.length}
        </span>
      </div>
      <div className="mt-5">
        {exceptions.length === 0 ? (
          <p className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
            No unresolvable exceptions reported by the recovery backend.
          </p>
        ) : (
          <ul className="space-y-3">
            {exceptions.map((exception, index) => (
              <motion.li
                key={`${formatCell(exception)}-${index}`}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                className="rounded-xl border border-red-300/20 bg-red-500/10 p-4 font-mono text-xs text-red-100 shadow-lg shadow-red-950/20"
              >
                {formatCell(exception)}
              </motion.li>
            ))}
          </ul>
        )}
      </div>
    </GlassPanel>
  );
}

/**
 * TelemetryDashboard - Main dashboard component
 *
 * @component
 * @description Provides real-time monitoring and AI-powered recovery operations for failed payment transactions.
 */
export function TelemetryDashboard() {
  const [metrics, setMetrics] = useState({});
  const [transactions, setTransactions] = useState([]);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [recoveringIds, setRecoveringIds] = useState(new Set());
  const pollAbortRef = useRef(null);

  useEffect(() => {
    injectTailwindRuntime();
  }, []);

  /**
   * Fetch telemetry data from FastAPI backend
   * @returns {Promise<void>} Resolves when data is fetched
   */
  const fetchTelemetry = useCallback(async () => {
    pollAbortRef.current?.abort();
    const controller = new AbortController();
    pollAbortRef.current = controller;

    const metricsResponse = await fetch(`/api/metrics`, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!metricsResponse.ok) {
      throw new Error(`/metrics returned HTTP ${metricsResponse.status}`);
    }

    const nextMetrics = await metricsResponse.json();
    let nextTransactions = [];

    try {
      const transactionsResponse = await fetch(`/api/transactions`, {
        cache: "no-store",
        signal: controller.signal,
      });

      if (transactionsResponse.ok) {
        nextTransactions = toArray(await transactionsResponse.json());
      }
    } catch (transactionError) {
      if (transactionError.name === "AbortError") {
        throw transactionError;
      }
    }

    setMetrics(nextMetrics);
    setTransactions(nextTransactions);
    setLastUpdated(new Date());
    setError("");
  }, []);

  useEffect(() => {
    let active = true;
    let timeoutId;

    async function poll() {
      try {
        await fetchTelemetry();
      } catch (nextError) {
        if (active && nextError.name !== "AbortError") {
          setError(nextError.message || "Unable to fetch telemetry");
        }
      } finally {
        if (active) {
          timeoutId = window.setTimeout(poll, POLL_INTERVAL_MS);
        }
      }
    }

    poll();

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      pollAbortRef.current?.abort();
    };
  }, [fetchTelemetry]);

  const normalized = useMemo(() => normalizeMetrics(metrics, transactions), [metrics, transactions]);

  async function recoverTransaction(transactionId) {
    setRecoveringIds((current) => new Set(current).add(transactionId));
    setTransactions((current) =>
      current.map((transaction) =>
        getTransactionId(transaction) === transactionId
          ? { ...transaction, recovery_state: "AI_INTERVENTION_EXECUTING" }
          : transaction,
      ),
    );

    try {
      const response = await fetch(`/api/transactions/${encodeURIComponent(transactionId)}/recover`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`Recovery for ${transactionId} returned HTTP ${response.status}`);
      }

      const recoveredTransaction = await response.json().catch(() => null);
      setTransactions((current) =>
        current.map((transaction) =>
          getTransactionId(transaction) === transactionId
            ? { ...transaction, ...recoveredTransaction, recovery_state: "RECOVERED" }
            : transaction,
        ),
      );

      await fetchTelemetry();
    } catch (nextError) {
      setError(nextError.message || `Unable to recover ${transactionId}`);
      setTransactions((current) =>
        current.map((transaction) =>
          getTransactionId(transaction) === transactionId ? { ...transaction, recovery_state: "INTERVENTION_FAILED" } : transaction,
        ),
      );
    } finally {
      setRecoveringIds((current) => {
        const next = new Set(current);
        next.delete(transactionId);
        return next;
      });
    }
  }

  async function executeAutonomousSweep() {
    try {
      const response = await fetch("/api/recovery/sweep", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`Sweep returned HTTP ${response.status}`);
      }

      await fetchTelemetry();
    } catch (error) {
      setError(error.message || "Unable to execute autonomous sweep");
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#05070d] px-4 py-6 text-slate-100 md:px-8">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-10%] top-[-12%] h-96 w-96 rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="absolute right-[-8%] top-[12%] h-96 w-96 rounded-full bg-fuchsia-500/10 blur-3xl" />
        <div className="absolute bottom-[-20%] left-[35%] h-[30rem] w-[30rem] rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(148,163,184,0.10),transparent_35%),linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:auto,48px_48px,48px_48px]" />
      </div>

      <div className="relative mx-auto max-w-7xl space-y-6">
        <motion.header
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-2xl shadow-black/50 backdrop-blur-2xl md:p-8"
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-100 shadow-lg shadow-cyan-500/10">
                Autonomous Revenue Recovery Control Center
              </div>
              <h1 className="mt-5 max-w-4xl text-4xl font-semibold tracking-tight text-white md:text-6xl">
                Revenue rescue operations, live failure intelligence, and AI recovery execution.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-400 md:text-base">
                Polling FastAPI recovery telemetry from /api with live idempotency lock visibility.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-slate-300">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_18px_rgb(110_231_183)]" />
                  Polling cadence: {POLL_INTERVAL_MS / 1000}s
                </div>
                <div className="mt-2">Last sync: {lastUpdated ? lastUpdated.toLocaleTimeString() : "waiting"}</div>
                {error && <div className="mt-2 max-w-sm text-red-200">{error}</div>}
              </div>
              <Button
                onClick={executeAutonomousSweep}
                className="border-cyan-300/40 bg-cyan-300/15 text-cyan-50 shadow-lg shadow-cyan-500/10 hover:bg-cyan-300/25 transition"
              >
                Run Autonomous Sweep
              </Button>
            </div>
          </div>
        </motion.header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            accent="bg-cyan-400"
            delay={0.05}
            label="Strict Net Recovery %"
            sublabel="Recovered failures divided by total processed failures"
            value={formatPercent(normalized.strictNetRecoveryPercentage)}
          />
          <MetricCard
            accent="bg-emerald-400"
            delay={0.1}
            label="Gross Loss Prevented"
            sublabel={`₹${formatCurrency(normalized.grossLossPrevented)}`}
            value={`₹${formatCurrency(normalized.grossLossPrevented)}`}
          />
          <MetricCard
            accent="bg-violet-400"
            delay={0.15}
            label="Interventions Executed"
            sublabel="Total recovery actions taken by autonomous system"
            value={formatNumber(normalized.interventionsExecuted)}
          />
          <MetricCard
            accent="bg-red-400"
            delay={0.2}
            label="Irrecoverable Capital Halted"
            sublabel={`₹${formatCurrency(normalized.irrecoverableCapitalHalted)}`}
            value={`₹${formatCurrency(normalized.irrecoverableCapitalHalted)}`}
          />
        </section>

        <ControlCenterGrid
          distributions={normalized.distributions}
          totalFailuresProcessed={normalized.totalFailuresProcessed}
        />

        <RecoveryAuditTable
          recoveringIds={recoveringIds}
          rows={normalized.auditLog}
          onRecover={recoverTransaction}
        />

        <ExceptionsPanel exceptions={normalized.exceptions} />
      </div>
    </main>
  );
}
