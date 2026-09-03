import './App.css';
import React from 'react';
import { TelemetryDashboard } from './components/TelemetryDashboard';

/**
 * Razorpay Recovery Dashboard - Main Application Entry Point
 *
 * @component
 * @description Provides the root layout and semantic structure for the payment recovery dashboard.
 */
export default function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Application Header - Single H1 per page requirement */}
      <header role="banner" className="border-b border-white/10 bg-slate-900/50">
        <div className="mx-auto max-w-7xl px-4 py-4">
          <h1 className="text-2xl font-bold text-cyan-400">
            Razorpay Recovery Dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Autonomous payment failure recovery and revenue optimization
          </p>
        </div>
      </header>

      {/* Main Content Area */}
      <main role="main" className="py-6">
        <TelemetryDashboard />
      </main>

      {/* Footer with accessibility info */}
      <footer role="contentinfo" className="border-t border-white/10 bg-slate-900/50 py-4 text-center text-xs text-slate-500">
        <p>Razorpay Payment Recovery Service v1.0 | Last updated: {new Date().toLocaleString()}</p>
      </footer>
    </div>
  );
}