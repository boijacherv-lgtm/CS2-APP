/* tslint:disable */
/* eslint-disable */
export function parseEvent(file: Uint8Array, event_name?: string | null, wanted_player_props?: any[] | null, wanted_other_props?: any[] | null): any;
export function parseEvents(file: Uint8Array, event_names?: any[] | null, wanted_player_props?: any[] | null, wanted_other_props?: any[] | null): any;
export function listGameEvents(fileBytes: Uint8Array): any;
export function listUpdatedFields(fileBytes: Uint8Array): any;
export function parseTicks(file: Uint8Array, wanted_props?: any[] | null, wanted_ticks?: Int32Array | null, wanted_players?: any[] | null, struct_of_arrays?: boolean | null): any;
/**
 * extra: lets you add new fields to grenades. Use list_updated_fields for a full list.
 * grenades: lets you disable non-projectile grenades. This can have a big difference on memory/speed.
 */
export function parseGrenades(file: Uint8Array, extra?: any[] | null, grenades?: boolean | null): any;
export function parseHeader(file: Uint8Array): any;
export function __stratboard_start(): void;
export function hasProjectiles(): boolean;
