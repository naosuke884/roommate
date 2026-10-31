export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'subject-no-trailing-period': ({ subject }) => [
          !/[.。]$/.test(subject ?? ''),
          'subject may not end with "." or "。"',
        ],
      },
    },
  ],
  rules: {
    // 要約は日本語で書くので、大文字小文字の規則は使わない
    'subject-case': [0],
    'subject-full-stop': [0],
    'subject-no-trailing-period': [2, 'always'],
    'scope-case': [2, 'always', 'kebab-case'],
    'header-max-length': [2, 'always', 72],
    'body-leading-blank': [2, 'always'],
    'footer-leading-blank': [2, 'always'],
  },
};
