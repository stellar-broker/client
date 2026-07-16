import terser from '@rollup/plugin-terser'

export default {
    input: 'src/bundle.js',
    output: {
        file: 'lib/stellarbroker.js',
        format: 'umd',
        name: 'stellarbroker',
        exports: 'default',
        sourcemap: true
    },
    external: ['@stellar/stellar-sdk'],
    plugins: [terser()]
}
