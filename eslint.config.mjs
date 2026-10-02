import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'app',
    react: true,
    formatters: true,
    ignores: ['.expo/**', '.temp/**', 'android/**', 'ios/**', 'dist/**', 'src/uniwind-types.d.ts', 'bun.lock'],
    rules: {
      'ts/no-require-imports': 'off',
      'node/prefer-global/process': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.name=/^(useCallback|useMemo)$/]',
          message: 'React Compiler handles memoization.',
        },
      ],
    },
  },
)
