/**
 * The PWA and SRI plugins (spec L828-L837, L862). K2 ships this pass-through stub so `vite.config.ts`
 * can freeze; S11a replaces the body with vite-plugin-pwa (`registerType: 'prompt'`) and vite-plugin-sri-gen.
 */
import type { ConfigEnv, PluginOption } from "vite";

export function studioPwa(_env: ConfigEnv): PluginOption[] {
  return [];
}
