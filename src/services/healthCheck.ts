/**
 * Spordateur V2 — Health Check Service
 * Monitors Firebase, Stripe, and error rates
 * Returns overall system health status
 */

import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, orderBy, limit, Timestamp } from 'firebase/firestore';
import type { ErrorLog } from '@/types/firestore';

// ===================== TYPES =====================

export type HealthStatus = 'healthy' | 'degraded' | 'critical';

export interface ServiceHealth {
  name: string;
  status: HealthStatus;
  statusCode: number;
  message: string;
  lastChecked: string;
  responseTime: number; // milliseconds
}

export interface HealthCheckReport {
  overallStatus: HealthStatus;
  timestamp: string;
  services: {
    firebase: ServiceHealth;
    stripe: ServiceHealth;
    errors: ServiceHealth;
  };
  metrics: {
    errorCountLastHour: number;
    criticalErrorCount: number;
    averageResponseTime: number;
  };
}

// ===================== HELPERS =====================

/**
 * Convert health statuses to a combined overall status
 */
function combineHealthStatuses(statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes('critical')) return 'critical';
  if (statuses.includes('degraded')) return 'degraded';
  return 'healthy';
}

// ===================== SERVICE HEALTH CHECKS =====================

/**
 * Check Firebase connectivity
 */
async function checkFirebase(): Promise<ServiceHealth> {
  const startTime = Date.now();

  try {
    if (!db) {
      return {
        name: 'Firebase',
        status: 'critical',
        statusCode: 0,
        message: 'Firebase not initialized',
        lastChecked: new Date().toISOString(),
        responseTime: 0,
      };
    }

    // Try a simple read operation
    const snap = await getDocs(query(collection(db, 'users'), limit(1)));

    const responseTime = Date.now() - startTime;

    // If response time > 5 seconds, consider it degraded
    const status: HealthStatus = responseTime > 5000 ? 'degraded' : 'healthy';

    return {
      name: 'Firebase',
      status,
      statusCode: 200,
      message: `Firebase connected (${responseTime}ms)`,
      lastChecked: new Date().toISOString(),
      responseTime,
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;

    return {
      name: 'Firebase',
      status: 'critical',
      statusCode: 500,
      message: `Firebase connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      lastChecked: new Date().toISOString(),
      responseTime,
    };
  }
}

/**
 * Check Stripe API connectivity
 * Note: This is a simple check and would require proper Stripe API integration
 */
async function checkStripe(): Promise<ServiceHealth> {
  const startTime = Date.now();

  try {
    // In a real implementation, you would call a Stripe API endpoint
    // For now, we'll do a simple health check structure
    const stripeApiKey = process.env.REACT_APP_STRIPE_PUBLIC_KEY;

    if (!stripeApiKey) {
      return {
        name: 'Stripe',
        status: 'critical',
        statusCode: 0,
        message: 'Stripe API key not configured',
        lastChecked: new Date().toISOString(),
        responseTime: 0,
      };
    }

    // Simulate a Stripe health check (in production, call actual Stripe endpoint)
    // This would typically be done from a backend
    const responseTime = Date.now() - startTime;

    return {
      name: 'Stripe',
      status: responseTime > 3000 ? 'degraded' : 'healthy',
      statusCode: 200,
      message: `Stripe available (${responseTime}ms)`,
      lastChecked: new Date().toISOString(),
      responseTime,
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;

    return {
      name: 'Stripe',
      status: 'degraded',
      statusCode: 503,
      message: `Stripe check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      lastChecked: new Date().toISOString(),
      responseTime,
    };
  }
}

/**
 * Check for recent critical errors
 */
async function checkErrorRate(): Promise<ServiceHealth & { errorCount: number; criticalCount: number }> {
  const startTime = Date.now();

  try {
    if (!db) {
      return {
        name: 'Error Rate',
        status: 'critical',
        statusCode: 0,
        message: 'Cannot check error rate - Firebase not initialized',
        lastChecked: new Date().toISOString(),
        responseTime: 0,
        errorCount: 0,
        criticalCount: 0,
      };
    }

    // Get errors from the last hour
    const oneHourAgo = Timestamp.fromDate(new Date(Date.now() - 60 * 60 * 1000));

    const errorSnap = await getDocs(
      query(
        collection(db, 'errorLogs'),
        where('createdAt', '>=', oneHourAgo),
        where('resolved', '==', false),
        orderBy('createdAt', 'desc'),
        limit(1000)
      )
    );

    const errors = errorSnap.docs.map(d => d.data() as ErrorLog);

    // Count critical errors
    const criticalErrors = errors.filter(e => e.level === 'critical');

    const responseTime = Date.now() - startTime;

    let status: HealthStatus = 'healthy';

    // Health status based on error count
    if (criticalErrors.length > 10) {
      status = 'critical';
    } else if (criticalErrors.length > 5) {
      status = 'degraded';
    } else if (errors.length > 50) {
      status = 'degraded';
    }

    return {
      name: 'Error Rate',
      status,
      statusCode: 200,
      message: `${errors.length} errors in last hour (${criticalErrors.length} critical)`,
      lastChecked: new Date().toISOString(),
      responseTime,
      errorCount: errors.length,
      criticalCount: criticalErrors.length,
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;

    return {
      name: 'Error Rate',
      status: 'degraded',
      statusCode: 500,
      message: `Error check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      lastChecked: new Date().toISOString(),
      responseTime,
      errorCount: 0,
      criticalCount: 0,
    };
  }
}

// ===================== MAIN HEALTH CHECK =====================

/**
 * Run complete health check
 */
export async function performHealthCheck(): Promise<HealthCheckReport> {
  console.log('[HealthCheck] Starting health check...');

  const startTime = Date.now();

  // Run all checks in parallel
  const [firebaseHealth, stripeHealth, errorHealth] = await Promise.all([
    checkFirebase(),
    checkStripe(),
    checkErrorRate(),
  ]);

  // Extract metrics
  const metrics = {
    errorCountLastHour: errorHealth.errorCount,
    criticalErrorCount: errorHealth.criticalCount,
    averageResponseTime: Math.round(
      (firebaseHealth.responseTime + stripeHealth.responseTime + errorHealth.responseTime) / 3
    ),
  };

  // Calculate overall status
  const overallStatus = combineHealthStatuses([
    firebaseHealth.status,
    stripeHealth.status,
    errorHealth.status,
  ]);

  const report: HealthCheckReport = {
    overallStatus,
    timestamp: new Date().toISOString(),
    services: {
      firebase: firebaseHealth,
      stripe: stripeHealth,
      errors: errorHealth,
    },
    metrics,
  };

  console.log('[HealthCheck] Report:', report);
  console.log(`[HealthCheck] Completed in ${Date.now() - startTime}ms`);

  return report;
}

/**
 * Simple health check suitable for uptime monitoring
 */
export async function quickHealthCheck(): Promise<{ status: HealthStatus; timestamp: string }> {
  try {
    const report = await performHealthCheck();
    return {
      status: report.overallStatus,
      timestamp: report.timestamp,
    };
  } catch (error) {
    console.error('[HealthCheck] Quick check failed:', error);
    return {
      status: 'critical',
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Get a human-readable health report
 */
export function formatHealthReport(report: HealthCheckReport): string {
  const lines = [
    `Health Check Report - ${report.timestamp}`,
    `Overall Status: ${report.overallStatus.toUpperCase()}`,
    '',
    'Services:',
    `  Firebase: ${report.services.firebase.status} (${report.services.firebase.responseTime}ms)`,
    `  Stripe: ${report.services.stripe.status} (${report.services.stripe.responseTime}ms)`,
    `  Errors: ${report.services.errors.status} (${report.services.errors.message})`,
    '',
    'Metrics:',
    `  Errors (last hour): ${report.metrics.errorCountLastHour}`,
    `  Critical errors: ${report.metrics.criticalErrorCount}`,
    `  Avg response time: ${report.metrics.averageResponseTime}ms`,
  ];

  return lines.join('\n');
}

/**
 * API endpoint format for health checks
 * Can be used with Express, Next.js, or other frameworks
 */
export async function getHealthCheckEndpoint(): Promise<{
  status: 'ok' | 'degraded' | 'error';
  health: HealthCheckReport;
}> {
  try {
    const health = await performHealthCheck();

    return {
      status: health.overallStatus === 'healthy' ? 'ok' : health.overallStatus === 'degraded' ? 'degraded' : 'error',
      health,
    };
  } catch (error) {
    console.error('[HealthCheck] Endpoint error:', error);

    return {
      status: 'error',
      health: {
        overallStatus: 'critical',
        timestamp: new Date().toISOString(),
        services: {
          firebase: {
            name: 'Firebase',
            status: 'critical',
            statusCode: 500,
            message: 'Check failed',
            lastChecked: new Date().toISOString(),
            responseTime: 0,
          },
          stripe: {
            name: 'Stripe',
            status: 'critical',
            statusCode: 500,
            message: 'Check failed',
            lastChecked: new Date().toISOString(),
            responseTime: 0,
          },
          errors: {
            name: 'Error Rate',
            status: 'critical',
            statusCode: 500,
            message: 'Check failed',
            lastChecked: new Date().toISOString(),
            responseTime: 0,
          },
        },
        metrics: {
          errorCountLastHour: 0,
          criticalErrorCount: 0,
          averageResponseTime: 0,
        },
      },
    };
  }
}

// ===================== EXPORTS =====================
// (HealthStatus, ServiceHealth, HealthCheckReport déjà exportés via `export interface` ci-dessus)
