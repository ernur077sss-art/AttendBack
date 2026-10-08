import type { NextConfig } from 'next';
import path from 'node:path';
const config: NextConfig = {
  outputFileTracingRoot: path.resolve(__dirname, '../..'),
  turbopack: { root: path.resolve(__dirname, '../..') },
  devIndicators: false,
};
export default config;
