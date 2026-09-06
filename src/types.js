/**
 * Type contracts (JSDoc only — no runtime effect).
 * Describes the shapes the whale exchanges with the host mux stream and its
 * own internal state. Editors (and optional `tsc --checkJs`) surface these.
 * Inline module: authored, not a line slice.
 */

/** Union of mux payload kinds the whale consumes. */
// @typedef {'session/jobs'|'session/subscribed'|'session/projection'|'session/event'|'approval/requested'|'question/requested'} MuxPayloadType

/** A single event carried inside a session/event frame. */
// @typedef {{type:string, seq?:number, time?:number, data?:Object}} EventFrame

/** One mux payload (frame) delivered on the whale's own socket. */
// @typedef {{type:MuxPayloadType, sessionId?:string, event?:EventFrame, key?:string, value?:any, jobs?:Array<JobView>, lastSeq?:number}} MuxFrame

/** A background job as seen in session/jobs frames. */
// @typedef {{status:string, label?:string, kind?:string, sessionId?:string, startedAt?:number, finishedAt?:number, detail?:string}} JobView

/** Per-session tracking record (main conversations and subagents). */
// @typedef {{label:string, title?:string, mode?:string, fetching?:boolean, _flush?:Array<{seq:number, fn:Function}>}} SessionInfo

/** One queued unread notification. snapshot may be null (start reports). */
// @typedef {{text:string, duration:number, sessionId?:string, at:number, turnTokens:number|null, sessionTokens:number|null, pressure:Object|null}} Report

/** Notification sound kinds. */
// @typedef {'done'|'attention'|'fail'} DingKind

/** Gear (daily decoration) definition. */
// @typedef {{id:string, name:string, at:number, emoji:string}} GearDef

/** Versioned localStorage payload (see utils/storage.js). */
// @typedef {{v:number, data:any}} VersionedStore

/** One task-history record (core/history.js, M3.1). kind → drawer icon:
 *  done ✓ / fail ✗ / max-tokens ⏹ / killed ⏹ (user-stopped) /
 *  approval yellow ? / question blue ?. endTime is the mux frame time the
 *  jump feature passes to __dshOpenSession for back-paging (falls back to
 *  `at` when absent on pre-M4 records). */
// @typedef {{title:string, sessionId:string, kind:'done'|'fail'|'max-tokens'|'killed'|'approval'|'question', at:number, endTime?:number, turnTokens:number|null}} HistoryEntry

/** User settings (core/config.js, M3.4), persisted as 'dsh-whale:config'.
 *  notifyOnStart defaults true — contract unchanged (plan C2). */
// @typedef {{notifyOnStart:boolean, toolStuckMs:number, recentFailWindowMs:number, volume:number}} WhaleConfig

/** A pending tool call tracked by the stuck watchdog (core/stuck.js, M3.3). */
// @typedef {{at:number, sessionId:string}} ToolSlot