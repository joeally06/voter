/**
 * Jest Configuration for Voter Outreach Platform
 * Testing framework configuration for unit and integration tests
 */

module.exports = {
    // Test environment
    testEnvironment: 'node',

    // Test file patterns
    testMatch: [
        '**/tests/**/*.test.js',
        '**/__tests__/**/*.js'
    ],

    // Coverage collection
    collectCoverageFrom: [
        'backend/**/*.js',
        '!backend/server.js', // Exclude server entry point
        '!backend/config/**', // Exclude config (external dependency)
        '!**/node_modules/**'
    ],

    // Coverage thresholds (80% minimum target)
    coverageThreshold: {
        global: {
            branches: 70,
            functions: 75,
            lines: 80,
            statements: 80
        }
    },

    // Coverage reporters
    coverageReporters: [
        'text',
        'text-summary',
        'html',
        'lcov'
    ],

    // Test timeout (increased for integration tests)
    testTimeout: 30000,

    // Setup files
    setupFiles: [],

    // Clear mocks between tests
    clearMocks: true,
    resetMocks: true,
    restoreMocks: true,

    // Verbose output
    verbose: true,

    // Force exit after test completion
    forceExit: true,

    // Detect open handles (helpful for debugging)
    detectOpenHandles: false,

    // Max workers (parallel test execution)
    maxWorkers: '50%'
};
