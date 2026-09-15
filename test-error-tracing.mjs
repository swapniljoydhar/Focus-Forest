import assert from 'node:assert/strict';
import { wrapWithErrorBoundary } from './shared/error-tracing.js';

let unhandled = null;
const onUnhandled = (reason) => { unhandled = reason; };
process.on('unhandledRejection', onUnhandled);

const eventHandler = wrapWithErrorBoundary(async () => { throw new Error('event-boundary-failure'); }, { function: 'event-handler', swallow: true });
eventHandler({ type: 'click' });
await new Promise((resolve) => setTimeout(resolve, 25));
assert.equal(unhandled, null, 'swallow mode must prevent unhandled event-handler rejections');

const recoveryHandler = wrapWithErrorBoundary(async () => { throw new Error('recovery-failure'); }, { function: 'recovery-handler', rethrow: true });
await assert.rejects(recoveryHandler(), /recovery-failure/, 'rethrow mode must preserve explicit recovery .catch() behavior');
const defaultRecoveryHandler = wrapWithErrorBoundary(async () => { throw new Error('default-recovery-failure'); }, { function: 'default-recovery-handler' });
await assert.rejects(defaultRecoveryHandler(), /default-recovery-failure/, 'default mode must preserve recovery rethrow behavior');

process.removeListener('unhandledRejection', onUnhandled);
console.log('error-tracing contracts passed');
