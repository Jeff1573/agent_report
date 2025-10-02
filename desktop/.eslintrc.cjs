/* eslint-env node */
require('@rushstack/eslint-patch/modern-module-resolution')

module.exports = {
  extends: [
    '@electron-toolkit/eslint-config-ts',
    '@electron-toolkit/eslint-config'
  ],
  rules: {
    // 允许 unknown 类型在 JSX 中使用
    '@typescript-eslint/no-unsafe-assignment': 'off',
    '@typescript-eslint/no-unsafe-member-access': 'off',
    '@typescript-eslint/no-unsafe-call': 'off',
    '@typescript-eslint/no-unsafe-return': 'off',
    '@typescript-eslint/no-unsafe-argument': 'off',
    
    // 允许函数缺少返回类型
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    
    // 允许 any 类型
    '@typescript-eslint/no-explicit-any': 'warn',
    
    // 允许未使用的变量（以 _ 开头）
    '@typescript-eslint/no-unused-vars': ['error', { 
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_'
    }]
  }
}

