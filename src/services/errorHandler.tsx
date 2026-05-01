/**
 * Spordateur V2 — Frontend Error Handler
 * Comprehensive error logging, rate limiting, and deduplication
 * Integrates with Firestore errorLogs collection
 */

import { logError, resolveError } from '@/services/firestore';
import type { ErrorLog } from '@/types/firestore';
import { createContext, useContext, ReactNode, useState, useCallback } from 'react';

// ===================== TYPES =====================

interface ErrorLogEntry {
  message: string;
  stackTrace: string;
  url: string;
  userAgent: string;
  userId: string;
  level: 'error' | 'warning' | 'critical';
  timestamp: number;
}

interface ErrorHandlerConfig {
  maxErrorsPerMinute: number;
  deduplicationWindow: number; // milliseconds
  enableConsoleLogging: boolean;
  enableFirestoreLogging: boolean;
}

// ===================== ERROR HANDLER CLASS =====================

class ErrorHandler {
  private recentErrors: Map<string, ErrorLogEntry[]> = new Map();
  private errorHashes: Map<string, number> = new Map(); // hash -> timestamp of last similar error
  private config: ErrorHandlerConfig;
  private userId: string = '';

  constructor(config: Partial<ErrorHandlerConfig> = {}) {
    this.config = {
      maxErrorsPerMinute: 10,
      deduplicationWindow: 5 * 60 * 1000, // 5 minutes
      enableConsoleLogging: true,
      enableFirestoreLogging: true,
      ...config,
    };

    // Set up global error handlers
    this.setupGlobalHandlers();
  }

  /**
   * Set the current user ID for error logging context
   */
  setUserId(userId: string): void {
    this.userId = userId;
  }

  /**
   * Hash error for deduplication
   */
  private hashError(message: string, stackTrace: string): string {
    // Simple hash: combine first 100 chars of message + first 200 chars of stack
    const combined = message.substring(0, 100) + stackTrace.substring(0, 200);
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Check if error should be rate-limited
   */
  private isRateLimited(userId: string): boolean {
    const now = Date.now();
    const userErrors = this.recentErrors.get(userId) || [];

    // Remove old errors outside the 1-minute window
    const recentErrors = userErrors.filter(e => now - e.timestamp < 60 * 1000);

    if (recentErrors.length >= this.config.maxErrorsPerMinute) {
      return true;
    }

    this.recentErrors.set(userId, recentErrors);
    return false;
  }

  /**
   * Check if error is a duplicate within deduplication window
   */
  private isDuplicate(errorHash: string): boolean {
    const now = Date.now();
    const lastTime = this.errorHashes.get(errorHash);

    if (!lastTime) {
      this.errorHashes.set(errorHash, now);
      return false;
    }

    const isDupe = now - lastTime < this.config.deduplicationWindow;

    if (!isDupe) {
      // Update timestamp for next check
      this.errorHashes.set(errorHash, now);
    }

    return isDupe;
  }

  /**
   * Main error logging function
   */
  async captureError(
    message: string,
    stackTrace: string = '',
    level: 'error' | 'warning' | 'critical' = 'error',
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    const now = Date.now();
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';

    // Rate limiting
    if (this.isRateLimited(this.userId)) {
      if (this.config.enableConsoleLogging) {
        console.warn(`[ErrorHandler] Rate limited for user ${this.userId}`);
      }
      return;
    }

    // Deduplication
    const errorHash = this.hashError(message, stackTrace);
    if (this.isDuplicate(errorHash)) {
      if (this.config.enableConsoleLogging) {
        console.warn(`[ErrorHandler] Duplicate error suppressed: ${message.substring(0, 50)}`);
      }
      return;
    }

    // Create error log entry
    const errorEntry: ErrorLogEntry = {
      message,
      stackTrace,
      url,
      userAgent,
      userId: this.userId,
      level,
      timestamp: now,
    };

    // Log to Firestore
    if (this.config.enableFirestoreLogging) {
      try {
        await logError({
          source: 'frontend',
          level,
          message,
          stackTrace,
          userId: this.userId,
          url,
          userAgent,
          metadata,
        });
      } catch (fsError) {
        console.error('[ErrorHandler] Failed to log to Firestore:', fsError);
      }
    }

    // Log to console
    if (this.config.enableConsoleLogging) {
      const prefix = `[${level.toUpperCase()}]`;
      console.error(`${prefix} ${message}`, {
        stackTrace,
        url,
        userId: this.userId,
        metadata,
      });
    }

    // Track in memory
    const userErrors = this.recentErrors.get(this.userId) || [];
    userErrors.push(errorEntry);
    this.recentErrors.set(this.userId, userErrors);
  }

  /**
   * Set up global error handlers
   */
  private setupGlobalHandlers(): void {
    if (typeof window === 'undefined') return;

    // Catch unhandled errors
    window.addEventListener('error', (event) => {
      this.captureError(
        event.message || 'Unknown error',
        event.error?.stack || '',
        'critical',
        {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        }
      );
    });

    // Catch unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      const message = event.reason?.message || String(event.reason) || 'Unhandled promise rejection';
      const stack = event.reason?.stack || '';

      this.captureError(message, stack, 'error', {
        type: 'unhandledPromiseRejection',
      });
    });
  }

  /**
   * Get error statistics for debugging
   */
  getStats(): { totalErrors: number; uniqueHashes: number; usersWithErrors: number } {
    return {
      totalErrors: Array.from(this.recentErrors.values()).reduce((sum, arr) => sum + arr.length, 0),
      uniqueHashes: this.errorHashes.size,
      usersWithErrors: this.recentErrors.size,
    };
  }

  /**
   * Clear old tracking data
   */
  clearOldData(): void {
    const now = Date.now();
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;

    // Clear old error hashes
    for (const [hash, timestamp] of this.errorHashes.entries()) {
      if (now - timestamp > this.config.deduplicationWindow) {
        this.errorHashes.delete(hash);
      }
    }

    // Clear old user error lists
    for (const [userId, errors] of this.recentErrors.entries()) {
      const filtered = errors.filter(e => e.timestamp > twoHoursAgo);
      if (filtered.length === 0) {
        this.recentErrors.delete(userId);
      } else {
        this.recentErrors.set(userId, filtered);
      }
    }
  }
}

// ===================== SINGLETON INSTANCE =====================

const globalErrorHandler = new ErrorHandler({
  maxErrorsPerMinute: 10,
  deduplicationWindow: 5 * 60 * 1000,
  enableConsoleLogging: true,
  enableFirestoreLogging: true,
});

// ===================== REACT CONTEXT & HOOKS =====================

interface ErrorHandlerContextValue {
  captureError: (
    message: string,
    stackTrace?: string,
    level?: 'error' | 'warning' | 'critical',
    metadata?: Record<string, unknown>
  ) => Promise<void>;
  setUserId: (userId: string) => void;
  getStats: () => { totalErrors: number; uniqueHashes: number; usersWithErrors: number };
}

const ErrorHandlerContext = createContext<ErrorHandlerContextValue | null>(null);

export function ErrorHandlerProvider({ children }: { children: ReactNode }) {
  const value: ErrorHandlerContextValue = {
    captureError: (msg, stack, level, meta) => globalErrorHandler.captureError(msg, stack, level, meta),
    setUserId: (uid) => globalErrorHandler.setUserId(uid),
    getStats: () => globalErrorHandler.getStats(),
  };

  return <ErrorHandlerContext.Provider value={value}>{children}</ErrorHandlerContext.Provider>;
}

export function useErrorHandler(): ErrorHandlerContextValue {
  const context = useContext(ErrorHandlerContext);
  if (!context) {
    throw new Error('useErrorHandler must be used within ErrorHandlerProvider');
  }
  return context;
}

// ===================== REACT ERROR BOUNDARY =====================

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log to global error handler
    globalErrorHandler.captureError(
      error.message,
      `${error.stack}\n\n${errorInfo.componentStack}`,
      'critical',
      { errorInfo }
    );

    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      return this.props.fallback ? (
        this.props.fallback(this.state.error)
      ) : (
        <div
          style={{
            padding: '2rem',
            backgroundColor: '#fee',
            border: '2px solid #f00',
            borderRadius: '4px',
            fontFamily: 'monospace',
          }}
        >
          <h1>Something went wrong</h1>
          <pre>{this.state.error.toString()}</pre>
          <p>Please refresh the page or contact support.</p>
        </div>
      );
    }

    return this.props.children;
  }
}

// Add React import at module level for error boundary
import React from 'react';

// ===================== EXPORTS =====================

export { globalErrorHandler };
export type { ErrorLogEntry, ErrorHandlerConfig };
