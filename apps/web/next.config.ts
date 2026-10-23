import type { NextConfig } from 'next';

const config: NextConfig = {
  // Los paquetes internos se publican como código fuente TS.
  transpilePackages: ['@pv/core'],
  // @pv/core importa con extensión .js (ESM de Node) archivos que son .ts. Turbopack no lo
  // resuelve todavía; por eso dev y build usan webpack (--webpack) con este alias.
  webpack: (webpackConfig: { resolve: { extensionAlias?: Record<string, string[]> } }) => {
    webpackConfig.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return webpackConfig;
  },
};

export default config;
