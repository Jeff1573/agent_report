/*
 * 仓库级 ESLint 配置：通过 overrides 仅作用于 desktop 子包。
 * 说明：为避免影响其它工作区，仅匹配 desktop/** 下的源码文件。
 */
require('@rushstack/eslint-patch/modern-module-resolution')

module.exports = {
  root: true,
  ignorePatterns: ['node_modules/**', 'dist/**', 'out/**', 'desktop/dist/**', 'desktop/out/**', '**/dist/**', '**/out/**'],
  overrides: [
    {
      files: ['desktop/**/*.{js,jsx,ts,tsx,cjs,mjs,cts,mts}'],
      parser: '@typescript-eslint/parser',
      extends: [
        'eslint:recommended',
        '@electron-toolkit',
        '@electron-toolkit/eslint-config-ts/eslint-recommended',
        'plugin:react/recommended',
        'plugin:react-hooks/recommended'
      ],
      settings: {
        react: { version: 'detect' }
      },
      plugins: ['@typescript-eslint', 'react', 'react-hooks'],
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      },
      rules: {
        'react/react-in-jsx-scope': 'off',
        '@typescript-eslint/no-unused-vars': [
          'warn',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            caughtErrorsIgnorePattern: '^_'
          }
        ]
      }
    },
    {
      files: ['desktop/**/*.d.ts'],
      rules: {
        'no-unused-vars': 'off'
      }
    }
  ]
}
