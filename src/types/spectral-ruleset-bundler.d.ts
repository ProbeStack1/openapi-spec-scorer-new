declare module '@stoplight/spectral-ruleset-bundler/with-loader' {
  export function bundleAndLoadRuleset(
    ruleset: string,
    options: { fs: unknown; fetch: unknown },
  ): unknown;
}
