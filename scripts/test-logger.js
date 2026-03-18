/**
 * Test script for logger utility
 * Validates isDev pattern and log level behavior
 */

const log = require('../backend/utils/logger');

console.log('=== Logger Test ===\n');

console.log('Current NODE_ENV:', process.env.NODE_ENV || 'undefined');
console.log('isDev should be:', process.env.NODE_ENV !== 'production', '\n');

console.log('Testing log levels:\n');

// These should only appear in development
log.debug('This is a DEBUG message (dev only)');
log.info('This is an INFO message (dev only)');

// These should always appear
log.warn('This is a WARN message (always shown)');
log.error('This is an ERROR message (always shown)');

console.log('\n--- Testing emoji removal ---');
log.info('✅ Success with emoji');
log.warn('⚠️  Warning with emoji');
log.error('❌ Error with emoji');

console.log('\n--- Testing object logging ---');
log.debug('Object:', { foo: 'bar', baz: 123 });
log.info('Multiple args:', 'string', 42, { nested: true });

console.log('\n=== Test Complete ===');
console.log('Expected behavior:');
console.log('- In development: DEBUG and INFO should show');
console.log('- In production: Only WARN and ERROR should show');
console.log('- All emojis should be removed from output');
