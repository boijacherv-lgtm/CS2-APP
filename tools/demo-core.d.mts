import type { DemoData } from '../src/engine/recap';
export interface DemoParser {
  parseHeader(input: unknown): unknown;
  parseEvent(input: unknown, name: string, playerProps?: string[], otherProps?: string[]): unknown;
  parseEvents(input: unknown, names: string[], playerProps?: string[], otherProps?: string[]): unknown;
  parseTicks(input: unknown, props: string[], ticks?: number[]): unknown;
  parseGrenades(input: unknown): unknown;
}
export function buildDemoData(parser: DemoParser, input: unknown, progress?: (pass: number) => void): DemoData;
