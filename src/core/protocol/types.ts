/*
 * Author: Ali Parnan
 */

import { PACKET_TYPES } from "@/core/constants/packet-types";

// ---------------------------------------------------------------------------
// Capabilities (hello payload)
// ---------------------------------------------------------------------------

export type Capabilities = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Window metadata as sent by the server
// ---------------------------------------------------------------------------

export type WindowMetadata = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Draw options that accompany draw / eos packets
// ---------------------------------------------------------------------------

export type DrawOptions = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Encryption cipher capabilities exchanged during handshake
// ---------------------------------------------------------------------------

export interface CipherCaps {
  cipher?: string;
  mode?: string;
  iv?: Uint8Array | string;
  key_salt?: Uint8Array | string;
  key_size?: number;
  key_stretch?: string;
  key_stretch_iterations?: number;
  key_hash?: string;
}

// ---------------------------------------------------------------------------
// Notification icon tuple: [encoding, width, height, data]
// ---------------------------------------------------------------------------

export type NotificationIcon = [string, number, number, Uint8Array];

// ---------------------------------------------------------------------------
// Server → Client packets (received)
// ---------------------------------------------------------------------------

export type OpenPacket = [typeof PACKET_TYPES.open];
export type ClosePacket = [typeof PACKET_TYPES.close, string];
export type ErrorPacket = [typeof PACKET_TYPES.error, string, number];
export type DisconnectPacket = [typeof PACKET_TYPES.disconnect, string];

export type HelloPacket = [typeof PACKET_TYPES.hello, Capabilities];

export type ChallengePacket = [
  typeof PACKET_TYPES.challenge,
  Uint8Array,          // server_salt
  CipherCaps | null,   // cipher_out_caps (present when encryption is used)
  string,              // digest (e.g. "xor", "hmac+sha256", "keycloak:...")
  string,              // salt_digest (e.g. "xor")
  string,              // prompt (e.g. "password")
];

export type PingPacket = [
  typeof PACKET_TYPES.ping,
  number,          // echotime (monotonic ms)
  number?,         // server_time (system time, optional)
  string?,         // sid (optional)
];

export type PingEchoPacket = [
  typeof PACKET_TYPES.ping_echo,
  number,   // last_ping_echoed_time
  number,   // l1 (server load avg 1m × 1000)
  number,   // l2 (server load avg 5m × 1000)
  number,   // l3 (server load avg 15m × 1000)
  number,   // client_ping_latency
  string?,  // sid (optional)
];

export type StartupCompletePacket = [typeof PACKET_TYPES.startup_complete];

export type NewWindowPacket = [
  typeof PACKET_TYPES.new_window,
  number,            // wid
  number,            // x
  number,            // y
  number,            // width
  number,            // height
  WindowMetadata,    // metadata
  Record<string, unknown>?, // client_properties (optional)
];

export type NewOverrideRedirectPacket = [
  typeof PACKET_TYPES.new_override_redirect,
  number,            // wid
  number,            // x
  number,            // y
  number,            // width
  number,            // height
  WindowMetadata,    // metadata
  Record<string, unknown>?, // client_properties (optional)
];

export type NewTrayPacket = [
  typeof PACKET_TYPES.new_tray,
  number,            // wid
  unknown,           // unused
  unknown,           // unused
  WindowMetadata,    // metadata
];

export type LostWindowPacket = [typeof PACKET_TYPES.lost_window, number];
export type RaiseWindowPacket = [typeof PACKET_TYPES.raise_window, number];

export type WindowMetadataPacket = [
  typeof PACKET_TYPES.window_metadata,
  number,            // wid
  WindowMetadata,    // metadata
];

export type WindowResizedPacket = [
  typeof PACKET_TYPES.window_resized,
  number,  // wid
  number,  // width
  number,  // height
];

export type WindowMoveResizePacket = [
  typeof PACKET_TYPES.window_move_resize,
  number,  // wid
  number,  // x
  number,  // y
  number,  // width
  number,  // height
];

export type ConfigureOverrideRedirectPacket = [
  typeof PACKET_TYPES.configure_override_redirect,
  number,  // wid
  number,  // x
  number,  // y
  number,  // width
  number,  // height
];

export type WindowIconPacket = [
  typeof PACKET_TYPES.window_icon,
  number,       // wid
  number,       // width
  number,       // height
  string,       // encoding (e.g. "png")
  Uint8Array,   // img_data
];

export type DrawPacket = [
  typeof PACKET_TYPES.draw,
  number,       // wid
  number,       // x
  number,       // y
  number,       // width
  number,       // height
  string,       // coding (e.g. "png", "jpeg", "rgb24", "rgb32", "scroll", "h264", ...)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,          // img_data — Uint8Array | ArrayBuffer | ImageBitmap | VideoFrame | null
  number,       // packet_sequence
  number,       // rowstride
  DrawOptions,  // options
];

export type EosPacket = [typeof PACKET_TYPES.eos, number]; // wid

export type CursorPacket =
  | [typeof PACKET_TYPES.cursor] // empty cursor → reset
  | [
      typeof PACKET_TYPES.cursor,
      string,       // encoding (e.g. "png")
      unknown,      // unused
      unknown,      // unused
      number,       // width
      number,       // height
      number,       // xhot
      number,       // yhot
      unknown,      // unused
      Uint8Array,   // img_data
    ];

export type BellPacket = [
  typeof PACKET_TYPES.bell,
  unknown,  // unused
  unknown,  // unused
  number,   // percent (volume 0–100)
  number,   // pitch (Hz)
  number,   // duration (ms)
];

export type PointerPositionPacket = [
  typeof PACKET_TYPES.pointer_position,
  number,   // wid
  number,   // x (absolute)
  number,   // y (absolute)
  number?,  // delta_x (window-relative, optional)
  number?,  // delta_y (window-relative, optional)
];

export type InitiateMoveResizePacket = [
  typeof PACKET_TYPES.initiate_moveresize,
  number,  // wid
  number,  // x_root
  number,  // y_root
  number,  // direction (MOVERESIZE_* constant)
  number,  // button
  number,  // source_indication
];

export type DesktopSizePacket = [typeof PACKET_TYPES.desktop_size, ...unknown[]];

export type EncodingsPacket = [typeof PACKET_TYPES.encodings, Capabilities];

export type InfoResponsePacket = [
  typeof PACKET_TYPES.info_response,
  Record<string, unknown>,
];

export type SettingChangePacket = [
  typeof PACKET_TYPES.setting_change,
  string,   // setting name
  unknown,  // value
];

export type ControlPacket = [typeof PACKET_TYPES.control, string, ...unknown[]];

// --- Clipboard packets ---

export type ClipboardTokenPacket = [
  typeof PACKET_TYPES.clipboard_token,
  string,            // selection (e.g. "CLIPBOARD", "PRIMARY")
  string[],          // targets
  string | null,     // target
  string | null,     // dtype
  number | null,     // dformat
  string | null,     // wire_encoding
  Uint8Array | string | null, // wire_data
];

export type ClipboardRequestPacket = [
  typeof PACKET_TYPES.clipboard_request,
  number,  // request_id
  string,  // selection
];

export type SetClipboardEnabledPacket = [
  typeof PACKET_TYPES.set_clipboard_enabled,
  boolean, // clipboard_enabled
  string,  // reason
];

// --- Audio packets ---

export type SoundDataPacket = [
  typeof PACKET_TYPES.sound_data,
  string,                  // codec
  Uint8Array,              // buf
  Record<string, unknown>, // options
  Record<string, unknown>, // metadata
];

// --- File transfer packets ---

export type SendFilePacket = [
  typeof PACKET_TYPES.send_file,
  string,                  // basefilename
  string,                  // mimetype
  boolean,                 // printit
  unknown,                 // unused
  number,                  // filesize
  Uint8Array,              // data
  Record<string, unknown>, // options
  string,                  // send_id
];

export type SendFileChunkPacket = [
  typeof PACKET_TYPES.send_file_chunk,
  string,       // chunk_id
  number,       // chunk number
  Uint8Array,   // file_data
  boolean,      // has_more
];

export type AckFileChunkPacket = [
  typeof PACKET_TYPES.ack_file_chunk,
  string,   // chunk_id
  boolean,  // state (true = ok, false = cancel)
  string,   // error_message
  number,   // chunk number
];

// --- Notification packets ---

export type NotifyShowPacket = [
  typeof PACKET_TYPES.notify_show,
  unknown,               // unused
  number,                // nid
  unknown,               // unused
  number,                // replaces_nid
  unknown,               // unused
  string,                // summary
  string,                // body
  number,                // expire_timeout
  NotificationIcon | null, // icon
  string[],              // actions
  Record<string, unknown>, // hints
];

export type NotifyClosePacket = [typeof PACKET_TYPES.notify_close, number]; // nid

// --- Miscellaneous ---

export type OpenUrlPacket = [typeof PACKET_TYPES.open_url, string]; // url

// ---------------------------------------------------------------------------
// Union of all server→client packets (received by the client)
// ---------------------------------------------------------------------------

export type ServerPacket =
  | OpenPacket
  | ClosePacket
  | ErrorPacket
  | DisconnectPacket
  | HelloPacket
  | ChallengePacket
  | PingPacket
  | PingEchoPacket
  | StartupCompletePacket
  | NewWindowPacket
  | NewOverrideRedirectPacket
  | NewTrayPacket
  | LostWindowPacket
  | RaiseWindowPacket
  | WindowMetadataPacket
  | WindowResizedPacket
  | WindowMoveResizePacket
  | ConfigureOverrideRedirectPacket
  | WindowIconPacket
  | DrawPacket
  | EosPacket
  | CursorPacket
  | BellPacket
  | PointerPositionPacket
  | InitiateMoveResizePacket
  | DesktopSizePacket
  | EncodingsPacket
  | InfoResponsePacket
  | SettingChangePacket
  | ControlPacket
  | ClipboardTokenPacket
  | ClipboardRequestPacket
  | SetClipboardEnabledPacket
  | SoundDataPacket
  | SendFilePacket
  | SendFileChunkPacket
  | AckFileChunkPacket
  | NotifyShowPacket
  | NotifyClosePacket
  | OpenUrlPacket;

// ---------------------------------------------------------------------------
// Client → Server packets (sent by the client)
// ---------------------------------------------------------------------------

export type HelloOutPacket = [typeof PACKET_TYPES.hello, Capabilities];

export type PingOutPacket = [typeof PACKET_TYPES.ping, number]; // now_ms

export type PingEchoOutPacket = [
  typeof PACKET_TYPES.ping_echo,
  number,  // echotime
  number,  // l1
  number,  // l2
  number,  // l3
  number,  // client_ping_latency (always 0)
  string,  // sid
];

export type DamageSequencePacket = [
  typeof PACKET_TYPES.damage_sequence,
  number,  // packet_sequence
  number,  // wid
  number,  // width
  number,  // height
  number,  // decode_time
  string,  // message
];

export type FocusPacket = [typeof PACKET_TYPES.focus, number, unknown[]]; // wid, modifiers

export type KeyActionPacket = [
  typeof PACKET_TYPES.key_action,
  number,     // wid
  string,     // key_name
  boolean,    // pressed
  string[],   // modifiers
  number,     // keyval
  string,     // key_str
  number,     // keycode
  string,     // group
];

export type ButtonActionPacket = [
  typeof PACKET_TYPES.button_action,
  number,     // wid
  number,     // button
  boolean,    // pressed
  [number, number], // [x, y] (absolute pointer position)
  string[],   // modifiers
  unknown[],  // buttons
];

export type WheelMotionPacket = [
  typeof PACKET_TYPES.wheel_motion,
  number,     // wid
  number,     // button (4=up, 5=down, 6=left, 7=right)
  number,     // distance
  [number, number], // [x, y]
  string[],   // modifiers
  unknown[],  // buttons
];

export type PointerPositionOutPacket = [
  typeof PACKET_TYPES.pointer_position,
  number,     // wid
  [number, number], // [x, y]
  string[],   // modifiers
  unknown[],  // buttons
];

export type LayoutChangedPacket = [
  typeof PACKET_TYPES.layout_changed,
  string,  // layout
  string,  // variant
];

export type MapWindowPacket = [
  typeof PACKET_TYPES.map_window,
  number,     // wid
  number,     // x
  number,     // y
  number,     // width
  number,     // height
  Record<string, unknown>, // client_properties
];

export type ConfigureWindowPacket = [
  typeof PACKET_TYPES.configure_window,
  number,     // wid
  number,     // x
  number,     // y
  number,     // width
  number,     // height
  Record<string, unknown>, // client_properties
  number,     // resize_counter
  Record<string, unknown>, // state
  boolean,    // skip_recheck
];

export type CloseWindowPacket = [typeof PACKET_TYPES.close_window, number]; // wid

export type DesktopSizeOutPacket = [
  typeof PACKET_TYPES.desktop_size,
  number,    // width
  number,    // height
  unknown[], // screen_sizes
];

export type ConfigureDisplayPacket = [
  typeof PACKET_TYPES.configure_display,
  Record<string, unknown>, // display_caps
];

export type BufferRefreshPacket = [
  typeof PACKET_TYPES.buffer_refresh,
  number,    // wid
  number,    // unused (0)
  number,    // quality
  Record<string, unknown>, // options
  Record<string, unknown>, // client_properties
];

export type SoundControlPacket = [
  typeof PACKET_TYPES.sound_control,
  string,    // command (e.g. "start", "stop")
  string?,   // codec (optional, for "start")
];

export type ClipboardTokenOutPacket = [
  typeof PACKET_TYPES.clipboard_token,
  string,     // selection
  string[],   // targets
  string,     // target
  string,     // dtype
  number,     // dformat
  string,     // wire_encoding
  string,     // wire_data
  boolean,    // claim
  boolean,    // greedy
  boolean,    // synchronous
];

export type ClipboardContentsPacket = [
  typeof PACKET_TYPES.clipboard_contents,
  number,     // request_id
  string,     // selection
  string,     // datatype
  number,     // dformat
  string,     // encoding
  string | Uint8Array, // clipboard_buffer
];

export type ClipboardContentsNonePacket = [
  typeof PACKET_TYPES.clipboard_contents_none,
  number,  // request_id
  string,  // selection
];

export type ConnectionDataPacket = [
  typeof PACKET_TYPES.connection_data,
  Record<string, unknown>,
];

export type InfoRequestPacket = [
  typeof PACKET_TYPES.info_request,
  string[],  // uuid list
  unknown[], // categories
];

export type NotificationActionPacket = [
  typeof PACKET_TYPES.notification_action,
  number,  // nid
  string,  // action_key
];

export type NotificationClosePacket = [
  typeof PACKET_TYPES.notification_close,
  number,  // nid
  number,  // reason
  string,  // text
];

export type LoggingPacket = [
  typeof PACKET_TYPES.logging,
  number,     // level
  ...unknown[], // log arguments
];

export type SendFileOutPacket = [
  typeof PACKET_TYPES.send_file,
  string,       // basefilename
  string,       // mimetype
  boolean,      // printit
  number,       // filesize
  Uint8Array,   // data
  Record<string, unknown>, // options
];

export type SendFileChunkOutPacket = [
  typeof PACKET_TYPES.send_file_chunk,
  string,      // chunk_id
  number,      // chunk number
  Uint8Array,  // file_data
  boolean,     // has_more
];

export type SetClipboardEnabledOutPacket = [
  typeof PACKET_TYPES.set_clipboard_enabled,
  boolean, // enabled
];

export type WindowMoveResizeOutPacket = [
  typeof PACKET_TYPES.window_move_resize,
  number, // wid
  number, // x
  number, // y
  number, // width
  number, // height
];

export type UnmapWindowPacket = [typeof PACKET_TYPES.unmap_window, number]; // wid

export type SuspendPacket = [typeof PACKET_TYPES.suspend, boolean, ...unknown[]];
export type ResumePacket = [typeof PACKET_TYPES.resume, boolean, ...unknown[]];

// ---------------------------------------------------------------------------
// Union of all client→server packets (sent by the client)
// ---------------------------------------------------------------------------

export type ClientPacket =
  | HelloOutPacket
  | PingOutPacket
  | PingEchoOutPacket
  | DamageSequencePacket
  | FocusPacket
  | KeyActionPacket
  | ButtonActionPacket
  | WheelMotionPacket
  | PointerPositionOutPacket
  | LayoutChangedPacket
  | MapWindowPacket
  | ConfigureWindowPacket
  | CloseWindowPacket
  | DesktopSizeOutPacket
  | ConfigureDisplayPacket
  | BufferRefreshPacket
  | SoundControlPacket
  | ClipboardTokenOutPacket
  | ClipboardContentsPacket
  | ClipboardContentsNonePacket
  | ConnectionDataPacket
  | InfoRequestPacket
  | NotificationActionPacket
  | NotificationClosePacket
  | LoggingPacket
  | SendFileOutPacket
  | SendFileChunkOutPacket
  | SetClipboardEnabledOutPacket
  | WindowMoveResizeOutPacket
  | UnmapWindowPacket
  | SuspendPacket
  | ResumePacket
  | SettingChangePacket;

// ---------------------------------------------------------------------------
// Generic packet — either direction
// ---------------------------------------------------------------------------

export type XpraPacket = ServerPacket | ClientPacket;

// ---------------------------------------------------------------------------
// Packet handler callback signature
// ---------------------------------------------------------------------------

export type PacketHandler = (packet: ServerPacket) => void;

// ---------------------------------------------------------------------------
// Packet type → typed packet mapping (for handler registration)
// ---------------------------------------------------------------------------

export interface ServerPacketMap {
  [PACKET_TYPES.open]: OpenPacket;
  [PACKET_TYPES.close]: ClosePacket;
  [PACKET_TYPES.error]: ErrorPacket;
  [PACKET_TYPES.disconnect]: DisconnectPacket;
  [PACKET_TYPES.hello]: HelloPacket;
  [PACKET_TYPES.challenge]: ChallengePacket;
  [PACKET_TYPES.ping]: PingPacket;
  [PACKET_TYPES.ping_echo]: PingEchoPacket;
  [PACKET_TYPES.startup_complete]: StartupCompletePacket;
  [PACKET_TYPES.new_window]: NewWindowPacket;
  [PACKET_TYPES.new_override_redirect]: NewOverrideRedirectPacket;
  [PACKET_TYPES.new_tray]: NewTrayPacket;
  [PACKET_TYPES.lost_window]: LostWindowPacket;
  [PACKET_TYPES.raise_window]: RaiseWindowPacket;
  [PACKET_TYPES.window_metadata]: WindowMetadataPacket;
  [PACKET_TYPES.window_resized]: WindowResizedPacket;
  [PACKET_TYPES.window_move_resize]: WindowMoveResizePacket;
  [PACKET_TYPES.configure_override_redirect]: ConfigureOverrideRedirectPacket;
  [PACKET_TYPES.window_icon]: WindowIconPacket;
  [PACKET_TYPES.draw]: DrawPacket;
  [PACKET_TYPES.eos]: EosPacket;
  [PACKET_TYPES.cursor]: CursorPacket;
  [PACKET_TYPES.bell]: BellPacket;
  [PACKET_TYPES.pointer_position]: PointerPositionPacket;
  [PACKET_TYPES.initiate_moveresize]: InitiateMoveResizePacket;
  [PACKET_TYPES.desktop_size]: DesktopSizePacket;
  [PACKET_TYPES.encodings]: EncodingsPacket;
  [PACKET_TYPES.info_response]: InfoResponsePacket;
  [PACKET_TYPES.setting_change]: SettingChangePacket;
  [PACKET_TYPES.control]: ControlPacket;
  [PACKET_TYPES.clipboard_token]: ClipboardTokenPacket;
  [PACKET_TYPES.clipboard_request]: ClipboardRequestPacket;
  [PACKET_TYPES.set_clipboard_enabled]: SetClipboardEnabledPacket;
  [PACKET_TYPES.sound_data]: SoundDataPacket;
  [PACKET_TYPES.send_file]: SendFilePacket;
  [PACKET_TYPES.send_file_chunk]: SendFileChunkPacket;
  [PACKET_TYPES.ack_file_chunk]: AckFileChunkPacket;
  [PACKET_TYPES.notify_show]: NotifyShowPacket;
  [PACKET_TYPES.notify_close]: NotifyClosePacket;
  [PACKET_TYPES.open_url]: OpenUrlPacket;
}

// ---------------------------------------------------------------------------
// Wire protocol header constants
// ---------------------------------------------------------------------------

export const HEADER_SIZE = 8;
export const HEADER_MAGIC = 0x50; // ASCII 'P'

export const enum ProtoFlags {
  RENCODE_LEGACY = 0x01,
  ENCRYPTED      = 0x02,
  UNUSED         = 0x08,
  RENCODEPLUS    = 0x10,
}

export const enum CompressionLevel {
  NONE   = 0x00,
  LZ4    = 0x10,
  LZO    = 0x20,
  BROTLI = 0x40,
}
