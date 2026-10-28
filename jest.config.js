module.exports = {
  preset: 'jest-expo',
  setupFiles: ['react-native-gesture-handler/jestSetup'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testMatch: ['**/tests/**/*.test.ts', '**/tests/**/*.test.tsx'],
  collectCoverageFrom: ['src/domain/**/*.ts', 'src/parser/**/*.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/private-fixtures/', '<rootDir>/tmp/'],
};
