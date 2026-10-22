import type { NextConfig } from 'next';

const config: NextConfig = {
  // Los paquetes internos se publican como código fuente TS.
  transpilePackages: ['@pv/core'],
};

export default config;
