let Sentry = null;
let sentryInitialized = false;

try {
  Sentry = await import('@sentry/node');
} catch (e) {
  // optional dependency
}

export function initSentry() {
  if (process.env.SENTRY_DSN && Sentry && Sentry.init) {
    try {
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'development',
        tracesSampleRate: 0.1,
      });
      sentryInitialized = true;
      console.info('[sentry] Initialized with DSN:', process.env.SENTRY_DSN.substring(0, 20) + '...');
      return true;
    } catch (err) {
      console.error('[sentry] Initialization failed:', err.message);
      return false;
    }
  }
  sentryInitialized = false;
  return false;
}

export function captureException(err) {
  if (!err) return;
  if (Sentry && Sentry.captureException) {
    return Sentry.captureException(err);
  }
  console.error('[sentry-mock]', err?.message || err);
}

export function captureMessage(message, level = 'info') {
  if (Sentry && Sentry.captureMessage) {
    return Sentry.captureMessage(message, level);
  }
  console.log(`[sentry-mock:${level}]`, message);
}

export function isSentryConfigured() {
  return !!process.env.SENTRY_DSN;
}

export function isSentryInitialized() {
  return sentryInitialized;
}

export function getSentryStatus() {
  const configured = isSentryConfigured();
  const initialized = isSentryInitialized();
  return {
    configured,
    initialized,
    dsn: configured ? process.env.SENTRY_DSN.substring(0, 30) + '...' : null,
    environment: process.env.NODE_ENV || 'development',
    available: !!Sentry,
  };
}
