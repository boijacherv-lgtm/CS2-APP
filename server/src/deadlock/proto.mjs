// The few Deadlock game coordinator messages the bot uses, copied (field numbers and all) from SteamDatabase's
// Protobufs (deadlock/citadel_gcmessages_client.proto and gcsdk_gcmessages.proto):
// https://github.com/SteamDatabase/Protobufs/tree/master/deadlock
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const protobuf = require('protobufjs');

export const APP_ID = 1422450;
/** Message ids: the GC's hello / welcome (EGCBaseClientMsg) and the Citadel client messages. */
export const MSG = {
  ClientWelcome: 4004,
  ClientHello: 4006,
  GetMatchHistory: 9112,
  GetMatchHistoryResponse: 9113,
  GetMatchMetaData: 9167,
  GetMatchMetaDataResponse: 9168,
};

const root = protobuf.parse(`
syntax = "proto2";
message CMsgClientHello {
  optional uint32 version = 1;
}
message CMsgClientToGCGetMatchHistory {
  optional uint32 account_id = 1;
  optional uint64 continue_cursor = 2;
}
message CMsgClientToGCGetMatchHistoryResponse {
  message Match {
    optional uint64 match_id = 1;
    optional uint32 hero_id = 2;
    optional uint32 match_duration_s = 3;
    optional uint32 start_time = 4;
    optional uint32 match_result = 5;
    optional uint32 player_team = 6;
    optional uint32 player_kills = 7;
    optional uint32 player_deaths = 8;
    optional uint32 player_assists = 9;
    optional uint32 last_hits = 11;
    optional uint32 denies = 12;
    optional uint32 hero_level = 13;
    optional uint32 net_worth = 14;
    optional uint32 match_mode = 19;
    optional uint32 game_mode = 20;
  }
  optional uint32 result = 1;
  optional uint64 continue_cursor = 2;
  repeated Match matches = 3;
}
message CMsgClientToGCGetMatchMetaData {
  optional uint64 match_id = 1;
  optional uint32 metadata_salt = 3;
  optional uint32 target_account_id = 4;
}
message CMsgClientToGCGetMatchMetaDataResponse {
  optional uint32 result = 1;
  optional uint32 replay_salt = 2;
  optional uint32 metadata_salt = 3;
  optional uint32 replay_valid_through = 4;
  optional uint32 replay_group_id = 5;
  optional uint32 replay_processing_through = 6;
}
`, { keepCase: true }).root;

export const T = {
  Hello: root.lookupType('CMsgClientHello'),
  History: root.lookupType('CMsgClientToGCGetMatchHistory'),
  HistoryResponse: root.lookupType('CMsgClientToGCGetMatchHistoryResponse'),
  MetaData: root.lookupType('CMsgClientToGCGetMatchMetaData'),
  MetaDataResponse: root.lookupType('CMsgClientToGCGetMatchMetaDataResponse'),
};
/** Result codes both responses share (EResult in each). */
export const RESULT = { 0: 'InternalError', 1: 'Success', 2: 'InvalidPermission', 3: 'TemporarilyDisabled', 4: 'TooBusy', 5: 'RateLimited', 6: 'InvalidMatch', 7: 'MatchInFlight', 8: 'Timeout' };

export const encode = (type, obj) => Buffer.from(type.encode(type.fromObject(obj)).finish());
export const decode = (type, buf) => type.toObject(type.decode(buf), { longs: String, defaults: true });
