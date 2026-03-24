// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    rules: {
      // TypeScript handles unused vars — disable the base rule, use TS-aware version
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Allow explicit any in test helpers and hardware codec shims
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow empty catch blocks in tests
      '@typescript-eslint/no-empty-function': 'off',
      // Allow require() in CJS usage examples (none in src, but tests may use it)
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // Test files use dynamic imports from dist/ with no type info — any is unavoidable
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
