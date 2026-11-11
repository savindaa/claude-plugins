export type Pressure = { used: number; limit: number; percent: number; isCompactPoint: boolean }

declare module 'claude-code' {
  interface PluginState {
    statusline: { pressure: Pressure | null; agentCost: number }
  }
}
