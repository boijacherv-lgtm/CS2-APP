// The part of deadem (the Deadlock replay parser) that localDemo.ts uses: it ships no types of its own.
declare module 'deadem' {
  export interface Entity { index: number; class: { name: string }; getField(name: string): unknown }
  export interface EntityMutationEvent { operation: { code: string }; entity: Entity; getChanges(names: string[]): unknown[] }
  export interface DemoPacket { tick: number }
  export interface MessagePacket { type: unknown; data: Record<string, unknown> }
  export interface Demo { getEntity(index: number): Entity | null; getEntitiesByClassName(name: string): Entity[] }
  export class ParserConfiguration { constructor(o: { entityClasses?: string[]; messagePacketTypes?: unknown[]; breakInterval?: number }) }
  export const Logger: { NOOP: unknown; CONSOLE_WARN: unknown };
  export const InterceptorStage: { DEMO_PACKET: unknown; MESSAGE_PACKET: unknown; ENTITY_PACKET: unknown };
  export const MessagePacketType: Record<string, unknown>;
  export class Parser {
    constructor(config?: ParserConfiguration, logger?: unknown);
    registerPreInterceptor(stage: unknown, cb: (...a: never[]) => void): void;
    registerPostInterceptor(stage: unknown, cb: (...a: never[]) => void): void;
    getDemo(): Demo;
    parse(reader: unknown): Promise<void>;
    dispose(): Promise<void>;
  }
}
