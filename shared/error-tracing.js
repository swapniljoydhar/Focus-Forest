import './chromium-api.js';

export const ERROR_CATEGORIES = {
  STORAGE: 'storage',
  MESSAGING: 'messaging',
  NAVIGATION: 'navigation',
  STATE_MUTATION: 'state_mutation',
  CONTENT_SCRIPT: 'content_script',
  UI_RENDER: 'ui_render',
  PERMISSION: 'permission',
  VALIDATION: 'validation',
  UNKNOWN: 'unknown'
};

export const ERROR_SEVERITY = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFO: 'info'
};

class ErrorTrace {
  constructor(error, context = {}) {
    this.id = `err_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.timestamp = Date.now();
    this.message = error?.message || String(error);
    this.stack = error?.stack || this.captureStack();
    this.category = context.category || ERROR_CATEGORIES.UNKNOWN;
    this.severity = context.severity || ERROR_SEVERITY.MEDIUM;
    this.context = {
      url: context.url || (typeof location !== 'undefined' ? location.href : 'background'),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'service-worker',
      extensionVersion: (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.version) || 'unknown',
      ...context
    };
    this.rootCause = null;
    this.suggestedFix = null;
  }

  captureStack() {
    try {
      throw new Error();
    } catch (e) {
      return e.stack;
    }
  }

  diagnoseRootCause() {
    const { message, stack, category } = this;
    const lowerMsg = message.toLowerCase();

    const patterns = [
      { pattern: /cannot read propert(y|ies) of (null|undefined)/i, cause: 'Null/undefined reference', fix: 'Add null checks before property access' },
      { pattern: /cannot set propert(y|ies) of (null|undefined)/i, cause: 'Assignment to null/undefined', fix: 'Ensure target object exists before assignment' },
      { pattern: /is not a function/i, cause: 'Function expected but not provided', fix: 'Verify callback/function reference is valid' },
      { pattern: /failed to execute 'sendmessage'/i, cause: 'Message port closed or invalid', fix: 'Check message channel validity; handle runtime.lastError' },
      { pattern: /receiving end does not exist/i, cause: 'No listener for message', fix: 'Ensure message listener registered before sending' },
      { pattern: /quota exceeded/i, cause: 'Storage quota exceeded', fix: 'Implement storage cleanup; check LIMITS constants' },
      { pattern: /storage.*not available/i, cause: 'Storage API unavailable', fix: 'Wrap in try-catch; provide fallback' },
      { pattern: /permission denied/i, cause: 'Missing or revoked permission', fix: 'Check manifest permissions; handle gracefully' },
      { pattern: /cannot access '.*' before initialization/i, cause: 'Temporal dead zone', fix: 'Reorder imports/initialization' },
      { pattern: /maximum call stack size exceeded/i, cause: 'Infinite recursion', fix: 'Add recursion guard; check mutation queue' },
      { pattern: /promise rejected.*no handler/i, cause: 'Unhandled promise rejection', fix: 'Add .catch() to all promises' },
      { pattern: /invalid (id|url|session|node)/i, cause: 'Invalid identifier passed', fix: 'Validate with safeId()/safeHttpUrl() before use' },
      { pattern: /chrome\.runtime\.lasterror/i, cause: 'Chrome API error', fix: 'Check chrome.runtime.lastError after API calls' },
      { pattern: /mutation.*failed|saveState.*failed/i, cause: 'State mutation error', fix: 'Check mutate() queue; verify state schema' },
      { pattern: /webnavigation.*not.*found/i, cause: 'webNavigation API unavailable', fix: 'Check manifest permission; feature-detect API' },
      { pattern: /shadow.*root|attachshadow/i, cause: 'Shadow DOM error', fix: 'Verify shadow root creation; check closed mode' },
      { pattern: /svg.*namespace|createns/i, cause: 'SVG namespace error', fix: 'Use document.createElementNS with SVG_NS' },
    ];

    for (const { pattern, cause, fix } of patterns) {
      if (pattern.test(message) || (stack && pattern.test(stack))) {
        this.rootCause = cause;
        this.suggestedFix = fix;
        return { cause, fix };
      }
    }

    if (category === ERROR_CATEGORIES.STORAGE) {
      this.rootCause = 'Storage operation failed';
      this.suggestedFix = 'Check chrome.storage.local availability; verify quota; wrap in try-catch';
    } else if (category === ERROR_CATEGORIES.MESSAGING) {
      this.rootCause = 'Message passing failure';
      this.suggestedFix = 'Verify sender/receiver context; check message schema with validateMessage()';
    } else if (category === ERROR_CATEGORIES.STATE_MUTATION) {
      this.rootCause = 'State mutation error in mutate() queue';
      this.suggestedFix = 'Check mutation queue; ensure NO_CHANGE handling; verify state schema';
    }

    return { cause: this.rootCause || 'Unknown root cause', fix: this.suggestedFix || 'Investigate stack trace' };
  }

  toJSON() {
    return {
      id: this.id,
      timestamp: this.timestamp,
      message: this.message,
      stack: this.stack,
      category: this.category,
      severity: this.severity,
      context: this.context,
      rootCause: this.rootCause,
      suggestedFix: this.suggestedFix
    };
  }

  toLogString() {
    const lines = [
      `=== ERROR TRACE ${this.id} ===`,
      `Time: ${new Date(this.timestamp).toISOString()}`,
      `Category: ${this.category} | Severity: ${this.severity}`,
      `Message: ${this.message}`,
      `Context: ${JSON.stringify(this.context, null, 2)}`,
      `Root Cause: ${this.rootCause || 'Not diagnosed'}`,
      `Suggested Fix: ${this.suggestedFix || 'N/A'}`,
      `Stack:`,
      this.stack,
      `=== END ERROR TRACE ===`
    ];
    return lines.join('\n');
  }
}

const errorLog = [];
const MAX_LOG_SIZE = 100;
const MAX_LOG_AGE_MS = 5 * 60 * 1000; // 5 minutes - prevents unbounded growth in long-running sessions

export function logError(error, context = {}) {
  const trace = new ErrorTrace(error, context);
  trace.diagnoseRootCause();
  
  errorLog.push(trace);
  
  // Evict old entries first by time, then by size if still over limit
  const now = Date.now();
  const cutoff = now - MAX_LOG_AGE_MS;
  while (errorLog.length > 0 && errorLog[0].timestamp < cutoff) {
    errorLog.shift();
  }
  while (errorLog.length > MAX_LOG_SIZE) {
    errorLog.shift();
  }

  console.error(trace.toLogString());

  return trace;
}

export function logCritical(error, context = {}) {
  return logError(error, { ...context, severity: ERROR_SEVERITY.CRITICAL });
}

export function logWarning(error, context = {}) {
  return logError(error, { ...context, severity: ERROR_SEVERITY.LOW });
}

export function wrapWithErrorBoundary(fn, context = {}) {
  const shouldRethrow = context.rethrow !== false && !context.swallow;
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      logError(error, { ...context, category: context.category || ERROR_CATEGORIES.UNKNOWN });
      if (shouldRethrow) throw error;
      return undefined;
    }
  };
}

export function wrapMutationWithErrorBoundary(mutator, context = {}) {
  return async (state) => {
    try {
      return await mutator(state);
    } catch (error) {
      logError(error, { 
        ...context, 
        category: ERROR_CATEGORIES.STATE_MUTATION,
        stateKeys: state ? Object.keys(state) : 'no-state'
      });
      throw error;
    }
  };
}


