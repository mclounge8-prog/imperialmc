module.exports = {
  preset: '@react-native/jest-preset',
  // @react-navigation and several native modules ship ESM in node_modules,
  // which Jest can't parse unless it's allowed through the default
  // transformIgnorePatterns (which otherwise skips all of node_modules).
  transformIgnorePatterns: [
    'node_modules/(?!(' +
      [
        '@react-native',
        'react-native',
        '@react-navigation',
        '@react-native-async-storage/async-storage',
        '@d11/react-native-fast-image',
        'react-native-linear-gradient',
        'react-native-safe-area-context',
        'react-native-screens',
      ].join('|') +
      ')/)',
  ],
};
