import React, { useState, useLayoutEffect, useEffect, useRef, useMemo } from "react";
import {
  fetchTournamentSettings, draftRoundCount, generateSnakeDraft, fetchLobby,
  fetchFinalMatchups, subscribeFinalMatchups, enterFinalMatchups, rollTournamentMatchupsPool,
  lockTournamentMatchup, resetTournamentMatchups, endTournament, toFinalMatchupTeam,
  createManualMatchup, removeTournamentMatchup, syncDraftState, fetchDraftState, fetchDraftHistory,
  removeTempParticipants, consumeDraftStartRequest,
} from "../lib/tournamentApi.js";
import ConfirmDialog from "./ConfirmDialog.jsx";
import AppShell from "./AppShell.jsx";

/* ════════════════════════════════════════════════════════════════════════
   CONSTANTS & THEME (unchanged from Dashboard.jsx)
   ════════════════════════════════════════════════════════════════════════ */
const TEAL = "#22E5FF";
// Light Mode fix, by explicit request: this used to be a literal
// hardcoded dark-navy hex (#2B3159 -- a close, un-tokenized match for
// dark mode's --color-panel-line) used as the "subtle, non-highlighted"
// border on Avatar and filled team-slot rows. It never adapted to
// theme, so it stayed a dark line in light mode too. Now built from
// --color-panel-line at 0.35 opacity -- the same token + opacity the
// unified Tournament Lobby/Admin Dashboard divider system uses (see
// their table row borders) -- so both call sites below are
// theme-following and match that softened, subtle look. Name kept as
// PANEL_LINE_DIM (renamed from TEAL_DIM) since it's no longer teal.
const PANEL_LINE_DIM = "rgb(var(--color-panel-line) / 0.35)";
const TEAL_SOFT = "#8FEEFF";
const ACCENT = "#7C5CFF";
const VIOLET = "#7C5CFF";

const POSITIONS = [
  { id: 1, label: "1号位", name: "Carry" },
  { id: 2, label: "2号位", name: "Mid" },
  { id: 3, label: "3号位", name: "Offlane" },
  { id: 4, label: "4号位", name: "Soft Support" },
  { id: 5, label: "5号位", name: "Hard Support" },
];

const TEAM_CARD_W = 190;
// Fixed height for the captain slot row (34px avatar/icon + 6px top/bottom
// padding = the row's natural height when a captain is assigned). Applied
// explicitly to the row in every state (empty / assignable-prompt /
// assigned) so the Team panel never grows or shifts depending on content --
// the row always reserves exactly this much space, from first paint.
const CAPTAIN_SLOT_H = 46;
// Fixed height for the top bar/header PanelFrame (button row + progress-bar
// row + the panel's own p-4 padding). Sized generously for the tallest
// realistic content across every phase (the teammate-phase round-label
// line, a 2-line subtitle wrap, etc.) so the header never needs to grow or
// shrink for any state the draft actually produces -- applied explicitly
// so its size is fixed from first paint, not derived from content.
const HEADER_H = 160;

const DEFAULT_AVATAR_ID = 0;
const DEFAULT_AVATAR = {
  id: 0, label: "Hex", color: "#22E5FF",
  render: (size, color) => (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <path d="M20 4 L34 12 L34 28 L20 36 L6 28 L6 12 Z" stroke={color} strokeWidth="2" fill={`${color}20`}/>
      <circle cx="20" cy="20" r="6" fill={color} fillOpacity="0.7"/>
    </svg>
  ),
};

function initialTournament(roundOrders) {
  return {
    teams: [],
    pickIndex: 0,
    pool: null,
    lastPick: null,
    draftPhase: "captain",
    captainCandidates: [],
    // Comes from Tournament Settings (锦标赛设置) in the Tournament Lobby --
    // teamCount teams per round, draftRoundCount(playersPerTeam) rounds.
    // See seedTournament() / DraftArenaPage below for where this is built.
    roundOrders: Array.isArray(roundOrders) ? roundOrders : [],
    roundOrdersLocked: false,
    round1: { matches: null },
    wb: { pool: null, matches: null, champion: null },
    lb: { pool: null, matches: null, finalists: null },
  };
}

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ════════════════════════════════════════════════════════════════════════
   DRAFT / TOURNAMENT HELPERS
   ════════════════════════════════════════════════════════════════════════ */
function parseRoundOrder(str, teamCount) {
  const cleaned = (str || "").replace(/\s/g, "");
  const tokens = cleaned.includes(",") ? cleaned.split(",").map((s) => parseInt(s, 10) - 1) : cleaned.split("").map((ch) => parseInt(ch, 10) - 1);
  return tokens.filter((n) => !isNaN(n) && n >= 0 && n < teamCount);
}

function computeDraftMeta(t, teamCount) {
  const roundOrderValid = t.roundOrders.map((str) => { const p = parseRoundOrder(str, teamCount); return p.length === teamCount && new Set(p).size === teamCount; });
  const customSnakeOrder = t.roundOrders.flatMap((str, ri) => parseRoundOrder(str, teamCount).map((teamIdx) => ({ round: ri + 1, teamIdx })));
  const allCaptainsAssigned = t.teams.length === teamCount && t.teams.every((tm) => tm.captain !== null);
  const draftFinished = t.draftPhase === "teammate" && t.pickIndex >= customSnakeOrder.length;
  const currentPick = t.draftPhase === "teammate" && !draftFinished ? customSnakeOrder[t.pickIndex] : null;
  const activeTeamIdx = currentPick ? currentPick.teamIdx : -1;
  const roundLabel = currentPick ? currentPick.round : t.roundOrders.length;
  return { roundOrderValid, customSnakeOrder, allCaptainsAssigned, draftFinished, currentPick, activeTeamIdx, roundLabel };
}

/* ════════════════════════════════════════════════════════════════════════
   PRESENTATIONAL PRIMITIVES (unchanged visual language)
   ════════════════════════════════════════════════════════════════════════ */
function CaptainBadge() {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-[#00A2E8] text-black">
      队长
    </span>
  );
}

function Avatar({ avatarId = DEFAULT_AVATAR_ID, avatarUrl = null, size = 36, glow = false, glowColor = TEAL }) {
  const fallbackColor = DEFAULT_AVATAR.color;
  // Border-radius is proportional to size (not a fixed px value) so it
  // scales correctly for every avatar size this component is used at.
  // The ratio below is exactly the Captain avatar's existing 10px-at-34px
  // proportion (10/34), so size=34 still renders at precisely 10px --
  // pixel-for-pixel unchanged -- while smaller sizes (e.g. the 20px
  // roster/player-slot avatar, where a flat 10px radius is exactly 50% of
  // the box and was rendering as a full circle instead of a rounded
  // square) now get a correctly-scaled-down radius instead.
  const radius = Math.round(size * (10 / 34));
  if (avatarUrl) {
    return (
      <div style={{
        width: size, height: size, borderRadius: `${radius}px`, flexShrink: 0,
        border: glow ? `1.5px solid ${glowColor}` : `1px solid ${PANEL_LINE_DIM}`,
        boxShadow: glow ? `0 0 12px ${glowColor}66` : "none",
        overflow: "hidden", background: "#000",
      }}>
        <img src={avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      </div>
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: `${radius}px`, flexShrink: 0,
      background: `${fallbackColor}15`,
      border: glow ? `1.5px solid ${fallbackColor}` : `1px solid ${fallbackColor}44`,
      boxShadow: glow ? `0 0 12px ${fallbackColor}66` : "none",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {DEFAULT_AVATAR.render(size * 0.8, fallbackColor)}
    </div>
  );
}

function GlowHeading({ children, size = "text-2xl", className = "" }) {
  return (
    <h1 className={`${size} font-display font-black tracking-wide text-ink-primary ${className}`}
      style={{ filter: "drop-shadow(0 0 18px rgba(124,92,255,0.45)) drop-shadow(0 0 34px rgba(34,229,255,0.25))", letterSpacing: "0.04em" }}>
      {children}
    </h1>
  );
}

// Wraps DraftSequenceStrip (the only current caller) -- a generic
// rounded/blurred panel shell. Light Mode fix, by explicit request:
// borderColor used to be a literal purple-accent hex (stark against a
// light background); now --color-panel-line at the same 0.35 opacity
// the unified Lobby/Admin divider system uses. boxShadow's soft ambient
// purple glow is left as-is -- brand ambiance, not a legibility issue.
function PanelFrame({ children, className = "", onClick, style, ...rest }) {
  return (
    <div className={`relative rounded-2xl border backdrop-blur-sm light-glow-card ${className}`} onClick={onClick}
      style={{ background: "linear-gradient(160deg, rgb(var(--color-panel-alt) / 0.92), rgb(var(--color-panel) / 0.96))", borderColor: "rgb(var(--color-panel-line) / 0.35)", boxShadow: "0 0 0 1px rgba(124,92,255,0.06), 0 0 30px rgba(124,92,255,0.10)", ...style }}
      {...rest}>
      {children}
    </div>
  );
}

function GenderIcon({ gender, className = 'w-4 h-4' }) {
  if (gender === 'male') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={`${className} text-sky-400`} aria-label="男生">
        <circle cx="10" cy="14" r="6" />
        <path d="M14.3 9.7L21 3M21 3h-5.5M21 3v5.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (gender === 'female') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={`${className} text-pink-400`} aria-label="女生">
        <circle cx="12" cy="9" r="6.5" />
        <path d="M12 15.5V22M8.5 19h7" strokeLinecap="round" />
      </svg>
    )
  }
  return null
}

function TeamCard({ team, activeTeamIdx, teamIdx, useCaptainName = false, assignable = false, onAssignCaptain, hiddenKeys }) {
  const isActive = activeTeamIdx === teamIdx;
  const displayName = useCaptainName && team.captain ? `${team.captain.name}的战队` : `${teamIdx + 1}号战队`;
  const canAssign = assignable && !team.captain;
  const captainHidden = !!hiddenKeys && hiddenKeys.has(`cap:${teamIdx}`);
  const filled = team.slots.filter(Boolean).length + (team.captain ? 1 : 0);
  const total = team.slots.length + 1;
  return (
    <div
      data-team-panel={teamIdx}
      onClick={canAssign ? () => onAssignCaptain(teamIdx) : undefined}
      className={`relative rounded-xl border px-3 py-3 transition-all duration-300 scroll-m-8 light-glow-card ${canAssign ? "cursor-pointer" : ""}`}
      style={{
        background: isActive ? "linear-gradient(160deg, rgba(34,229,255,0.12), rgb(var(--color-panel) / 0.96))" : "linear-gradient(160deg, rgb(var(--color-panel-alt) / 0.85), rgb(var(--color-panel) / 0.9))",
        borderColor: isActive ? TEAL : canAssign ? "#22c55e" : "rgb(var(--color-panel-line) / 0.35)",
        borderStyle: canAssign ? "dashed" : "solid",
        boxShadow: isActive ? `0 0 0 1px ${TEAL}55, 0 0 22px ${TEAL}33` : canAssign ? "0 0 14px rgba(34,197,94,0.2)" : "none",
      }}>
      {/* header row: name + fill progress + live indicator, all on one line */}
      <div className="flex items-center gap-2 mb-2.5">
        <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-black shrink-0"
          style={{ background: isActive ? TEAL : "rgb(var(--color-panel-2) / 0.6)", color: isActive ? "#06070F" : "rgb(var(--color-ink-muted))" }}>
          {teamIdx + 1}
        </span>
        <span className="text-[11px] font-bold tracking-wide truncate flex-1" style={{ color: isActive ? TEAL : "rgb(var(--color-ink-primary) / 0.85)" }}>{displayName}</span>
        {isActive && <span className="text-[8px] font-black px-1.5 py-0.5 rounded-md shrink-0 animate-pulse" style={{ background: "linear-gradient(135deg,#7C5CFF,#22E5FF)", color: "#06070F" }}>选人中</span>}
        <span className="text-[9px] font-mono text-ink-faint shrink-0">{filled}/{total}</span>
      </div>

      {/* captain slot */}
      <div className="flex items-center gap-2 mb-1.5 px-2 rounded-lg w-full"
        data-slot-key={`cap:${teamIdx}`}
        style={{
          height: CAPTAIN_SLOT_H, boxSizing: "border-box", overflow: "hidden", opacity: captainHidden ? 0 : 1,
          background: canAssign ? "rgba(34,197,94,0.08)" : "rgb(var(--color-panel-2) / 0.5)",
          border: canAssign ? "1px dashed #22c55e" : "1px solid rgb(var(--color-panel-line) / 0.35)",
        }}>
        {canAssign ? (
          <>
            <div className="w-[26px] h-[26px] rounded-md border border-dashed flex items-center justify-center text-xs flex-shrink-0" style={{ borderColor: "#22c55e", color: "#22c55e" }}>+</div>
            <span className="text-[10px] font-bold italic" style={{ color: "#22c55e" }}>点击分配队长</span>
          </>
        ) : team.captain ? (
          <>
            <Avatar avatarId={team.captain.avatarId} avatarUrl={team.captain.avatarUrl} size={26} glow />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 text-[10.5px] font-bold text-ink-primary truncate leading-tight">
                <span className="truncate">{team.captain.name}</span>
                <GenderIcon gender={team.captain.gender} className="w-3 h-3 shrink-0" />
              </div>
            </div>
            <CaptainBadge />
          </>
        ) : (
          <div className="flex items-center gap-2 w-full">
            <div className="w-[26px] h-[26px] rounded-md border border-dashed border-panel-line/35 flex items-center justify-center text-ink-faint text-[10px] flex-shrink-0">?</div>
            <span className="text-[10px] italic text-ink-faint">等待队长</span>
          </div>
        )}
      </div>

      {/* player slots -- compact single-line rows, each a real flight target */}
      <div className="space-y-1">
        {team.slots.map((slot, i) => {
          const slotKey = `slot:${teamIdx}:${i}`;
          const slotHidden = !!hiddenKeys && hiddenKeys.has(slotKey);
          return (
            <div key={i} data-slot-key={slotKey}
              className={`flex items-center gap-1.5 px-1.5 py-1 rounded-md border text-[10px] ${slot ? "bg-panel-2/60" : "bg-panel-alt/30 border-dashed border-panel-line/35 text-ink-faint"}`}
              style={{ ...(slot ? { borderColor: PANEL_LINE_DIM } : {}), opacity: slotHidden ? 0 : 1 }}>
              <span className="w-4 h-4 flex items-center justify-center rounded text-[8px] font-bold flex-shrink-0"
                style={{ background: slot ? `${TEAL}22` : "transparent", color: slot ? TEAL : "rgb(var(--color-ink-faint))", border: `1px solid ${slot ? TEAL+"55" : "rgb(var(--color-panel-line) / 0.35)"}` }}>
                {POSITIONS[i % 5]?.id ?? "?"}
              </span>
              {slot ? (
                <>
                  <Avatar avatarId={slot.avatarId} avatarUrl={slot.avatarUrl} size={17} />
                  <div className="min-w-0 flex-1 flex items-center gap-1 truncate font-semibold text-ink-primary text-[10px]">
                    <span className="truncate">{slot.name}</span>
                    <GenderIcon gender={slot.gender} className="w-2.5 h-2.5 shrink-0" />
                  </div>
                </>
              ) : <span className="italic">空位</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   PLAYER / CAPTAIN STAT CARD — shared card used by both the captain-
   candidate pool and the teammate draft pool, so every selectable-player
   tile in the Draft Arena comes from one design system. Same mint card,
   contained square avatar (top-left, fully inside the card — no overlap),
   centered name, 2×2 stat-pill grid. Fixed width so cards never stretch —
   pool grids wrap them in a plain flex-wrap row so wider screens simply
   fit more per row. Height is left to auto-flow (no more overlap trick
   needed now that the avatar sits fully inside the card).
   Sizing = "Version 4" (~60%) chosen from the Card Size Preview page.
   The four stats are TEMPORARY PLACEHOLDERS only (no real win-rate /
   trophy / rating data exists yet) — deterministically derived from the
   player's id so values stay stable across re-renders but still vary from
   player to player.
   ════════════════════════════════════════════════════════════════════════ */
const PLAYER_CARD_W = 130;
const PLAYER_CARD_AVATAR = 36;
const PLAYER_CARD_PAD = 9;
const PLAYER_CARD_GAP = 7;
const PLAYER_CARD_NAME_FONT = 13;
const PLAYER_CARD_LABEL_FONT = 9;
const PLAYER_CARD_VALUE_FONT = 13;
const PLAYER_CARD_STAT_PAD = 7;
const PLAYER_CARD_BG = "linear-gradient(155deg, rgb(var(--color-panel-2)) 0%, rgb(var(--color-panel)) 100%)";
// Light Mode fix, by explicit request: these were literal purple-accent
// hex borders (a stark, saturated outline on every pool card, heavier
// in light mode than in dark). Synced to the same --color-panel-line/
// 0.35 token+opacity the unified Tournament Lobby/Admin Dashboard
// divider system uses. The selected-state border (`#22c55e`, at the
// PLAYER_CARD_BORDER call site) is untouched -- that's the active/
// focused highlight, kept vibrant per instruction.
const PLAYER_CARD_BORDER = "rgb(var(--color-panel-line) / 0.35)";
const PLAYER_CARD_STAT_BG = "rgb(var(--color-panel-2) / 0.6)";
const PLAYER_CARD_STAT_BORDER = "rgb(var(--color-panel-line) / 0.35)";
const PLAYER_CARD_TEXT = "rgb(var(--color-ink-primary))";
const STAT_PILL_COLORS = { winRate: "#2B7FB8", champion: "#C9862B", position: "#5B4FCF", rating: "#B84FA0" };

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) h = (h * 31 + String(str).charCodeAt(i)) >>> 0;
  return h;
}
function seededPick(seed, min, max) { return min + (seed % (max - min + 1)); }
function placeholderStats(id) {
  const h = hashSeed(id);
  return {
    winRate: seededPick(h, 15, 78),
    champion: seededPick(Math.floor(h / 7), 0, 4),
    position: seededPick(Math.floor(h / 13), 1, 5),
    rating: seededPick(Math.floor(h / 23), 1200, 4800),
  };
}

// Square avatar (slightly rounded corners), fully contained inside the
// card — does not overlap the card border. Border/radius scale with size.
function SquareAvatar({ avatarId, avatarUrl, size }) {
  const fallbackColor = DEFAULT_AVATAR.color;
  return (
    <div style={{
      width: size, height: size, borderRadius: Math.max(6, size * 0.22), flexShrink: 0, overflow: "hidden",
      border: `${Math.max(2, Math.round(size * 0.05))}px solid #fff`, boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
      background: avatarUrl ? "#000" : `${fallbackColor}18`,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {avatarUrl
        ? <img src={avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        : DEFAULT_AVATAR.render(size * 0.65, fallbackColor)}
    </div>
  );
}

function StatPill({ label, value, color }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="font-bold rounded-md text-white whitespace-nowrap" style={{ background: color, fontSize: PLAYER_CARD_LABEL_FONT, padding: "2px 6px" }}>{label}</span>
      <span className="font-black leading-none" style={{ color: PLAYER_CARD_TEXT, fontSize: PLAYER_CARD_VALUE_FONT }}>{value}</span>
    </div>
  );
}

// Shared by both pool "done" states below (队长候选池 emptied, 待选选手
// exhausted) so their icon-in-a-box treatment can never visually drift
// apart between the two -- one definition, one set of classes, only the
// icon path and label differ per caller. Matches SpectatorPage.jsx's own
// empty-state icon box verbatim (Section 3's shared-look intent).
// Shared by both pool "done" states below (队长候选池 emptied, 待选选手
// exhausted) so their icon-in-a-box treatment can never visually drift
// apart between the two -- one definition, one set of classes, only the
// icon path and label differ per caller. Matches SpectatorPage.jsx's own
// empty-state icon box verbatim (Section 3's shared-look intent).
// `relative z-10`: AppBackground.jsx's fixed vignette sits behind all
// page content already via normal DOM order, but this pins that
// explicitly so this box and its label are never at risk of picking up
// any darkening from whatever's behind them, regardless of where on the
// page they land.
function EmptyPoolState({ icon, label }) {
  return (
    <div className="relative z-10 flex flex-col items-center gap-3 text-center">
      <span className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/30 flex items-center justify-center shadow-accent-glow">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7 text-accent">
          {icon}
        </svg>
      </span>
      <h2 className="font-display text-lg font-semibold text-ink-primary">{label}</h2>
    </div>
  );
}

// Site-wide stroke-icon style (viewBox 24, stroke=currentColor,
// strokeWidth 1.8) reused verbatim from TournamentLobby.jsx/
// AdminDashboard.jsx's own local Icon sets, so Draft Arena's admin
// action buttons (Draft Captain/Player header strip + Final Matchups)
// render with the same icon language as the rest of the app instead of
// emoji/glyphs. Each file keeps its own local Icon object (no shared
// icon module exists yet) -- this one is Draft Arena's copy. Originally
// scoped to Final Matchups only (named MatchupIcon); renamed DraftIcon
// and given two more entries (undo/arrowRight) when the same treatment
// was extended to the Draft Captain/Player header buttons.
const DraftIcon = {
  lock: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="1.6" />
      <path d="M7.5 10.5V8a4.5 4.5 0 0 1 9 0v2.5" strokeLinecap="round" />
    </svg>
  ),
  dice: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <circle cx="8.3" cy="8.3" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.7" cy="8.3" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="8.3" cy="15.7" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.7" cy="15.7" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  ),
  refresh: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" strokeLinecap="round" />
      <path d="M20 4v5h-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  x: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M5 5l14 14M19 5L5 19" strokeLinecap="round" />
    </svg>
  ),
  flag: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M6 3.5v17" strokeLinecap="round" />
      <path d="M6 4.5c2-1 4-1 6 0s4 1 6 0v9c-2 1-4 1-6 0s-4-1-6 0v-9Z" strokeLinejoin="round" />
    </svg>
  ),
  undo: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M4.5 12a7.5 7.5 0 1 1 2.2 5.3" strokeLinecap="round" />
      <path d="M4.5 7v5h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  arrowRight: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

// Verbatim copy of TournamentLobby.jsx's RailAction -- same classes,
// same structure, same disabled/hover treatment -- so Draft Arena's
// admin action buttons are pixel-identical to the 赛事管理 panel's
// buttons rather than an approximation of that style. Kept as a
// separate local component (not imported) since TournamentLobby.jsx
// doesn't export RailAction and each page already keeps its own local
// Icon/action-button definitions (see the DraftIcon comment above).
// Originally scoped to Final Matchups only (named MatchupAction);
// renamed DraftAction and given an optional trailing `badge` (a small
// count pill, e.g. 撤销's remaining-undo count) when the same treatment
// was extended to the Draft Captain/Player header buttons -- RailAction
// itself has no such slot, so this is the one deliberate addition on
// top of the verbatim copy, needed to not silently drop that count.
// Bug fix, by explicit report: `border-panel-line` (no opacity suffix,
// so effectively the same faint hairline as the `/35`-opacity variants
// used elsewhere) read as washed-out in the bottom action-bar screenshot
// fixed the same way as other washed-out borders in this file:
// explicit theme-branched border+background instead of a thin
// theme-token border, layered under the existing tone-based hover
// colors (danger vs default) rather than replacing them.
function DraftAction({ icon: IconCmp, label, onClick, disabled, tone = "default", title, badge }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-slate-300 bg-white/80 dark:border-slate-700 dark:bg-slate-900/60 text-sm font-medium transition disabled:opacity-50 disabled:pointer-events-none ${
        tone === "danger"
          ? "text-ink-muted hover:text-danger hover:border-danger/40 hover:bg-danger/5"
          : "text-ink-muted hover:text-ink-primary hover:border-accent2/40 hover:bg-accent/5"
      }`}
    >
      <IconCmp className="w-4 h-4 shrink-0" />
      {label}
      {badge != null && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold leading-none bg-panel-2 text-ink-muted">
          {badge}
        </span>
      )}
    </button>
  );
}

function PlayerStatCard({ player, onClick, disabled, selected, badge }) {
  const stats = placeholderStats(player.id);
  const badgeColors = badge === "队员" ? { background: "#475569", color: "#e0f2fe" } : { background: "#00A2E8", color: "#000000" };
  return (
    <button onClick={onClick} disabled={disabled} type="button" data-card-id={player.id}
      className={`relative text-left rounded-xl transition-all duration-200 w-full light-glow-card ${disabled ? "" : "hover:-translate-y-0.5"}`}
      style={{
        padding: PLAYER_CARD_PAD,
        background: PLAYER_CARD_BG, border: `2px solid ${selected ? "#22c55e" : PLAYER_CARD_BORDER}`,
        boxShadow: selected ? "0 0 0 3px rgba(34,197,94,0.3), 0 0 18px rgba(34,197,94,0.35)" : "0 0 0 1px rgba(124,92,255,0.08), 0 6px 16px rgba(4,3,15,0.4)",
        opacity: disabled ? 0.35 : 1, cursor: disabled ? "not-allowed" : "pointer",
      }}>
      {(badge || player.gender) && (
        <div className="absolute top-1.5 right-1.5 z-10 flex flex-col items-center">
          {badge && (
            <span className="font-black rounded-md"
              style={{ background: badgeColors.background, color: badgeColors.color, fontSize: 8, padding: "2px 6px" }}>
              {badge}
            </span>
          )}
          {player.gender && (
            <span className="mt-2">
              <GenderIcon gender={player.gender} className="w-4 h-4" />
            </span>
          )}
        </div>
      )}
      {/* header row: avatar + name side-by-side, not stacked -- shorter
          card, better information density in a grid at 1920px */}
      <div className="flex items-center gap-2.5" style={{ marginBottom: PLAYER_CARD_GAP }}>
        <SquareAvatar avatarId={player.avatarId ?? DEFAULT_AVATAR_ID} avatarUrl={player.avatarUrl} size={PLAYER_CARD_AVATAR} />
        <div className="min-w-0 flex-1 font-black truncate" style={{ color: PLAYER_CARD_TEXT, fontSize: PLAYER_CARD_NAME_FONT }}>{player.name}</div>
      </div>
      {/* single stat row, four compact chips instead of a boxed 2x2 well */}
      <div className="grid grid-cols-4 gap-1">
        <MiniStat label="胜率" value={`${stats.winRate}%`} color={STAT_PILL_COLORS.winRate} />
        <MiniStat label="冠军" value={stats.champion} color={STAT_PILL_COLORS.champion} />
        <MiniStat label="位置" value={stats.position} color={STAT_PILL_COLORS.position} />
        <MiniStat label="分数" value={stats.rating} color={STAT_PILL_COLORS.rating} />
      </div>
    </button>
  );
}

function MiniStat({ label, value, color }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-md py-1" style={{ background: PLAYER_CARD_STAT_BG, border: `1px solid ${PLAYER_CARD_STAT_BORDER}` }}>
      <span className="font-black leading-none" style={{ color, fontSize: PLAYER_CARD_VALUE_FONT * 0.78 }}>{value}</span>
      <span className="leading-none opacity-60" style={{ color: PLAYER_CARD_TEXT, fontSize: PLAYER_CARD_LABEL_FONT * 0.9 }}>{label}</span>
    </div>
  );
}

export { GlobalStyle };
function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800;900&display=swap');
      .font-display { font-family: 'Orbitron', sans-serif; }
      /* Scrollbar rules fully removed from here now, by explicit report
         (a second, later report than the one below -- read together).
         This <style> tag used to carry its own
         ::-webkit-scrollbar-track { background: #06070F } (a literal
         near-black, never theme-aware) AND its own
         ::-webkit-scrollbar { width: 6px } / ::-webkit-scrollbar-thumb
         { ... } pair, deliberately thinner than index.css's site-wide
         8px rule -- "Draft Arena's own thinner scrollbar", kept on
         purpose during the first fix below. Both were the same root
         mistake: because this <style> tag mounts later in the document
         than index.css's, ANY selector re-declared here silently wins
         over the site-wide rule for that selector, everywhere this
         component is mounted (all of Draft Arena AND Spectator Page,
         which reuses this same GlobalStyle). The track-background half
         was fixed first (see the comment just below, kept for
         history); the width/thumb half was explicitly kept different
         on purpose at the time, which is exactly what made Final
         Matchups' sidebar scrollbar visibly narrower than Tournament
         Lobby's own -- reported later, fixed now, the same way: removed
         rather than re-declared, so there is exactly one
         ::-webkit-scrollbar rule for the whole app again, in
         index.css, and it can't quietly drift out of sync a third time.
         The historical comment below is kept as the record of the
         first half of this same fix; nothing in it needs correcting,
         it just no longer describes the whole picture on its own. */
      /* Light Mode fix, by explicit request: this used to declare its
         own ::-webkit-scrollbar-track { background: #06070F } -- a
         literal near-black, never theme-aware -- which won over
         index.css's already-token-based global rule for the same
         selector (rgb(var(--color-panel-alt))) simply because this
         <style> tag mounts later in the document. That produced the
         black scrollbar-track bars in the bug report. Removed here
         rather than re-declared, so there's exactly one rule for this
         selector in the app (index.css's) instead of two that can
         drift out of sync again -- the track now just follows the
         site-wide rule like everywhere else. input::placeholder had
         the same issue (literal white at low opacity) and is fixed the
         same way: no DraftArena.jsx <input> exists to need overriding
         it in the first place, so it's removed rather than tokenized. */
      input:focus { outline: none; border-color: ${TEAL} !important; box-shadow: 0 0 10px rgba(34,229,255,0.4); }
      .no-scrollbar::-webkit-scrollbar { display: none; }
      .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

      /* Card Slide assignment animation (captain + teammate draft) */
      .df-ghost {
        position: fixed; z-index: 999; display: flex; align-items: center; gap: 8px;
        padding: 4px 10px 4px 4px; border-radius: 10px;
        background: rgba(10,20,20,0.95); border: 1px solid ${TEAL};
        box-shadow: 0 0 16px rgba(34,229,255,0.5);
        pointer-events: none; will-change: transform, opacity;
      }
      .df-ghost-avatar {
        border-radius: 8px; background: ${TEAL}; flex-shrink: 0; overflow: hidden;
        display: flex; align-items: center; justify-content: center; font-weight: 800; color: #04150a;
      }
      .df-ghost-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .df-ghost-name { font-size: 11.5px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      @keyframes dfSettle { 0% { transform: scale(1.15); } 100% { transform: scale(1); } }
      .df-settle { animation: dfSettle 0.2s ease-out; }
      @keyframes dfHit { 0% { box-shadow: 0 0 0 0 rgba(34,229,255,0.5); } 100% { box-shadow: 0 0 0 12px rgba(34,229,255,0); } }
      .df-hit { animation: dfHit 0.45s ease-out; }
    `}</style>
  );
}

// Shared "nothing saved yet" placeholder -- by explicit request,
// generalized out of SpectatorPage.jsx's own EmptySpectatorView (same
// icon/layout/title verbatim) so both DraftArenaPage (选秀台, browsed
// directly before any draft has started -- see its own noDraftYet logic
// below) and SpectatorPage.jsx (观赛, before any tournament_draft_state/
// tournament_matches row exists in Supabase) render the identical empty
// state, just with a subtitle tailored to what each audience should do
// next. Exported so SpectatorPage.jsx can import it instead of keeping
// its own copy -- one shared component, not two that can drift apart,
// same "one system" convention as everything else DraftArena.jsx/
// SpectatorPage.jsx already share (DraftArena, FinalMatchupsStage,
// GlobalStyle).
export function EmptyDraftView({ subtitle }) {
  return (
    // min-h-[60vh] is a floor on top of flex-1: flex-1 alone only fills
    // the parent's *available* height, which on sub-`lg` viewports isn't
    // pinned to the viewport (AppShell's root is `lg:h-screen`, plain
    // `min-h-screen` below that -- see AppShell.jsx), so flex-1 there
    // would just shrink to content size instead of actually centering in
    // the viewport. min-h-[60vh] guarantees a real, identical vertical
    // space to center within on every screen size, for both callers.
    <div className="flex-1 min-h-[60vh] flex flex-col items-center justify-center gap-3 text-center px-6">
      <span className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/30 flex items-center justify-center shadow-accent-glow">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-7 h-7 text-accent">
          <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </span>
      <h2 className="font-display text-lg font-semibold text-ink-primary">暂无选秀数据</h2>
      {/* min-h reserves two text-sm lines (line-height 1.25rem × 2) up
          front. DraftArenaPage's and SpectatorPage.jsx's subtitles are
          different lengths (27 vs 31 characters) -- inside the shared
          max-w-sm, the shorter one wraps to a single line and the longer
          one to two, so without a reserved height the icon+title block
          above sits at a different vertical offset (since the whole
          group is centered together) depending on which page you're on.
          That's the actual cause of the "layout shift when switching
          tabs" this fixes -- both empty states are already the exact
          same shared component/container, so per-caller content, not
          per-caller markup, was the source of the drift.

          Bug fix, by explicit report: this used to also carry `flex
          items-center justify-center`, vertically centering a
          single-line subtitle *within* the reserved two-line box --
          that's wrong for what we actually want. It kept the icon/title
          above fixed (good) but meant Draft Arena's one-line subtitle
          sat a half-line lower than Spectator's first line, which starts
          right at the top of the box the moment it wraps to two lines.
          No flex/centering here now -- a plain block element's text
          starts at its top by default, so the first line's baseline
          lands at the same Y in both cases; `min-h` still reserves the
          room for a second line so the *icon/title above* doesn't move,
          it just no longer repositions the text inside that room. */}
      <p className="text-sm text-ink-muted max-w-sm min-h-[2.5rem]">{subtitle}</p>
    </div>
  );
}

function DraftSequenceStrip({ customSnakeOrder, pickIndex, roundOrders, draftFinished }) {
  return (
    <PanelFrame className="p-4 mb-4 overflow-x-auto">
      <div className="flex flex-row items-center gap-1 flex-wrap">
        {customSnakeOrder.map((pick, idx) => {
          const isPast = idx < pickIndex; const isCurrent = idx === pickIndex;
          const isRoundStart = idx === 0 || pick.round !== customSnakeOrder[idx-1].round;
          return (
            <React.Fragment key={idx}>
              {isRoundStart && idx > 0 && <div className="flex items-center mx-1"><div className="w-px h-7 seq-divider" style={{ background: "rgba(34,229,255,0.2)" }} /></div>}
              <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
                <span className={`text-[7px] font-black tracking-wider ${isRoundStart ? 'seq-round-label' : ''}`} style={{ color: isRoundStart ? "rgba(34,229,255,0.45)" : "transparent" }}>{isRoundStart ? `R${pick.round}` : "."}</span>
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-black transition-all duration-200 seq-pick-num ${isPast ? 'seq-pick-past' : isCurrent ? 'seq-pick-current' : 'seq-pick-upcoming'}`}
                  style={isCurrent ? { background: "rgba(74,222,128,0.18)", color: "#4ade80", border: "1.5px solid rgba(74,222,128,0.75)", boxShadow: "0 0 10px rgba(74,222,128,0.8)", transform: "scale(1.25)" }
                    : isPast ? { background: "transparent", color: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.04)" }
                    : { background: "rgba(34,229,255,0.03)", color: "rgba(34,229,255,0.3)", border: "1px solid rgba(34,229,255,0.1)" }}>
                  {pick.teamIdx+1}
                </div>
              </div>
            </React.Fragment>
          );
        })}
        {draftFinished && <span className="ml-3 text-[12px] font-black" style={{ color: "#4ade80" }}>✓ 已完成</span>}
      </div>
    </PanelFrame>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   DRAFT ARENA — the Draft page itself, unchanged from AdminDraftControl in
   Dashboard.jsx (captain-assignment phase + snake-order teammate draft +
   undo + live team grid). Only the prop list was trimmed: the original
   `captainPool` / `draftPool` props were never actually read inside this
   component (they were only used by the parent screen to seed
   tournament.captainCandidates / tournament.pool before mounting it), so
   they're dropped here — everything this component renders comes from
   `tournament` alone, exactly as before.
   ════════════════════════════════════════════════════════════════════════ */
// Exported (Phase 6) so the read-only Spectator Page can reuse this exact
// component -- with isStaff={false} -- for a genuinely identical live view
// of the Captain/Teammate draft (same layout, same progress ring, same
// team/pool cards), instead of reimplementing it a second time. isStaff
// defaults to true so DraftArenaPage's own admin usage below is completely
// unchanged. When isStaff is false: every admin-only control (返回选手
//管理/撤销上一次选择/锁定并开始队员选秀/进入最终对阵) is not rendered at
// all (not merely disabled), and every click handler that would mutate
// the draft (captain assignment, teammate pick, undo, phase transition)
// no-ops immediately -- a spectator's clicks on a team/pool card never
// call setTournament, so there is no way to diverge from the live
// broadcast this component is fed from on the Spectator Page.
export { DraftArena };
function DraftArena({ tournament, setTournament, onBack, onProceed, tournamentName, isStaff = true, onSelectedCaptainChange, externalSelectedCaptainId = null, showBackButton = isStaff, backLabel = "← 返回选手管理", initialDraftHistory = [], onDraftHistoryChange }) {
  const [selectedCaptain, setSelectedCaptain] = useState(null);
  // Seeded once, lazily, from `initialDraftHistory` -- correct as long as
  // the caller doesn't actually mount this component until that prop's
  // real value is ready (DraftArenaPage's own `ready` gate does exactly
  // that; see its render below). A `useState` initializer only runs on
  // this component's own first mount, so a *later* prop change wouldn't
  // retroactively fix a wrong initial value the way the `tournament` prop
  // itself (read fresh every render, not seeded once) already can.
  const [draftHistory, setDraftHistory] = useState(() => initialDraftHistory);

  // Phase 6 (Spectator Page): tell the parent (DraftArenaPage) whenever
  // the *ephemeral*, not-yet-committed captain selection changes, so it
  // can be broadcast too -- selectedCaptain never touches `tournament`
  // (there's nothing to persist about it once a real assignment commits),
  // so it would otherwise be invisible to anyone but this exact browser.
  // No-ops when unset (every other DraftArenaPage caller before Phase 6).
  useEffect(() => {
    onSelectedCaptainChange?.(selectedCaptain);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCaptain]);

  // Same idea, for the Undo stack itself: report every change up so it
  // can be persisted (Live Draft State) and the Undo button keeps working
  // correctly across a resume, instead of silently losing every prior
  // session's history the moment this component remounts.
  useEffect(() => {
    onDraftHistoryChange?.(draftHistory);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftHistory]);

  // ── "Card Slide" assignment animation state ────────────────────────────
  // hiddenKeys: which captain-row / slot-row is currently mid-flight and
  // should render invisible (its real data is already committed — only the
  // reveal is deferred until the flying card visually lands).
  // flightsMeta (ref): per-key data needed to build & animate the flying
  // clone (source rect, name, avatar, target team). startedFlights (ref):
  // guards against re-starting a flight that's already animating.
  const [hiddenKeys, setHiddenKeys] = useState(() => new Set());
  const flightsMeta = useRef({});
  const startedFlights = useRef(new Set());
  // Every currently-in-flight clone + its live Animation object, purely so
  // they can be torn down cleanly if this component ever unmounts while
  // one is still running (see the cleanup effect below `runFlight`) --
  // normal completion (settle()) already removes its own entry here, same
  // as it already does for flightsMeta/startedFlights.
  const activeFlights = useRef(new Map());

  const beginFlight = (key, meta) => {
    if (!meta || !meta.srcRect) return;
    flightsMeta.current[key] = meta;
    setHiddenKeys((prev) => { const next = new Set(prev); next.add(key); return next; });
  };

  const runFlight = (key) => {
    const meta = flightsMeta.current[key];
    const destEl = document.querySelector(`[data-slot-key="${key}"]`);
    const cleanupRefs = () => { startedFlights.current.delete(key); delete flightsMeta.current[key]; };
    const reveal = () => setHiddenKeys((prev) => { if (!prev.has(key)) return prev; const next = new Set(prev); next.delete(key); return next; });

    if (!meta || !destEl) { reveal(); cleanupRefs(); return; }

    const srcRect = meta.srcRect;
    const dstRect = destEl.getBoundingClientRect();
    const avatarSize = meta.avatarSize || 20;

    const clone = document.createElement("div");
    clone.className = "df-ghost";
    const avatarInner = meta.avatarUrl
      ? `<img src="${escapeHtml(meta.avatarUrl)}" alt="" />`
      : escapeHtml((meta.name || "?")[0]);
    clone.innerHTML = `<span class="df-ghost-avatar" style="width:${avatarSize}px;height:${avatarSize}px;font-size:${Math.max(9, Math.round(avatarSize * 0.34))}px;">${avatarInner}</span><span class="df-ghost-name">${escapeHtml(meta.name)}</span>`;

    const chipW = dstRect.width, chipH = dstRect.height;
    const startLeft = srcRect.left + srcRect.width / 2 - chipW / 2;
    const startTop = srcRect.top + srcRect.height / 2 - chipH / 2;
    // left/top are set ONCE (not animated) to place the clone at its
    // start position; the actual motion is a `transform: translate()`
    // keyframe below, which the browser can composite on the GPU without
    // re-running layout on every frame -- unlike animating left/top
    // directly, which forces a full reflow + repaint each frame
    // regardless of how simple or complex the avatar image is.
    Object.assign(clone.style, { left: `${startLeft}px`, top: `${startTop}px`, width: `${chipW}px`, height: `${chipH}px` });
    document.body.appendChild(clone);

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      clone.remove();
      activeFlights.current.delete(key);
      reveal();
      cleanupRefs();
      destEl.classList.add("df-settle");
      destEl.addEventListener("animationend", function h() { destEl.classList.remove("df-settle"); destEl.removeEventListener("animationend", h); }, { once: true });
      if (meta.teamIdx != null) {
        const panelEl = document.querySelector(`[data-team-panel="${meta.teamIdx}"]`);
        if (panelEl) {
          panelEl.classList.add("df-hit");
          panelEl.addEventListener("animationend", function h() { panelEl.classList.remove("df-hit"); panelEl.removeEventListener("animationend", h); }, { once: true });
        }
      }
    };

    // Web Animations API (not CSS transition + transitionend) — guarantees
    // `finish` always fires for the full declared duration even when the
    // source and destination happen to share a coordinate, which was the
    // root cause of the earlier "stuck ghost" bug.
    const dx = dstRect.left - startLeft, dy = dstRect.top - startTop;
    const anim = clone.animate(
      [
        { transform: "translate(0px, 0px)", opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px)`, opacity: 0.95 },
      ],
      { duration: 550, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" }
    );
    anim.onfinish = settle;
    anim.oncancel = settle;
    activeFlights.current.set(key, { clone, anim });
    // Hard safety net in case the animation lifecycle is ever interrupted.
    setTimeout(settle, 700);
  };

  // Defense in depth alongside `readyToProceed` above: if this component
  // ever unmounts while a flight is still active (readyToProceed is meant
  // to make that unreachable via 进入最终对阵 specifically, but this stays
  // safe regardless of *why* an unmount happened to race a flight) settle
  // every one immediately rather than leaving a raw `document.body`-
  // attached clone element and a live Web Animations API `Animation`
  // object dangling with callbacks that reach back into this now-gone
  // component's closures -- `settle()`'s own guard (`if (settled) return`)
  // makes this safe to call even if the animation's own `onfinish` fires
  // around the same moment. `anim.cancel()` itself is wrapped in try/catch
  // since cancelling an animation whose target has already left the
  // document is exactly the kind of call that can throw inside the
  // browser's own WAAPI implementation -- the goal here is a clean
  // teardown, not one more uncaught exception during it.
  useEffect(() => {
    return () => {
      activeFlights.current.forEach(({ clone, anim }) => {
        try { anim.cancel(); } catch { /* target may already be detached */ }
        clone.remove();
      });
      activeFlights.current.clear();
    };
  }, []);

  useLayoutEffect(() => {
    hiddenKeys.forEach((key) => {
      if (startedFlights.current.has(key)) return;
      startedFlights.current.add(key);
      runFlight(key);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenKeys]);

  // ── Spectator-only: replay the same "card slide" flight from external
  // (Realtime) state updates ────────────────────────────────────────────
  // For isStaff=true (the admin), beginFlight() is already called
  // synchronously inside handleTeamSlotClick/handlePlayerCardClick, at
  // the exact moment the source card's DOM position is still known --
  // this block is untouched and never runs for that path.
  // For isStaff=false (the Spectator Page, Phase 6), `tournament` instead
  // changes because a new prop arrived from `tournament_draft_state`, and
  // by the time that render commits, the picked-from card (a captain
  // candidate or pool card) has already unmounted -- there is no click to
  // read a position from. So: every render, unconditionally snapshot the
  // on-screen position of every currently visible `[data-card-id]` card
  // (cardPositionsRef); then, only when `tournament` actually changed
  // (and never on the very first render, so joining mid-draft doesn't
  // replay the whole history at once), diff the previous team roster
  // against the new one. Any captain/slot that just went from empty to
  // filled is a pick that just happened live -- fire the exact same
  // beginFlight() the admin's own click handlers use, with that card's
  // last-known position (captured one render ago, i.e. right before it
  // unmounted) as the source; the existing runFlight()/hiddenKeys effect
  // above then picks it up on the next render and animates it, identical
  // to the admin's own click-triggered flight.
  const cardPositionsRef = useRef({});
  const prevTournamentRef = useRef(null);

  useLayoutEffect(() => {
    // Only the isStaff=false (Spectator Page) diff effect below ever reads
    // this map -- for isStaff=true (the admin's own Draft Arena) nothing
    // consumes it, so skip the scan entirely rather than pay a real,
    // forced-layout DOM query on every single render for no reason. This
    // matters more than it looks: a cost that's invisible on one click
    // compounds directly with how many renders happen in a short window --
    // exactly what rapid/spam clicking produces.
    if (isStaff) return;
    // Merge into the existing map -- do NOT replace it wholesale. A card
    // that just got picked/assigned is already gone from the DOM by the
    // time this runs on that same commit, so it would never appear in a
    // *fresh* `{}` rebuilt from only what's currently on screen -- and a
    // full replacement would silently erase its last-known position right
    // when the diff effect below needs it most. Merging keeps every
    // player's most recent known position around indefinitely (bounded by
    // the tournament's own roster size, so this never meaningfully grows)
    // while still refreshing the position of everyone still visible.
    const map = { ...cardPositionsRef.current };
    document.querySelectorAll("[data-card-id]").forEach((el) => {
      map[el.getAttribute("data-card-id")] = el.getBoundingClientRect();
    });
    cardPositionsRef.current = map;
  });

  useLayoutEffect(() => {
    if (isStaff) { prevTournamentRef.current = tournament; return; }
    const prev = prevTournamentRef.current;
    prevTournamentRef.current = tournament;
    if (!prev || !Array.isArray(prev.teams) || !Array.isArray(tournament.teams)) return;

    tournament.teams.forEach((team, i) => {
      const prevTeam = prev.teams[i];
      if (!prevTeam) return;

      if (!prevTeam.captain && team.captain) {
        const key = `cap:${i}`;
        if (!startedFlights.current.has(key)) {
          const srcRect = cardPositionsRef.current[team.captain.id];
          beginFlight(key, { srcRect, name: team.captain.name, avatarId: team.captain.avatarId, avatarUrl: team.captain.avatarUrl, avatarSize: 34, teamIdx: i });
        }
      }

      (team.slots || []).forEach((slot, j) => {
        const prevSlot = prevTeam.slots ? prevTeam.slots[j] : undefined;
        if (!prevSlot && slot) {
          const key = `slot:${i}:${j}`;
          if (!startedFlights.current.has(key)) {
            const srcRect = cardPositionsRef.current[slot.id];
            beginFlight(key, { srcRect, name: slot.name, avatarId: slot.avatarId, avatarUrl: slot.avatarUrl, avatarSize: 20, teamIdx: i });
          }
        }
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament, isStaff]);

  const { teams, pickIndex, pool, lastPick, draftPhase, captainCandidates, roundOrders } = tournament;
  // Phase 6 (Spectator Page): isStaff=true always uses this browser's own
  // local `selectedCaptain` (unchanged). isStaff=false has no local
  // selection of its own (handleCaptainClick no-ops for it) -- instead it
  // mirrors whichever candidate the admin actually has selected right
  // now, via `externalSelectedCaptainId` (broadcast alongside `tournament`
  // itself, see DraftArenaPage), resolved back to a full object here so
  // the same headline/hint text and card-glow rendering below can stay
  // untouched either way.
  const effectiveSelectedCaptain = isStaff
    ? selectedCaptain
    : (externalSelectedCaptainId ? captainCandidates.find((c) => c.id === externalSelectedCaptainId) ?? null : null);
  // teamCount comes from the Tournament Lobby's Tournament Settings (see
  // seedTournament()/DraftArenaPage below, where `teams` is built to that
  // exact length) -- never assumed fixed here.
  const teamCount = teams.length;
  const meta = computeDraftMeta(tournament, teamCount);
  const { roundOrderValid, customSnakeOrder, allCaptainsAssigned, draftFinished, currentPick, activeTeamIdx, roundLabel } = meta;
  const allDrafted = draftFinished;

  // 进入最终对阵 must wait for `hiddenKeys` to be empty too, not just
  // `allDrafted` -- this is the actual root cause of a real, reported bug
  // (`sync_draft_state` 500s, a 404, and an uncaught
  // "Cannot read properties of undefined (reading 'startTime')" the
  // instant this button was clicked). `allDrafted` flips true the instant
  // the *last* pick commits -- the same render the last flying-card
  // animation *starts*, up to ~550-700ms before it actually finishes (see
  // runFlight below). Clicking 进入最终对阵 during that window used to be
  // possible, and its success handler flips `stage` to 'final'
  // synchronously -- which unmounts this entire `DraftArena` component,
  // including the still-live flight animation: a raw DOM clone appended
  // straight to `document.body` (outside React's tree, so unmounting
  // doesn't clean it up), a still-running Web Animations API `Animation`
  // object, and a pending `settle()` callback that reaches back into a
  // now-unmounted component's closures. Ripping a WAAPI animation's
  // context out mid-flight like that is exactly the kind of thing that
  // throws that "startTime" TypeError. Gating the button on
  // `hiddenKeys.size === 0` means the click that unmounts this component
  // can only ever happen once every flight has already cleanly finished
  // and cleaned up after itself via its own `settle()` -- see the
  // matching unmount-safety effect further down for the defense-in-depth
  // half of this fix.
  const readyToProceed = allDrafted && hiddenKeys.size === 0;

  // "Whose turn is it" -- the *visual* team highlight (TeamCard's glow,
  // the header's "队 N 的选人回合" name, and scrolling that team into
  // view) intentionally lags one step behind `activeTeamIdx` above during
  // the teammate/player draft: `activeTeamIdx` is derived straight from
  // `pickIndex`, which already advances to the next team the instant a
  // pick commits (pickPlayer(), same render as the flying-card animation
  // starts) -- so without this, the next team's box started glowing
  // before the current pick's card had finished flying into its slot, a
  // real, reported bug. `hiddenKeys` already tracks exactly which flights
  // (by key, "slot:teamIdx:slotIdx") are still mid-animation -- so: keep
  // `visualActiveTeamIdx` synced to the real `activeTeamIdx` at all times
  // EXCEPT while a teammate pick's flight is still in `hiddenKeys`: hold
  // it at whatever it last was (the team that just picked) until that
  // flight's own `settle()` clears its key, then this effect re-fires and
  // catches up to the (by-then-correct) real `activeTeamIdx`. Captain
  // assignment is unaffected either way -- `activeTeamIdx` is always -1
  // during that phase (see computeDraftMeta above; there's no sequential
  // "whose turn" there, any unfilled team is a valid click target), and
  // captain flights use `cap:` keys, which this deliberately ignores.
  // Game logic (which slot a pick fills, the snake order, progress %)
  // still reads the real, immediate `activeTeamIdx`/`pickIndex` elsewhere
  // in this file, completely unaffected -- only these display-only
  // "whose turn" indicators wait for the animation.
  const [visualActiveTeamIdx, setVisualActiveTeamIdx] = useState(activeTeamIdx);
  useEffect(() => {
    const slotFlightPending = [...hiddenKeys].some((k) => k.startsWith("slot:"));
    if (!slotFlightPending) setVisualActiveTeamIdx(activeTeamIdx);
  }, [activeTeamIdx, hiddenKeys]);

  // Keep the current picker's team card in view. The team strip is a
  // single horizontal line (see the container below) that can need its
  // own scrolling once there are enough teams to overflow it -- nothing
  // else would otherwise bring a newly-active team back into view when
  // the turn passes to it -- it could sit scrolled off to the side
  // indefinitely, and any pick that lands on it would fly its card to a
  // destination the user can't see. TeamCard carries scroll-m-8 so
  // scrollIntoView leaves the same clearance around the card that its
  // container's own padding already guarantees at rest -- inline:"nearest"
  // alone only guarantees the card's bare box is visible and can flush it
  // right against the strip's edge, which wouldn't leave room for the
  // glow's box-shadow reach beyond that box. This only scrolls within the
  // strip's own overflow-x-auto ancestor (see below); it never touches
  // the browser's own scroll position, since nothing above that container
  // is actually scrollable on desktop. Scrolls to `visualActiveTeamIdx`,
  // not the real `activeTeamIdx`, for the same reason as above -- jumping
  // the viewport to the next team before its box actually lights up would
  // be its own version of the same "got ahead of the animation" bug.
  useEffect(() => {
    if (visualActiveTeamIdx < 0) return;
    const el = document.querySelector(`[data-team-panel="${visualActiveTeamIdx}"]`);
    if (el) el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [visualActiveTeamIdx]);

  const saveSnapshot = () => ({ teams: JSON.parse(JSON.stringify(teams)), pool: pool ? [...pool] : null, captainCandidates: [...captainCandidates], selectedCaptain, pickIndex, draftPhase, lastPick });

  const handleCaptainClick = (captain) => { if (!isStaff) return; setSelectedCaptain((prev) => prev?.id === captain.id ? null : captain); };

  const handleTeamSlotClick = (teamIdx) => {
    if (!isStaff || !selectedCaptain || teams[teamIdx]?.captain) return;
    const captain = selectedCaptain;
    const srcEl = document.querySelector(`[data-card-id="${CSS.escape(captain.id)}"]`);
    const srcRect = srcEl ? srcEl.getBoundingClientRect() : null;

    setDraftHistory((h) => [...h, saveSnapshot()]);
    setTournament((prev) => {
      const next = prev.teams.map((t) => ({ ...t }));
      next[teamIdx] = { ...next[teamIdx], captain: selectedCaptain };
      return { ...prev, teams: next, captainCandidates: prev.captainCandidates.filter((c) => c.id !== selectedCaptain.id), lastPick: { player: selectedCaptain, teamIdx, phase: "captain" } };
    });
    setSelectedCaptain(null);

    if (srcRect) {
      beginFlight(`cap:${teamIdx}`, { srcRect, name: captain.name, avatarId: captain.avatarId, avatarUrl: captain.avatarUrl, avatarSize: 34, teamIdx });
    }
  };

  const startTeammateDraft = () => { if (!isStaff || !allCaptainsAssigned || !roundOrderValid.every(Boolean)) return; setTournament((prev) => ({ ...prev, draftPhase: "teammate", pickIndex: 0, roundOrdersLocked: true })); };

  const pickPlayer = (player) => {
    if (draftPhase !== "teammate" || draftFinished) return;
    setDraftHistory((h) => [...h, saveSnapshot()]);
    const teamIdx = activeTeamIdx;
    setTournament((prev) => {
      const next = prev.teams.map((t) => ({ ...t, slots: [...t.slots] }));
      const slotIdx = next[teamIdx].slots.findIndex((s) => s === null);
      if (slotIdx === -1) return prev;
      next[teamIdx].slots[slotIdx] = player;
      return { ...prev, teams: next, pool: prev.pool.filter((p) => p.id !== player.id), lastPick: { player, teamIdx, phase: "teammate", round: currentPick?.round }, pickIndex: prev.pickIndex + 1 };
    });
  };

  // Selecting a player and assigning them are one click in the real draft
  // (the target team is whoever is on the clock). This mirrors
  // handleTeamSlotClick as closely as possible on purpose: capture the
  // source card's position, commit the pick immediately (pickPlayer is
  // unchanged, no artificial delay), then hand off to the exact same
  // runFlight chip animation the captain flow uses. There is no separate
  // "selected" render step and no manual clone/hide step here — because
  // the commit is immediate and there's no intermediate state to flash
  // back from, the pool card simply unmounts cleanly on the next render,
  // the same way the captain-candidate card already does.
  const handlePlayerCardClick = (player) => {
    if (!isStaff || draftPhase !== "teammate" || draftFinished) return;
    const srcEl = document.querySelector(`[data-card-id="${CSS.escape(player.id)}"]`);
    const srcRect = srcEl ? srcEl.getBoundingClientRect() : null;
    const teamIdxAtClick = activeTeamIdx;
    const slotIdxAtClick = teams[teamIdxAtClick]?.slots.findIndex((s) => s === null);

    pickPlayer(player);

    if (srcRect && teamIdxAtClick != null && teamIdxAtClick !== -1 && slotIdxAtClick != null && slotIdxAtClick !== -1) {
      beginFlight(`slot:${teamIdxAtClick}:${slotIdxAtClick}`, { srcRect, name: player.name, avatarId: player.avatarId, avatarUrl: player.avatarUrl, avatarSize: 20, teamIdx: teamIdxAtClick });
    }
  };

  const undoLastPick = () => {
    if (!isStaff || draftHistory.length === 0) return;
    const prevSnap = draftHistory[draftHistory.length - 1];
    setTournament((prev) => ({ ...prev, teams: prevSnap.teams, pool: prevSnap.pool, captainCandidates: prevSnap.captainCandidates, pickIndex: prevSnap.pickIndex, draftPhase: prevSnap.draftPhase, lastPick: prevSnap.lastPick, roundOrdersLocked: prevSnap.draftPhase === "captain" ? false : prev.roundOrdersLocked }));
    setSelectedCaptain(prevSnap.selectedCaptain);
    setDraftHistory((h) => h.slice(0, -1));
  };

  // Header progress ring: the same two underlying metrics the old dual
  // linear bars showed (captain-assignment % and draft-pick %), just
  // presented as one context-appropriate ring instead of two bars shown
  // at once -- only one of the two is ever actually moving at a time (the
  // other is pinned at 0% before the captain phase finishes, or 100% for
  // the rest of the draft once it has), so nothing shown before is lost.
  const headerProgressPct = draftPhase === "captain"
    ? ((8 - captainCandidates.length) / 8) * 100
    : (customSnakeOrder.length ? (pickIndex / customSnakeOrder.length) * 100 : 0);
  // Color standardization, by explicit request: matches the phase pill
  // badge fix above -- Phase 1's ring/percentage-text used to be green
  // (#22c55e), Phase 2's was cyan/teal (TEAL); both phases now share
  // the same TEAL value, so only headerProgressPct (the fill amount)
  // differs between phases, not the color. Literal hex, so already
  // identical in both themes by construction (see TEAL's definition).
  const headerRingColor = TEAL;
  const HEADER_RING_R = 32;
  const HEADER_RING_CIRC = 2 * Math.PI * HEADER_RING_R;
  const headerRingOffset = HEADER_RING_CIRC * (1 - headerProgressPct / 100);

  if (teams.length === 0) return <div className="flex items-center justify-center flex-1 text-ink-muted">加载中…</div>;

  // Team overview strip (战队总览) -- one shared block for both phases so
  // there's exactly one place that renders it, not two. Captain
  // assignment keeps it above the pool (团队卡片 is literally what you
  // click during that phase); Teammate draft places it *below* the Draft
  // Order strip instead, at the user's explicit request -- see where each
  // is used in the BODY section below.
  const teamOverviewStrip = (
    <div className="shrink-0 border-b border-panel-line/35 px-4 sm:px-5 lg:px-6 py-3.5">
      <p className="eyebrow px-1">战队总览 · {teams.length}</p>
      {/* pt-3 here (in place of the eyebrow's old mb-2) puts headroom
          *inside* this overflow-x-auto row's own clip box -- setting
          overflow-x without overflow-y forces the used value of
          overflow-y to auto too (per the CSS overflow spec), so without
          this the row clips TeamCard's isActive glow and its df-hit
          assignment-ripple flush against its own top edge.

          Same reasoning on the other three sides -- bug fix: the row
          used to have no horizontal padding at all (and only pb-1
          below), so the very first team's left glow/ripple was clipped
          flush against the row's left edge whenever it was active or
          being flown into (only 1号战队 -- the first card -- showed
          it). Every *other* team escaped only because
          scrollIntoView + TeamCard's scroll-m-8 scrolls the row to leave
          clearance around it, but a scroll offset can't go below 0 (or
          past the end), so the first card (and, symmetrically, the last
          one at the far end) can never get that clearance from
          scrolling and only ever has the row's own padding. So that
          padding now covers the glow's full reach on every side:
          `-mx-*`/`px-*` cancel out exactly (the row spans the whole
          block, its content stays aligned with the eyebrow above -- the
          values must track this block's own px-4/sm:px-5/lg:px-6
          padding, or the page gains a stray horizontal scrollbar on
          mobile), and `pb-3 -mb-2` gives the bottom the same 12px as
          the top without changing this strip's overall height. */}
      <div className="flex flex-row gap-2.5 overflow-x-auto pb-3 -mb-2 pt-3 -mx-4 px-4 sm:-mx-5 sm:px-5 lg:-mx-6 lg:px-6">
        {teams.map((team, i) => (
          <div key={i} className="shrink-0" style={{ width: 220 }}>
            <TeamCard team={team} activeTeamIdx={visualActiveTeamIdx} teamIdx={i}
              assignable={draftPhase === "captain" && !!effectiveSelectedCaptain}
              onAssignCaptain={handleTeamSlotClick}
              hiddenKeys={hiddenKeys} />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="w-full flex flex-col flex-1 lg:min-h-0 lg:overflow-hidden">
      {/* ═══ STATUS STRIP — flush under the shared AppShell bar, not a
          floating card. This is the "what's happening right now" line:
          phase → who's on the clock → progress → the one action that
          matters. Exiting the draft now lives in AppShell's own nav bar
          (锦标赛大厅, or the dedicated 选秀台 tab itself -- see
          DraftArenaPage's `draftNav` below -- AppShell no longer renders
          a dedicated back-link header for this page at all), so this
          strip only carries draft-specific controls (Undo, Proceed). ═══ */}
      <div className="shrink-0 border-b border-panel-line/35 bg-void/30 backdrop-blur-sm px-5 sm:px-8 h-20 flex items-center gap-6">
        <div className="flex-1 min-w-0 flex items-center gap-4">
          <span
            className="shrink-0 text-[10px] font-black px-2.5 py-1 rounded-md tracking-widest"
            style={{
              // Color standardization, by explicit request: Phase 1
              // (队长分配) used to be green (#22c55e) while Phase 2
              // (队员选秀) was cyan/teal (TEAL) -- both phases now share
              // the exact same cyan/teal classes/values, in both themes
              // (these are literal hex, part of Draft Arena's fixed
              // brand accent system like TEAL/TEAL_SOFT elsewhere in
              // this file, so they're identical regardless of
              // [data-theme] already, not just matched in one theme).
              background: "rgba(34,229,255,0.12)",
              color: TEAL,
              border: `1px solid ${TEAL}55`,
            }}
          >
            {draftPhase === "captain" ? "第一阶段 · 队长分配" : "第二阶段 · 队员选秀"}
          </span>
          <div className="min-w-0">
            {draftPhase === "captain" ? (
              <GlowHeading size="text-xl" className="truncate block">
                {effectiveSelectedCaptain ? `将 ${effectiveSelectedCaptain.name.toUpperCase()} 分配到战队` : "选择一名队长"}
              </GlowHeading>
            ) : allDrafted ? (
              <GlowHeading size="text-xl" className="truncate block">全部选手已选完 🏆</GlowHeading>
            ) : (
              <GlowHeading size="text-xl" className="truncate block">{teams[visualActiveTeamIdx]?.captain?.name?.toUpperCase()} 的选人回合</GlowHeading>
            )}
            <div className="text-[10.5px] text-ink-muted truncate mt-0.5">
              {/* Light Mode fix, by explicit request: this used to be a
                  literal text-white/40 -- fixed white regardless of
                  theme, so in light mode it was near-invisible against
                  the light canvas (the "现在点击上方一张空战队卡片" prompt
                  from the bug report). text-ink-muted is the same token
                  every other secondary/subtitle line in the app uses, so
                  it resolves to a legible muted color in both themes. */}
              {draftPhase === "captain"
                ? (effectiveSelectedCaptain ? "现在点击上方一张空战队卡片 →" : `剩余${captainCandidates.length}人 · 已分配${8-captainCandidates.length}/8`)
                : (!allDrafted && <>第{roundLabel}轮，共{roundOrders.length}轮 · 战队{visualActiveTeamIdx+1} · 第{pickIndex+1}/{customSnakeOrder.length}顺位</>)}
            </div>
          </div>
        </div>

        {isStaff && (
          <DraftAction
            icon={DraftIcon.undo}
            label="撤销"
            onClick={undoLastPick}
            disabled={draftHistory.length === 0}
            badge={draftHistory.length > 0 ? draftHistory.length : null}
          />
        )}

        <div className="shrink-0 flex items-center gap-4">
          <div className="relative" style={{ width: 52, height: 52 }}>
            <svg width="52" height="52" style={{ transform: "rotate(-90deg)" }}>
              <circle cx="26" cy="26" r={HEADER_RING_R * 0.7} fill="none" stroke="rgb(var(--color-panel-line))" strokeWidth="5" />
              <circle cx="26" cy="26" r={HEADER_RING_R * 0.7} fill="none" stroke={headerRingColor} strokeWidth="5"
                strokeDasharray={HEADER_RING_CIRC * 0.7} strokeDashoffset={headerRingOffset * 0.7} strokeLinecap="round"
                style={{ transition: "stroke-dashoffset 500ms" }} />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center font-display font-bold text-[11px]" style={{ color: headerRingColor }}>
              {Math.round(headerProgressPct)}%
            </div>
          </div>
          {isStaff && draftPhase === "captain" && (
            <DraftAction
              icon={DraftIcon.arrowRight}
              label="开始队员选秀"
              onClick={startTeammateDraft}
              disabled={!(allCaptainsAssigned && roundOrderValid.every(Boolean))}
            />
          )}
          {isStaff && draftPhase === "teammate" && (
            <DraftAction
              icon={DraftIcon.arrowRight}
              label="进入最终对阵"
              onClick={onProceed}
              disabled={!readyToProceed}
            />
          )}
        </div>
      </div>

      {/* ═══ BODY — team overview strip + Draft Order strip + the
          draftable pool. Both phases share the exact same
          `teamOverviewStrip` JSX (declared once, above) -- only *where*
          it's placed differs, not what it renders. Captain assignment:
          战队总览 sits directly above 队长候选池 (team cards are literally
          what you click that phase). Teammate draft: Draft Order
          (`DraftSequenceStrip`) comes first, 战队总览 second, 待选选手
          last -- confirmed against an actual screenshot of the rendered
          page, so if this ever looks unswapped again, check whether a
          stale build/cache is being viewed before changing this code. ═══ */}
      <div className="flex-1 lg:min-h-0 flex flex-col lg:overflow-hidden">
        {draftPhase === "captain" && teamOverviewStrip}

        <div className="flex-1 lg:min-h-0 flex flex-col lg:overflow-hidden">
          {draftPhase === "teammate" && (
            <div className="shrink-0 px-5 sm:px-6 pt-3">
              <DraftSequenceStrip customSnakeOrder={customSnakeOrder} pickIndex={pickIndex} roundOrders={roundOrders} draftFinished={allDrafted} />
            </div>
          )}

          {draftPhase === "teammate" && teamOverviewStrip}

          {draftPhase === "captain" && (
            <div className="flex flex-col flex-1 lg:min-h-0 lg:overflow-hidden px-5 sm:px-6 py-4">
              {/* mb-3 moved off this header and onto the scroll container
                  below as pt-3 (same 12px total gap) so that 12px sits
                  *inside* the scroll container's own clip box instead of
                  outside it -- giving PlayerStatCard's hover/selected glow
                  room to bleed upward without being clipped by the
                  container's own top edge (its first row otherwise sits
                  flush against it). */}
              <div className="flex items-center justify-between shrink-0">
                <h2 className="font-display text-sm font-bold tracking-widest" style={{ color: "#22c55e" }}>队长候选池</h2>
                <span className="text-xs font-mono text-ink-faint">{captainCandidates.length} 人未分配</span>
              </div>
              <div className="flex-1 lg:min-h-0 overflow-y-auto pt-3">
                <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
                  {captainCandidates.map((c) => (
                    <PlayerStatCard key={c.id} player={c} onClick={() => handleCaptainClick(c)} selected={effectiveSelectedCaptain?.id === c.id} badge="队长" />
                  ))}
                  {captainCandidates.length === 0 && (
                    <div className="col-span-full py-8">
                      <EmptyPoolState
                        icon={<path d="M5 13l4 4L19 7" />}
                        label="所有队长已分配完毕！"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {draftPhase === "teammate" && (
            <div className="flex flex-col flex-1 lg:min-h-0 lg:overflow-hidden px-5 sm:px-6 py-4">
              {/* Same mb-3-to-pt-3 headroom fix as the captain pool grid
                  above -- see the comment there. */}
              <div className="flex items-center justify-between shrink-0">
                <h2 className="font-display text-sm font-bold tracking-widest" style={{ color: TEAL }}>待选选手</h2>
                <span className="text-xs font-mono text-ink-faint">{pool?.length ?? 0} 人待选</span>
              </div>
              {pool && pool.length > 0 ? (
                <div className="flex-1 lg:min-h-0 overflow-y-auto pt-3">
                  <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
                    {pool.map((p) => (
                      <PlayerStatCard key={p.id} player={p} onClick={() => handlePlayerCardClick(p)} disabled={allDrafted} badge="队员" />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center pt-3">
                  <EmptyPoolState
                    icon={<>
                      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                      <path d="M4 22h16" />
                      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
                      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
                      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
                    </>}
                    label="选秀完成"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   FINAL MATCHUPS STAGE — "Broadcast Bracket Reveal"

   Ground-up visual/interaction redesign (see the fuller comment directly
   above the FinalMatchupsStage component below for the full rationale
   and composition). The data/logic layer this stage renders is entirely
   unchanged: `teams`/`matchups` props, kept live via this project's
   existing Realtime subscription, and the same RPC-backed mutation
   functions (createManualMatchup / rollTournamentMatchupsPool /
   removeTournamentMatchup / resetTournamentMatchups / endTournament)
   imported at the top of this file.
   ════════════════════════════════════════════════════════════════════════ */

function teamLabel(team) {
  return team?.captainName ? `${team.captainName} 战队` : "（空）战队";
}

// ---------------------------------------------------------------------
// FINAL MATCHUPS -- "Broadcast Bracket Reveal"
//
// Ground-up redesign (visual + interaction only). The data/logic layer
// is unchanged from the rest of the app's conventions: `teams` is an
// array of {idx, captainName, captainAvatarUrl} snapshots and `matchups`
// is an array of {a, b, locked} entries (a/b are team idx, b is null for
// a bye), both persisted server-side and delivered as props (with
// Realtime keeping every connected client in sync) exactly like every
// other stage in this app. Every mutation still goes through the same
// RPC-backed functions imported at the top of this file
// (createManualMatchup / rollTournamentMatchupsPool /
// removeTournamentMatchup / resetTournamentMatchups / endTournament) --
// nothing about how matchups are generated, stored, loaded, or updated
// has changed, only how that data is presented.
//
// Composition mirrors the rail + main pattern used by the Tournament
// Lobby, Admin Dashboard, and Draft Arena: a team roster/pairing rail on
// the left, a large "spotlight" reveal card as the dominant surface on
// the right, with a filmstrip to browse every match already generated
// and an action bar for staff. A slim status strip sits on top, flush
// under the shared AppShell bar, the same idiom Draft Arena's own status
// strip uses.
//
// The reveal itself is a new concept: a countdown -> name-shuffle
// flicker -> settle sequence played inside the spotlight card using
// plain React state (no manual DOM manipulation), reusing this file's
// own Avatar component so captains render with their real photos, VS
// duels instead of a gold movie-poster. Once every team has a matchup,
// the spotlight becomes a clean scoreboard-style lineup grid.
// ---------------------------------------------------------------------

function computeUsedIdxs(matches) {
  const s = new Set();
  matches.forEach((m) => { if (m.a != null) s.add(m.a); if (m.b != null) s.add(m.b); });
  return s;
}
function computeComplete(matches, teamsArr) {
  if (matches.length === 0 || teamsArr.length === 0) return false;
  const used = computeUsedIdxs(matches);
  return teamsArr.every((t) => used.has(t.idx));
}
const fmpWait = (ms) => new Promise((r) => setTimeout(r, ms));

// Timing of one matchup's reveal (ms). Sequence per matchup:
//   countdown 3-2-1  ->  team rolling (flicker)  ->  reveal  ->  hold  ->  next matchup
// FMP_ROLL_MS is the total time the teams shuffle. It is played as frames of
// FMP_ROLL_FRAME_MS (the original cadence), with the last frame absorbing the
// remainder so the phase lasts exactly FMP_ROLL_MS instead of drifting by up
// to a frame. FMP_REVEAL_HOLD_MS is an extra still pause on the finished
// result before the NEXT matchup starts; it is applied unconditionally,
// including after the last matchup in a batch, so the final rolled result
// gets the same pause as every other one before the stage settles (see
// runReveal's own comment at that call site). It is spent inside the reveal
// phase, not the settled view, because swapping to the settled view replays
// that view's own scale-in animation, which would make the result visibly
// pop a second time (this is also why `skipFeaturedPopRef`, near this
// component's other refs, exists as a second line of defense for the one
// remaining case that does cross into the settled view -- see its own
// comment).
//
// FMP_REVEAL_MS + FMP_REVEAL_HOLD_MS is how long a real match's settled
// result stays on screen before the countdown for the next matchup begins
// (or, for the last matchup in a batch, before the page moves on to
// whatever comes after it). By explicit report this used to total 2100ms
// (a 1100ms entrance + a 1000ms hold) and read as sluggish; a later pass
// cut the hold to just 100ms to speed it up, but that made the settled
// result fly by too fast to actually read -- so the hold is back to a
// full 1000ms, kept snappy only on the entrance side: FMP_REVEAL_MS stays
// at 900ms (comfortably outlasting a typical team's own chip-cascade
// entrance animation -- a 4-member team's cascade -- CHIPS_PER_ROW --
// finishes around 820ms into the reveal; see TeammateChip/fmpChipIn) and
// FMP_REVEAL_HOLD_MS is a full 1000ms on top of that, so a real match's
// whole on-screen dwell is 1900ms: an ~900ms entrance plus a full 1s of
// static read time, by explicit request. A team with many more than 4
// members can still have its cascade run past the entrance window
// (uncommon; games with very large rosters, at up to 20 members) --
// pre-existing, not something this specific timing pass fixes.
const FMP_COUNT_STEP_MS = 600;
const FMP_ROLL_MS = 2000;
const FMP_ROLL_FRAME_MS = 110;
const FMP_REVEAL_MS = 900;
const FMP_REVEAL_HOLD_MS = 1000;
// Bye's own hold, after FMP_BYE_DELAY_MS below -- deliberately its own,
// separate constant from FMP_REVEAL_HOLD_MS (rather than reusing one shared
// "hold" constant for both, which is what this file used to do): a bye has
// no reveal animation of its own to briefly outlast, so shortening the real
// match's hold above for snappiness has no bearing on how long a bye should
// sit on screen, and the two are free to diverge without the fix for one
// silently changing the other again.
const FMP_HOLD_MS = 1000;
// A bye (`m.b == null`) is never a random outcome -- it is simply "this team
// had no opponent left" -- so it gets no countdown and no flicker, by
// explicit request (an odd-sized pool, e.g. 3 teams, used to play the full
// countdown/flicker/settle show for the one team that couldn't be
// randomized against anything, which read as fake suspense over a foregone
// conclusion). Just this short pause instead, then straight to the settled
// 轮空 · 直接晋级 state -- see runReveal.
const FMP_BYE_DELAY_MS = 1000;

// How many of this tournament's matchups THIS browser page has genuinely
// watched play through runReveal below. Deliberately module scope, not
// component state: App.jsx mounts FinalMatchupsStage/SpectatorPage
// conditionally by route, so navigating this tab away (e.g. to 锦标赛大厅)
// and back is a real unmount + remount, and component state/refs do not
// survive that. This does, for the life of the page (a hard reload resets
// it, which is fine -- there is no unrevealed animation left to protect at
// that point).
//
// null = never bootstrapped (this stage's very first mount since the page
// loaded). Whatever matchups already exist right then predate this viewing
// session entirely -- there is no reveal being skipped, so they are shown
// as-is, exactly as before this fix, and that snapshot becomes the trusted
// baseline. Every matchup beyond that baseline, for the rest of this page's
// life, is only ever shown after runReveal has genuinely played it -- on
// first arrival and on every remount after that -- so a person can never
// see a rolled result before its own animation has finished, no matter how
// many times they switch away and back mid-roll.
let fmpRevealWatermark = null;

const FMP_ANIM_CSS = `
@keyframes fmpCountPulse{0%{transform:scale(2.3);opacity:0;}25%{opacity:1;}100%{transform:scale(.65);opacity:0;}}
@keyframes fmpRingPulse{0%{transform:scale(.5);opacity:.9;}100%{transform:scale(1.7);opacity:0;}}
@keyframes fmpFlicker{0%,100%{opacity:1;filter:none;}20%{opacity:.22;filter:blur(1.5px);}45%{opacity:1;filter:none;}70%{opacity:.32;filter:blur(2px) hue-rotate(25deg);}100%{opacity:1;filter:none;}}
@keyframes fmpNameSlam{0%{opacity:0;letter-spacing:.6em;filter:blur(12px);transform:scale(.8);}55%{opacity:1;}100%{opacity:1;letter-spacing:normal;filter:blur(0);transform:scale(1);}}
@keyframes fmpVsPop{0%{opacity:0;transform:scale(.3) rotate(-10deg);}55%{opacity:1;transform:scale(1.35) rotate(5deg);}100%{opacity:1;transform:scale(1) rotate(0deg);}}
@keyframes fmpSlamIn{0%{opacity:0;transform:translateY(16px) scale(.94);filter:blur(6px);}60%{opacity:1;filter:blur(0);}100%{opacity:1;transform:translateY(0) scale(1);}}
@keyframes fmpRowIn{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}
@keyframes fmpFlashBurst{0%{opacity:0;}10%{opacity:1;}100%{opacity:0;}}
@keyframes fmpFrameGlow{0%{box-shadow:0 0 0 0 rgba(124,92,255,0);}35%{box-shadow:0 0 70px rgba(124,92,255,.6),0 0 120px rgba(34,229,255,.32);}100%{box-shadow:0 0 0 0 rgba(124,92,255,0);}}
@keyframes fmpSubIn{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:translateY(0);}}
@keyframes fmpChipIn{from{opacity:0;transform:translateY(6px) scale(.92);}to{opacity:1;transform:translateY(0) scale(1);}}
@media (prefers-reduced-motion: reduce) {
  #fmpStage2, #fmpStage2 * { animation-duration: 0.001ms !important; animation-delay: 0s !important; }
}
`;

// Ornate corner-bracket "broadcast frame" around a featured VS pair --
// purely decorative chrome around content that's already centered in the
// spotlight card; doesn't add or move any layout region. `pulse` plays a
// one-shot glow burst (keyed by the caller) the instant a match locks in.
// Light Mode fix: background used to be a literal near-black
// (rgba(6,7,15,.35)) that never adapted, so TeamFace's team-name/CAPTAIN
// text -- already using theme tokens (text-ink-primary/text-ink-faint)
// -- rendered dark-on-dark-forced-panel in light mode (this is the bug
// from the screenshot). Background is now --color-panel at a fixed
// opacity, so it's a light frosted panel in light mode and close to the
// original look in dark mode. Border stays accent-colored (brand
// identity) but via the --color-accent token so it's Cyber-Teal in
// light instead of literal purple sitting harshly on a light panel. The
// four corner brackets keep their per-caller `glowColor` (still literal
// cyan/purple hex -- that's Draft Arena's fixed brand accent, not a
// legibility issue) but pick up a `fmp-corner` class that softens their
// opacity slightly in light mode only (see index.css) so full-strength
// neon corners don't read as harsh against a light panel.
// Bug fix, by explicit report: the border here used to be
// `rgb(var(--color-accent) / .35)` -- Cyber-Teal's accent token at 35%
// opacity, which reads as a barely-there hairline in both themes (teal
// on a light panel is low-contrast to begin with, and the same 35%-alpha
// purple nearly disappears into the dark panel/void gradient behind it
// in dark mode). Replaced with explicit, theme-branched Tailwind
// classes instead of a theme-token color: a visibly solid slate/violet
// border plus a real shadow in light mode, and a slate border with a
// soft violet glow-outline in dark mode -- both meaningfully more
// visible than the old flat 35%-alpha line regardless of theme.
// The four glowing corner brackets themselves, factored out of
// BroadcastFrame so the completed Final Lineup grid's cards can use the
// exact same HUD-frame accent, by explicit request (previously only the
// single-match spotlight above had it). `size` controls both the bracket
// arm length (`w/h`) and its offset past the card edge (`-inset`), since a
// smaller card reads better with a proportionally smaller bracket.
function CornerBrackets({ glowColor = "rgba(34,229,255,.9)", size = 20 }) {
  const inset = -Math.round(size / 5);
  const style = { borderColor: glowColor, width: size, height: size };
  return (
    <>
      {[
        `border-t-2 border-l-2 rounded-tl-md`,
        `border-t-2 border-r-2 rounded-tr-md`,
        `border-b-2 border-l-2 rounded-bl-md`,
        `border-b-2 border-r-2 rounded-br-md`,
      ].map((cls, i) => (
        <span key={i} className={`fmp-corner absolute ${cls} pointer-events-none`}
          style={{
            ...style,
            top: i < 2 ? inset : undefined, bottom: i >= 2 ? inset : undefined,
            left: i % 2 === 0 ? inset : undefined, right: i % 2 === 1 ? inset : undefined,
          }} />
      ))}
    </>
  );
}

function BroadcastFrame({ children, pulse = false, glowColor = "rgba(34,229,255,.9)", chips = false }) {
  // `chips`: a teammate-chip row is present (TeamFace reserves its height, see
  // below), so the bottom padding is trimmed a little to keep the frame
  // visually balanced instead of reading bottom-heavy.
  return (
    <div className="relative w-full max-w-[980px] px-6 py-8 sm:px-10 sm:py-10 xl:px-12 rounded-2xl"
      style={{
        border: "1px solid rgb(var(--color-accent) / .35)",
        background: "rgb(var(--color-panel) / .6)",
        animation: pulse ? "fmpFrameGlow 1s ease-out" : undefined,
        paddingBottom: chips ? 26 : undefined,
      }}>
      <CornerBrackets glowColor={glowColor} />
      {children}
    </div>
  );
}


// Bug fix, by explicit report, follow-up: the gradient/`text-accent-soft`
// treatments below have both been reported low-contrast or otherwise
// wrong. Current rule, explicit and literal per request (not a theme
// token): dark mode is a solid `#40C2F0` -- no gradient -- and light
// mode is `text-violet-600`. Used for every "VS" in the app, including
// the small grid-card labels inside the completed Final Lineup list (not
// just the two big broadcast-animation instances) -- see call sites.
function VsLabel({ className = "", style, children = "VS" }) {
  return (
    <span
      className={`font-display font-black shrink-0 text-violet-600 dark:text-[#40C2F0] ${className}`}
      style={style}
    >
      {children}
    </span>
  );
}

// Team details for the spotlight (Final Matchups). A face is: captain
// Avatar, a primary title "队长 · <captain name>" (large, bold), a muted
// subtitle with the team name ("N号战队", from the team's idx -- the same
// name the draft stage's TeamCards use), and one chip per teammate
// underneath. From `xl` up the two faces sit side by side and the
// right one is an exact mirror (avatar outermost, text right-aligned, chips
// starting at the right edge and flowing toward the VS); below `xl` they
// stack and both align left, since a mirrored layout means nothing there.
//
// Layout stability: the chip row reserves ceil(members / CHIPS_PER_ROW) rows
// of height (what a typical team actually needs). While the teams are
// rolling (`hideChips`) the row keeps that reserved height but draws nothing
// -- by explicit request, since dashed placeholder pills looked noisy
// mid-shuffle -- so the frame is already the right height when the real
// chips cascade in and nothing jumps. Every team in a tournament is the same
// size, so the height also stays constant from match to match.
//
// `team.members` is absent on snapshots taken before this existed (a
// tournament already at Final Matchups) -- those faces simply have no chip
// row, never an empty gap.
//
// CHIPS_PER_ROW=4 (was an implicit /3, sized for the old, roomier chip):
// by explicit request, at least 4 teammate tags should fit on one row before
// wrapping. Tightened alongside CHIP_GAP and TeammateChip's own padding/icon/
// max-width below to make the width, not just this constant, actually
// deliver 4 -- this constant only affects the *reserved height* estimate
// used above; TeammateChip's real, independent flex-wrap is what decides
// wrapping. Verified against real 2-4 character member names (this app's
// typical case, matching every sample tournament used throughout
// development) at the narrowest real card width: the completed Final
// Lineup grid's two-per-row layout (`min-[1900px]:grid-cols-2`), where a
// face's chip row is ~312px wide -- the tightest a chip row gets anywhere in
// this file. Four chips fit on one row there, including one truncated at
// CHIP_MAX_W. Uncommonly long member names (5+ CJK characters *each*, on
// every one of the 4) can still wrap to a second row -- an inherent width
// limit, not a bug -- CHIP_ROW_H's reservation still accounts for that via
// the same ceil() math, just against 4 instead of 3.
const CHIPS_PER_ROW = 4;
const CHIP_ROW_H = 28;
const CHIP_GAP = 5;
const CHIP_MAX_W = 96;

function chipInitial(name) {
  const ch = Array.from(String(name || "").trim())[0];
  return ch ? ch.toUpperCase() : "?";
}

function hasChipRow(...teams) {
  return teams.some((t) => Array.isArray(t?.members) && t.members.length > 0);
}

function TeammateChip({ name, animateIn = false, delay = 0 }) {
  const hue = hashSeed(name) % 360;
  return (
    <span
      className="inline-flex items-center gap-1 h-7 pl-1 pr-2 rounded-full text-xs leading-tight"
      style={{
        // Reverted at the owner's request to the originally previewed styling
        // (--color-panel-line at .55). A stronger --color-ink-muted at .6 was
        // tried first, for visibility, and deliberately rolled back -- don't
        // "fix" this back without asking.
        border: "1px solid rgb(var(--color-panel-line) / .55)",
        background: "rgb(var(--color-panel-alt) / .7)",
        maxWidth: CHIP_MAX_W,
        animation: animateIn ? `fmpChipIn .32s cubic-bezier(.2,.8,.2,1) ${delay}ms both` : undefined,
      }}
    >
      <span
        className="w-[18px] h-[18px] rounded-md shrink-0 flex items-center justify-center text-[10px] font-bold text-white"
        style={{ background: `linear-gradient(135deg, hsl(${hue} 65% 55%), hsl(${(hue + 40) % 360} 65% 42%))` }}
      >
        {chipInitial(name)}
      </span>
      <span className="truncate min-w-0 text-ink-primary">{name}</span>
    </span>
  );
}

function TeamFace({ team, side = "left", dim = false, animateIn = false, hideChips = false }) {
  const right = side === "right";
  const unknown = !team;
  const members = !unknown && Array.isArray(team.members) && team.members.length > 0 ? team.members : null;
  const rows = members ? Math.ceil(members.length / CHIPS_PER_ROW) : 0;
  return (
    <div className={`relative w-full max-w-[340px] xl:flex-1 xl:min-w-0 transition-opacity ${dim ? "opacity-40" : ""}`}>
      <div className={`flex items-center gap-4 ${right ? "xl:flex-row-reverse xl:text-right" : ""}`}>
        <Avatar avatarUrl={team?.captainAvatarUrl} size={72} glow />
        <div className="min-w-0 flex-1">
          {/* Primary title: "队长 · <captain name>". It carries the existing name-slam. The
              队长 word keeps the literal VsLabel-matched colors (see VsLabel's comment) -- that
              color rule predates this layout and still applies. The name is --ink-primary
              (white in dark mode), not a literal white, so it stays legible on the light panel. */}
          <div className="font-display font-bold text-2xl leading-tight text-ink-primary truncate"
            style={animateIn ? { animation: "fmpNameSlam .6s cubic-bezier(.2,.8,.2,1) forwards", textShadow: "0 0 26px rgba(34,229,255,.55)" } : undefined}>
            {unknown ? "？？？" : (
              <>
                <span className="text-violet-600 dark:text-[#40C2F0]">队长</span>
                <span className="font-normal text-ink-muted"> · </span>
                {team.captainName}
              </>
            )}
          </div>
          {/* Secondary: the team name, smaller and muted. */}
          {!unknown && (
            <div className="mt-1 text-[13px] font-semibold tracking-wide text-ink-muted truncate"
              style={animateIn ? { animation: "fmpSubIn .35s ease .2s both" } : undefined}>
              {team.idx + 1}号战队
            </div>
          )}
        </div>
      </div>
      {members && (
        <div className={`flex flex-wrap content-start mt-4 ${right ? "xl:flex-row-reverse" : ""}`}
          style={{ gap: CHIP_GAP, minHeight: rows * CHIP_ROW_H + (rows - 1) * CHIP_GAP }}>
          {!hideChips && members.map((m, i) => (
            <TeammateChip key={`${m.id ?? m.name}-${i}`} name={m.name} animateIn={animateIn} delay={320 + i * 60} />
          ))}
        </div>
      )}
    </div>
  );
}

// Row holding [face] [VS] [face]. Side by side from `xl`, stacked below.
function FaceRow({ children, center = false, style }) {
  return (
    <div className={`w-full flex flex-col items-center gap-5 xl:flex-row xl:items-start xl:gap-8 ${center ? "xl:justify-center" : "xl:justify-between"}`} style={style}>
      {children}
    </div>
  );
}

// The VS (or 轮空 pill) is pinned to the avatar row (72px), not centered on the
// whole face, so it never shifts when a chip row appears, wraps, or is absent.
function VsSlot({ children }) {
  return <div className="shrink-0 flex items-center justify-center xl:h-[72px] xl:min-w-[70px]">{children}</div>;
}

// The countdown-less part of the reveal (flicker + settle): two faces, VS.
function RevealDuel({ reveal, teamByIdx, displayMatches }) {
  const isReveal = reveal.phase === "reveal";
  const match = displayMatches[reveal.idx];
  const teamA = isReveal ? teamByIdx.get(match?.a) : reveal.flickerA;
  const teamB = isReveal ? teamByIdx.get(match?.b) : reveal.flickerB;
  return (
    <BroadcastFrame pulse={isReveal} glowColor={isReveal ? "#7C5CFF" : "#22E5FF"} chips={hasChipRow(teamA, teamB)}>
      <FaceRow key={reveal.phase} style={{ animation: reveal.phase === "flicker" ? "fmpFlicker .35s ease-in-out infinite" : undefined }}>
        <TeamFace team={teamA} side="left" hideChips={!isReveal} animateIn={isReveal} />
        <VsSlot>
          <VsLabel
            className="text-2xl sm:text-3xl"
            style={isReveal ? { animation: "fmpVsPop .5s cubic-bezier(.2,.8,.2,1) forwards" } : undefined}
          />
        </VsSlot>
        <TeamFace team={teamB} side="right" hideChips={!isReveal} dim={isReveal && match?.b == null} animateIn={isReveal} />
      </FaceRow>
    </BroadcastFrame>
  );
}

// Redesigned, by explicit request, to the same row anatomy as
// AdminDashboard.jsx's/TournamentLobby.jsx's own sidebar rows
// (RailAction, the nav tabs): borderless, state shown by background
// color only -- never a border -- with an 8px squircle avatar instead of
// a glowing circular one. Previewed against a live mockup of the whole
// rail before being built (see DEVLOG Section 8); the two open questions
// from that preview were decided in the author's favor, both flagged as
// the recommended option there: 220px rail width (was 280px) and a solid
// gradient fill for the selected state (was an outline). `team`/`status`/
// `selected`/`onClick` and all click behavior are unchanged.
// Original dot-only indicator, restored by explicit request (an
// intermediate version swapped the dot for an `x` + danger-hover styling
// as an affordance for click-to-remove; that visual is gone again, but
// the row stays clickable for staff on a matched team -- see
// FinalMatchupsStage's matchOfTeam/requestRemoveMatch just below, which
// now opens a confirm dialog instead of removing immediately).
function RosterRow({ team, status, selected, onClick }) {
  const isUsed = status !== "idle";
  const clickable = !!onClick;
  const Tag = clickable ? "button" : "div";
  return (
    <Tag type={clickable ? "button" : undefined} onClick={onClick} disabled={clickable ? undefined : true}
      className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-colors ${
        selected ? "bg-accent-gradient text-void shadow-accent-glow"
          : isUsed ? "bg-accent2/8 text-accent2 hover:bg-accent2/13"
          : "text-ink-muted"
      } ${clickable ? "cursor-pointer hover:bg-panel-alt" : ""}`}>
      <Avatar avatarUrl={team.captainAvatarUrl} size={26} />
      <span className="flex-1 min-w-0 truncate text-xs font-heading font-semibold">
        {teamLabel(team)}
      </span>
      {isUsed && status !== "bye" && !selected && (
        <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-accent2" aria-hidden="true" />
      )}
      {/* Glowing accent pill instead of the old plain gray badge
          (bg-panel-2/70 text-ink-muted), by explicit request -- matches
          the accent2 border/bg/text + shadow-accent-glow treatment
          already used for the 轮空 · 直接晋级 pill on the spotlight below. */}
      {status === "bye" && (
        <span className={`shrink-0 text-[8px] font-bold px-1.5 py-0.5 rounded-md border ${
          selected ? "border-void/30 bg-void/20 text-void" : "border-accent2/50 bg-accent2/10 text-accent2 shadow-accent-glow"
        }`}>轮空</span>
      )}
    </Tag>
  );
}

// For the relocated 对阵操作 buttons below (moved from a horizontal bar
// under the spotlight into the rail, by explicit request). Deliberately
// NOT a change to `DraftAction` above -- that component is shared with
// the Draft Captain/Player header's own buttons (撤销, elsewhere in this
// file), a different stage this request never named, and its own comment
// already explains why it still carries a border: this app's established
// pattern is to give each rail/section its own copy of a shared button
// rather than let two unrelated areas drift together through one shared
// component. This one matches TournamentLobby.jsx's current `RailAction`
// exactly (the borderless restyle it already went through -- see its own
// comment) instead of `DraftAction`'s older bordered look, since these
// buttons now live in a rail styled to match Admin/Lobby and a bordered
// button directly under borderless `RosterRow` rows would have
// visibly clashed with that.
function FmpRailAction({ icon: IconCmp, label, onClick, disabled, tone = "default", title }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-heading font-semibold tracking-wide transition disabled:opacity-50 disabled:pointer-events-none ${
        tone === "danger" ? "text-ink-muted hover:text-danger hover:bg-danger/5" : "text-ink-muted hover:text-ink-primary hover:bg-panel-alt"
      }`}>
      <IconCmp className="w-4 h-4 shrink-0" />
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}


export function FinalMatchupsStage({ tournamentName, teams, matchups, isStaff, onEnded = () => {} }) {
  const initialMatches = useMemo(() => matchups.map((m) => ({ a: m.a, b: m.b, locked: !!m.locked })), []); // eslint-disable-line react-hooks/exhaustive-deps

  // See fmpRevealWatermark's own comment above. Bootstrap it on this
  // stage's very first-ever mount only; every later mount (a genuine
  // remount, from navigating away and back) trusts what the mount before
  // it left behind instead of re-trusting whatever is on screen right
  // now -- that re-trusting is exactly the bug being fixed. Also clamp it
  // down to what currently exists: a reset/new tournament can genuinely
  // be shorter than the last thing watched.
  if (fmpRevealWatermark === null) fmpRevealWatermark = initialMatches.length;
  fmpRevealWatermark = Math.min(fmpRevealWatermark, initialMatches.length);
  const watermarkAtMount = useRef(fmpRevealWatermark).current;

  const [displayTeams, setDisplayTeams] = useState(teams);
  // Seeded from the watermark, not from `initialMatches` directly: only
  // matches this page has actually watched reveal are shown right away.
  // Anything beyond that is picked up by the live-sync effect below
  // (`matchups.length > displayMatchesRef.current.length`) and played
  // through runReveal exactly as a brand-new live roll would be.
  const [displayMatches, setDisplayMatches] = useState(() => initialMatches.slice(0, watermarkAtMount));
  const [selected, setSelected] = useState([]);
  const [featuredIdx, setFeaturedIdx] = useState(() => {
    if (watermarkAtMount === 0) return null;
    const shown = initialMatches.slice(0, watermarkAtMount);
    return computeComplete(shown, teams) ? null : watermarkAtMount - 1;
  });
  const [reveal, setReveal] = useState(null); // { idx, phase: 'countdown'|'flicker'|'reveal', n, flickerA, flickerB }
  const [busyAction, setBusyAction] = useState(null);
  const [error, setError] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  // {idx, aName, bName} of the matchup a staff member just clicked a
  // team of, awaiting confirmation -- by explicit request, click-to-remove
  // (see matchOfTeam/requestRemoveMatch below) no longer removes immediately.
  const [confirmRemoveIdx, setConfirmRemoveIdx] = useState(null);

  const revealingRef = useRef(false);
  const displayMatchesRef = useRef(displayMatches);
  const pendingActionRef = useRef({ reset: null, end: null, remove: null });
  useEffect(() => { displayMatchesRef.current = displayMatches; }, [displayMatches]);
  // Bug fix, by explicit report: a real match's own reveal (RevealDuel,
  // settled "reveal" phase) already animates that match's teams/chips/VS
  // in and holds them still. Right after, runReveal calls
  // `setReveal(null)`, which switches the render from RevealDuel to the
  // "featured" branch further down -- a *different* element in the tree,
  // so React mounts it fresh, and that branch's own `fmpSlamIn` entrance
  // animation plays too, for the exact same match that was just shown.
  // The result was a visible second, shorter pop -- "shows for 1s in the
  // reveal, then flashes again for well under a second" (the owner's
  // report), on every real match, immediately after its own hold. This
  // ref/read pair suppresses just that one redundant entrance: runReveal
  // sets it to `true` right before its own `setReveal(null)` (see the
  // real-match branch below), the featured branch reads it once per
  // render to decide whether to skip `fmpSlamIn` this time, and the
  // `useLayoutEffect` (not a plain read-and-reset here in the render body)
  // resets it back to `false` right after that render commits -- doing
  // the reset in an effect, not inline during render, keeps this correct
  // under StrictMode's double-invoked render bodies in development (an
  // inline reset would get consumed by the throwaway first pass, leaving
  // the real, committed render with the flag already cleared). A bye's
  // own entrance into the featured branch never sets this flag (it has no
  // preceding RevealDuel animation to have already played), so a bye's
  // `fmpSlamIn` is untouched and still plays normally.
  const skipFeaturedPopRef = useRef(false);
  const skipFeaturedPop = skipFeaturedPopRef.current;
  useLayoutEffect(() => { skipFeaturedPopRef.current = false; });

  const teamByIdx = useMemo(() => new Map(displayTeams.map((t) => [t.idx, t])), [displayTeams]);
  const usedIdxs = useMemo(() => computeUsedIdxs(displayMatches), [displayMatches]);
  const remaining = useMemo(() => displayTeams.filter((t) => !usedIdxs.has(t.idx)), [displayTeams, usedIdxs]);
  const byeIdxs = useMemo(() => new Set(displayMatches.filter((m) => m.a != null && m.b == null).map((m) => m.a)), [displayMatches]);
  // idx -> that team's match index, for the 参赛战队 rail's click-to-remove
  // (replaces the old filmstrip + featuredIdx-based 解除本场对阵 button).
  const matchOfTeam = useMemo(() => {
    const m = new Map();
    displayMatches.forEach((match, i) => {
      if (match.a != null) m.set(match.a, i);
      if (match.b != null) m.set(match.b, i);
    });
    return m;
  }, [displayMatches]);
  const complete = displayMatches.length > 0 && remaining.length === 0;

  // If another connected admin locks/pairs/rolls a team this client
  // currently has selected in the pairing pool (e.g. two admins working
  // the casting pool at once), drop it from the selection instead of
  // leaving a stale idx sitting there that would just fail server-side
  // the moment 定角锁定/随机生成剩余对阵 is clicked.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.length === 0) return prev;
      const stillFree = new Set(remaining.map((t) => t.idx));
      const next = prev.filter((idx) => stillFree.has(idx));
      return next.length === prev.length ? prev : next;
    });
  }, [remaining]);

  // Plays the countdown -> flicker -> settle sequence for one or more
  // newly-appended matches, one at a time, entirely via React state.
  // Used both when this client itself triggers a roll (fed the RPC's own
  // result) and when Realtime reports another client's roll (fed that
  // update's resolved teams/matchups) -- either way the viewer sees the
  // exact same show instead of the result just snapping into place.
  async function runReveal(appended, startIdx, finalMatches, labelTeams) {
    if (appended.length === 0) { setDisplayMatches(finalMatches); return; }
    revealingRef.current = true;
    for (let k = 0; k < appended.length; k++) {
      const idx = startIdx + k;
      if (appended[k].b == null) {
        // Deterministic bye -- no countdown, no flicker (see
        // FMP_BYE_DELAY_MS above). `reveal` stays null for this whole
        // step, so the spotlight shows nothing new during the pause
        // (whichever match was on screen a moment ago just holds); then
        // the bye's own data and featuredIdx commit together (both
        // setState calls land in the same batch, so there's no frame
        // where featuredIdx points at an index displayMatches doesn't
        // have yet), and the ordinary `featured`/lineupView render path
        // (further down this file) draws the settled 轮空 · 直接晋级 state
        // immediately -- the exact same state a real match's reveal
        // would land on, just without playing a show to get there.
        //
        // Reverted, by explicit request: a short-lived version of this
        // branch tried to special-case a *terminal* bye (one that
        // completes the whole lineup) by committing `featuredIdx(null)`
        // directly here instead of `featuredIdx(idx)`, to avoid it
        // showing once in the single-match spotlight and then again a
        // moment later in the completed grid. That turned out not to be
        // the actual double-render the owner was seeing (see the
        // "no-op re-render" bug fix a few lines below runReveal's own
        // closing brace, which is the real cause and the real fix) --
        // so this bye branch is back to its original, simpler form:
        // always spotlight the bye at `idx`, exactly like a real match,
        // and let the ordinary post-loop `computeComplete` check (below)
        // decide when to hand off to the grid, same as it always has.
        await fmpWait(FMP_BYE_DELAY_MS);
        setDisplayMatches((prev) => { const next = prev.slice(); next[idx] = appended[k]; return next; });
        setFeaturedIdx(idx);
        fmpRevealWatermark = Math.max(fmpRevealWatermark, idx + 1);
        await fmpWait(FMP_HOLD_MS);
        continue;
      }
      setFeaturedIdx(idx);
      for (const n of [3, 2, 1]) { setReveal({ idx, phase: "countdown", n }); await fmpWait(FMP_COUNT_STEP_MS); }
      const rollFrames = Math.floor(FMP_ROLL_MS / FMP_ROLL_FRAME_MS);
      for (let f = 0; f < rollFrames; f++) {
        const flickerA = labelTeams[Math.floor(Math.random() * labelTeams.length)] || null;
        const flickerB = labelTeams[Math.floor(Math.random() * labelTeams.length)] || null;
        setReveal({ idx, phase: "flicker", flickerA, flickerB });
        // Last frame holds for whatever is left, so the roll totals FMP_ROLL_MS exactly.
        await fmpWait(f === rollFrames - 1 ? FMP_ROLL_MS - FMP_ROLL_FRAME_MS * (rollFrames - 1) : FMP_ROLL_FRAME_MS);
      }
      setDisplayMatches((prev) => { const next = prev.slice(); next[idx] = appended[k]; return next; });
      setReveal({ idx, phase: "reveal" });
      await fmpWait(FMP_REVEAL_MS);
      // This matchup's own reveal has now genuinely played for this
      // viewer -- advance the durable watermark so a remount (switching
      // this tab away and back) never has to re-hide it.
      fmpRevealWatermark = Math.max(fmpRevealWatermark, idx + 1);
      // Still hold on the finished result before rolling the next matchup
      // -- unconditionally, including after the last one in this batch, so
      // the final rolled result gets the same pause as every other one
      // before the stage settles. FMP_REVEAL_HOLD_MS, not FMP_HOLD_MS: see
      // both constants' own comments above -- this one is a full 1000ms by
      // explicit request, so a real match's whole on-screen dwell
      // (FMP_REVEAL_MS + FMP_REVEAL_HOLD_MS) gives a full second of static
      // read time after the ~900ms entrance, not the rushed 100ms this
      // regressed to briefly.
      await fmpWait(FMP_REVEAL_HOLD_MS);
      // See skipFeaturedPopRef's own comment, near the other refs above:
      // this real match's reveal already animated it in and held it, so
      // the upcoming switch to the "featured" branch (which happens the
      // instant `reveal` clears, right below) should not play its own
      // separate entrance pop for the same match.
      skipFeaturedPopRef.current = true;
      setReveal(null);
    }
    setDisplayMatches(finalMatches);
    setFeaturedIdx((prev) => (computeComplete(finalMatches, labelTeams) ? null : prev));
    revealingRef.current = false;
  }

  // Live-sync whenever `matchups`/`teams` change (Realtime -- another
  // connected admin locked/rolled/removed/reset, or this stage just
  // mounted with a tournament already in progress). A pure append (more
  // entries than we're currently showing) means a roll just happened
  // somewhere -- replay it via runReveal instead of snapping straight to
  // the end state. Anything else (manual pair already applied locally,
  // a removal, a reset) syncs directly.
  useEffect(() => {
    if (revealingRef.current) return;
    const newMatches = matchups.map((m) => ({ a: m.a, b: m.b, locked: !!m.locked }));
    const prevLen = displayMatchesRef.current.length;
    setDisplayTeams(teams);
    if (newMatches.length > prevLen) {
      runReveal(newMatches.slice(prevLen), prevLen, newMatches, teams);
    } else {
      // Bug fix, by explicit report: a shrink (重置's full clear, or a
      // single 解除本场对阵 removal) means whatever fmpRevealWatermark
      // was tracking no longer all exists -- clamp it down live, right
      // here, not just once at mount against a frozen snapshot. Without
      // this, resetting and re-rolling within the SAME mounted session
      // left the watermark sitting at the prior (now-gone) roll's count;
      // a later remount mid the NEW roll then wrongly trusted that stale
      // number against the new roll's own already-resolved data and
      // skipped straight to its final result. This also correctly covers
      // a single manual removal: if a freed slot gets a different
      // matchup later, that one must still play its own full reveal
      // rather than inheriting the removed matchup's trust.
      fmpRevealWatermark = Math.min(fmpRevealWatermark, newMatches.length);
      setDisplayMatches(newMatches);
      const nowComplete = computeComplete(newMatches, teams);
      setFeaturedIdx((prev) => {
        if (newMatches.length === 0) return null;
        if (nowComplete) return null;
        return Math.min(prev ?? newMatches.length - 1, newMatches.length - 1);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchups, teams]);

  async function withBusy(action, fn) {
    setBusyAction(action);
    setError(null);
    try { await fn(); }
    catch (err) { setError(err?.message || "操作失败，请重试"); }
    finally { setBusyAction(null); }
  }

  function toggleSelect(idx) {
    setSelected((prev) => (prev.includes(idx) ? prev.filter((x) => x !== idx) : [...prev, idx]));
  }

  // 定角锁定 -- exactly 2 selected: hand-pick and lock that pair
  // immediately, no countdown (a deliberate pick, not a random one).
  // 3+ selected: hands off to Random Roll scoped to that exact group.
  async function handleLockOrRoll() {
    if (selected.length < 2 || busyAction || reveal) return;
    if (selected.length > 2) { await handleRoll(); return; }
    const [idxA, idxB] = selected;
    await withBusy("pair", async () => {
      const result = await createManualMatchup(idxA, idxB);
      setSelected([]);
      const newTeams = result.teams && result.teams.length > 0 ? result.teams : teams;
      const newMatches = (result.matchups || []).map((m) => ({ a: m.a, b: m.b, locked: !!m.locked }));
      setDisplayTeams(newTeams);
      setDisplayMatches(newMatches);
      setFeaturedIdx(computeComplete(newMatches, newTeams) ? null : newMatches.length - 1);
    });
  }

  // Random Roll -- scoped to the current pool selection, or every free
  // team when nothing's selected. The RPC resolves server-side; this
  // just plays that resolved result back one match at a time.
  async function handleRoll() {
    if (busyAction || reveal || complete) return;
    const poolIdxs = selected.length > 0 ? selected.slice() : null;
    if (!poolIdxs && remaining.length < 1) return;
    await withBusy("roll", async () => {
      const beforeLen = displayMatchesRef.current.length;
      const result = await rollTournamentMatchupsPool(poolIdxs);
      setSelected([]);
      const newTeams = result.teams && result.teams.length > 0 ? result.teams : teams;
      const newMatches = (result.matchups || []).map((m) => ({ a: m.a, b: m.b, locked: !!m.locked }));
      setDisplayTeams(newTeams);
      await runReveal(newMatches.slice(beforeLen), beforeLen, newMatches, newTeams);
    });
  }

  // Takes an explicit match index (the 参赛战队 rail passes the clicked
  // team's own match, via matchOfTeam) rather than implicitly reading
  // featuredIdx -- there is no more filmstrip/button to have set it, by
  // explicit request; featuredIdx now only ever tracks which match the
  // build-in-progress spotlight is currently showing.
  async function handleRemoveMatch(idx) {
    if (idx == null || busyAction || reveal) return;
    await withBusy(`remove:${idx}`, async () => {
      const result = await removeTournamentMatchup(idx);
      const newTeams = result.teams && result.teams.length > 0 ? result.teams : teams;
      const newMatches = (result.matchups || []).map((m) => ({ a: m.a, b: m.b, locked: !!m.locked }));
      setDisplayTeams(newTeams);
      setDisplayMatches(newMatches);
      setFeaturedIdx(newMatches.length > 0 ? Math.min(idx, newMatches.length - 1) : null);
    });
  }

  // Rail click on a matched team (either side of a pair, or a bye) no
  // longer removes immediately, by explicit request: it opens a confirm
  // dialog first, same idiom as 重置/结束锦标赛 just below (a
  // pendingActionRef slot set here, actually run from onConfirm). Reads
  // team names fresh off displayMatches/teamByIdx at click time so the
  // dialog's own message can name both teams.
  function requestRemoveMatch(idx) {
    if (idx == null || busyAction || reveal) return;
    const match = displayMatches[idx];
    if (!match) return;
    pendingActionRef.current.remove = () => handleRemoveMatch(idx);
    setConfirmRemoveIdx(idx);
  }

  function handleResetClick() {
    if (busyAction || reveal) return;
    pendingActionRef.current.reset = () => withBusy("reset", async () => {
      const result = await resetTournamentMatchups();
      setDisplayTeams(result.teams && result.teams.length > 0 ? result.teams : teams);
      setDisplayMatches([]);
      setFeaturedIdx(null);
      setSelected([]);
    });
    setConfirmReset(true);
  }
  function handleEndClick() {
    if (busyAction || reveal) return;
    // Same fix, same reasoning, as handleProceed's own comment in
    // DraftArenaPage (进入最终对阵): call `onEnded()` directly off this
    // action's own success instead of relying solely on this table's
    // Realtime DELETE event reaching *this same client's* subscription --
    // that event still fires and still matters for every other connected
    // client (another staff tab, or Spectators on this page), it's just
    // no longer the only way *this* click ever takes visible effect.
    // Temp-player auto-cleanup below is intentionally best-effort and
    // silent: 结束锦标赛 itself already succeeded by this point, so a temp
    // account being left behind (removeTempParticipants failing, or there
    // simply being none to remove) must never surface as an error or block
    // onEnded() from firing. See DEVLOG.md's note on this tying to the
    // Temporary Testing Buttons feature.
    pendingActionRef.current.end = () => withBusy("end", async () => {
      await endTournament();
      await removeTempParticipants().catch(() => {});
      onEnded();
    });
    setConfirmEnd(true);
  }

  const featured = featuredIdx != null ? displayMatches[featuredIdx] : null;
  // The completed 对阵表已揭晓 list. featuredIdx is forced to null whenever the
  // lineup completes (see every setFeaturedIdx above), so this is simply
  // "complete, and no single match is being featured / rolled right now".
  const lineupView = complete && featuredIdx === null;
  const rollDisabled = busyAction || !!reveal || complete || (selected.length === 0 && remaining.length < 1);
  const lockDisabled = busyAction || !!reveal || selected.length < 2;

  return (
    <div id="fmpStage2" className="w-full flex flex-col flex-1 lg:min-h-0 lg:overflow-hidden">
      <style>{FMP_ANIM_CSS}</style>

      {/* Top status strip removed, by explicit request, to match Admin/
          Lobby's own layout -- neither has a header bar above their
          <aside>/main split either. Its two pieces of information both
          stay findable elsewhere: which match is on screen only matters
          while the lineup is still being built (the completed 对阵表已揭晓
          view shows every match at once), and during a build "reveal in
          progress" is directly visible in the spotlight itself
          (the countdown/roll/reveal it's already showing). `complete` is
          still read below (the spotlight's own "对阵表已揭晓" copy), so
          it's untouched even though this specific usage is gone. */}

      {/* body: roster + pairing rail, spotlight reveal as the dominant surface.
          Bug fix, by explicit report: the <aside> below was already
          `lg:w-[220px]`, textually identical to Admin/Lobby's own width,
          but this wrapper was missing the `gap-5 p-4 sm:p-5 lg:p-6`
          Lobby's equivalent wrapper carries -- Lobby puts that spacing on
          the page wrapper, outside its <aside>, while this one put
          spacing (px-4 sm:px-5 lg:px-4 py-4) directly ON the <aside>,
          which is subtracted from its own 220px (border-box). Same
          declared width, genuinely narrower usable content. Moved the
          spacing out to this wrapper, exactly where Lobby keeps it, so
          the two sidebars now match in both size and position, not just
          in the number in their className.
          Full-height pass: the wrapper no longer carries any vertical
          padding from `lg` up (`lg:px-6 lg:py-0`), so the main column
          below runs flush from the header to the page bottom. The rail's
          old top/bottom spacing moved onto the <aside> itself (`lg:py-6`,
          same on Admin/Lobby's asides) so the rails stay where they were.
          Same idea horizontally: no right padding and no gap from `lg`
          up, so the column runs flush against the rail and the viewport's
          right edge. The rail's old right-hand spacing (its 4px `pr-1`
          plus the 20px gap) moved onto the aside as `lg:pr-6`, and its
          declared width grew 220 -> 240 to compensate, so its usable
          content (216px) and the position of the column's left edge
          (264px from the page's left) are exactly what they were. */}
      <div className="flex-1 lg:min-h-0 flex flex-col lg:flex-row gap-5 lg:gap-0 p-4 sm:p-5 lg:pl-6 lg:pr-0 lg:py-0 overflow-y-auto lg:overflow-hidden">
        <aside className="lg:w-[240px] shrink-0 lg:h-full lg:overflow-y-auto lg:pr-6 lg:py-6 flex flex-col gap-1.5">
          <p className="eyebrow px-1 mb-0.5">参赛战队 · {displayTeams.length}</p>
          {displayTeams.map((t) => {
            const status = byeIdxs.has(t.idx) ? "bye" : usedIdxs.has(t.idx) ? "used" : "idle";
            const matchIdx = matchOfTeam.get(t.idx);
            return (
              <RosterRow key={t.idx} team={t} status={status}
                selected={selected.includes(t.idx)}
                onClick={
                  isStaff && status === "idle" ? () => toggleSelect(t.idx)
                    : isStaff && status !== "idle" ? () => requestRemoveMatch(matchIdx)
                    : undefined
                } />
            );
          })}

          {/* 对阵操作: relocated here from a horizontal bar under the
              spotlight, by explicit request, directly below the team
              list. Same handlers/disabled logic, unchanged -- only the
              container (vertical flex-col instead of a horizontal wrap)
              and the button component (FmpRailAction, borderless, see its
              own comment above) changed. Matches Lobby's own 赛事管理 block
              (its RailAction list + a trailing status line use exactly
              this shape). Down to four buttons now: 解除本场对阵 moved out
              of this list entirely, onto the roster rows above (click a
              matched team, or its `x`) -- see matchOfTeam/
              handleRemoveMatch, by explicit request. */}
          {isStaff && (
            <div className="mt-4 pt-4 border-t border-panel-line">
              <p className="eyebrow px-1 mb-2">对阵操作</p>
              <div className="flex flex-col gap-1.5">
                <FmpRailAction icon={DraftIcon.lock} label="定角锁定" onClick={handleLockOrRoll} disabled={lockDisabled} />
                <FmpRailAction icon={DraftIcon.dice} label="随机生成剩余对阵" onClick={handleRoll} disabled={rollDisabled} />
                <FmpRailAction icon={DraftIcon.refresh} label="重置" onClick={handleResetClick} disabled={busyAction || !!reveal} />
                <FmpRailAction icon={DraftIcon.flag} label="结束锦标赛" onClick={handleEndClick} disabled={busyAction || !!reveal} tone="danger" />
              </div>
              {(selected.length > 0 || remaining.length > 0) && (
                <p className="text-[11px] text-ink-muted mt-2 px-1">
                  {selected.length > 0 ? `已选择 ${selected.length} 支战队` : `未选择 · 将随机排位剩余 ${remaining.length} 支战队`}
                </p>
              )}
            </div>
          )}
        </aside>

        <div className="flex-1 lg:min-h-0 flex flex-col lg:overflow-hidden border-t lg:border-t-0 lg:border-l border-panel-line/35 px-5 sm:px-6 lg:px-0 py-4 lg:py-0 gap-4 lg:gap-0">
          {/* spotlight -- Light Mode fix: background/border used to be
              literal dark hex (#141833/#0a0c1c) that never adapted, so
              text using theme tokens (text-ink-primary etc.) went
              dark-on-dark-forced-container in light mode. Now built from
              --color-panel/--color-void/--color-accent(2), the same
              tokens the rest of the app themes through, so this surface
              is a light panel in light mode and the original dark
              gradient in dark mode (panel/void's dark-mode values are a
              close match to the old #141833/#0a0c1c). The purple radial
              wash and border stay accent-colored -- brand identity, not
              a legibility issue -- but now via --color-accent/accent2 so
              they resolve to the Cyber-Teal light identity instead of
              literal cyan/purple hex sitting harshly on a light panel. */}
          <div className={`relative flex-1 min-h-[380px] rounded-none border lg:border-0 flex justify-center p-8 sm:p-10 ${lineupView ? "overflow-y-auto items-start lg:px-6" : "overflow-hidden items-center"}`}
            style={{
              background: "radial-gradient(ellipse at 50% 0%, rgb(var(--color-accent) / .14), transparent 60%), linear-gradient(180deg, rgb(var(--color-panel)), rgb(var(--color-void)) 80%)",
              borderColor: complete ? "rgb(var(--color-accent2) / .35)" : "rgb(var(--color-accent) / .25)",
            }}>
            {reveal?.phase === "reveal" && (
              <div key={`flash-${reveal.idx}`} className="absolute inset-0 pointer-events-none"
                style={{
                  animation: "fmpFlashBurst .8s ease-out forwards",
                  /* Light Mode fix: the flash's hottest point used to be
                     literal white, which vanishes against a light panel.
                     --color-ink-primary is this theme's "brightest
                     legible" tone -- white in dark mode (unchanged from
                     before), near-black in light mode, so the burst
                     stays a visible, high-contrast pulse in both. */
                  background: "radial-gradient(circle at 50% 45%, rgb(var(--color-ink-primary) / .55), rgb(var(--color-accent) / .5) 30%, rgb(var(--color-accent2) / .3) 50%, transparent 72%)",
                }} />
            )}
            {lineupView ? (
              <div key={displayMatches.length} className="w-full max-w-[980px] lg:max-w-none my-auto flex flex-col items-center gap-6" style={{ animation: "fmpSlamIn .7s ease forwards" }}>
                <div className="text-center text-2xl sm:text-3xl font-heading font-bold uppercase tracking-[0.2em] text-accent2">对阵表已揭晓 · Final Lineup</div>
                {/* One full-width card per match, built from the same TeamFace/FaceRow/
                    VsSlot pieces as the single-match spotlight above so each card shows
                    exactly that layout: captain avatar, 队长 · name, N号战队, then the
                    teammate chips. No CornerBrackets here -- a short-lived version added
                    the spotlight's own glowing-cyan HUD corners to these cards too, by
                    explicit request; that was then reverted, also by explicit request, back
                    to a clean plain border. `CornerBrackets` itself stays defined and is
                    still used by `BroadcastFrame` above (the single-match spotlight), which
                    is unaffected -- only this grid's own usage was removed. */}
                <div className="w-full grid grid-cols-1 min-[1900px]:grid-cols-2 gap-4">
                  {displayMatches.map((m, i) => (
                    <div key={i} className="relative px-6 pt-8 pb-6 sm:px-8 xl:px-10 min-[1900px]:px-6 min-[1900px]:[&:nth-child(odd):last-child]:col-span-2 rounded-xl bg-panel-alt/50 border border-panel-line/35"
                      style={{ animation: "fmpRowIn .45s ease forwards", animationDelay: `${i * 110}ms`, opacity: 0 }}>
                      <span className="absolute top-3 left-4 text-[10px] font-mono text-accent2/70">0{i + 1}</span>
                      <FaceRow center={m.b == null}>
                        <TeamFace team={teamByIdx.get(m.a)} side="left" />
                        {m.b != null ? (
                          <>
                            <VsSlot><VsLabel className="text-2xl sm:text-3xl" /></VsSlot>
                            <TeamFace team={teamByIdx.get(m.b)} side="right" />
                          </>
                        ) : (
                          <VsSlot>
                            <span className="px-4 py-2 rounded-lg bg-accent2/10 border border-accent2/40 text-accent2 font-heading font-bold text-sm whitespace-nowrap">轮空 · 直接晋级</span>
                          </VsSlot>
                        )}
                      </FaceRow>
                    </div>
                  ))}
                </div>
              </div>
            ) : reveal ? (
              reveal.phase === "countdown" ? (
                <div key={reveal.n} className="relative flex items-center justify-center">
                  <span className="absolute w-48 h-48 sm:w-56 sm:h-56 rounded-full pointer-events-none"
                    style={{ border: "2px solid rgba(124,92,255,.5)", animation: "fmpRingPulse .6s ease-out forwards" }} />
                  <span className="absolute w-48 h-48 sm:w-56 sm:h-56 rounded-full pointer-events-none"
                    style={{ border: "2px solid rgba(34,229,255,.35)", animation: "fmpRingPulse .6s ease-out .12s forwards" }} />
                  <div className="font-display font-black text-ink-primary"
                    style={{ fontSize: 140, animation: "fmpCountPulse .6s cubic-bezier(.2,.8,.3,1) forwards", textShadow: "0 0 80px rgba(124,92,255,.9), 0 0 140px rgba(34,229,255,.5)" }}>
                    {reveal.n}
                  </div>
                </div>
              ) : (
                <RevealDuel reveal={reveal} teamByIdx={teamByIdx} displayMatches={displayMatches} />
              )
            ) : featured ? (
              <div key={featuredIdx} className="w-full flex flex-col items-center gap-6"
                style={skipFeaturedPop ? undefined : { animation: "fmpSlamIn .5s ease forwards" }}>
                <BroadcastFrame glowColor="rgba(124,92,255,.6)"
                  chips={hasChipRow(teamByIdx.get(featured.a), featured.b != null ? teamByIdx.get(featured.b) : null)}>
                  <FaceRow center={featured.b == null}>
                    <TeamFace team={teamByIdx.get(featured.a)} side="left" />
                    {featured.b != null ? (
                      <>
                        <VsSlot><VsLabel className="text-2xl sm:text-3xl" /></VsSlot>
                        <TeamFace team={teamByIdx.get(featured.b)} side="right" />
                      </>
                    ) : (
                      <VsSlot>
                        <span className="px-4 py-2 rounded-lg bg-accent2/10 border border-accent2/40 text-accent2 font-heading font-bold text-sm whitespace-nowrap">轮空 · 直接晋级</span>
                      </VsSlot>
                    )}
                  </FaceRow>
                </BroadcastFrame>
              </div>
            ) : (
              <div className="text-center text-ink-faint text-sm max-w-xs leading-relaxed">
                敬请期待首个对阵公布
                <br />
                手动配对或随机生成开启序幕
              </div>
            )}
          </div>

          {/* No MATCH 01/02/... filmstrip in any state, by explicit request --
              it's gone entirely, not just hidden once the lineup completes (an
              earlier version only did the latter, then still showed it while a
              lineup was being built). Removing a matchup now happens from the
              参赛战队 rail above instead (click a matched team, or its `x`; see
              matchOfTeam/handleRemoveMatch), which covers every state including
              mid-build, so no replacement control is needed here. */}

          {/* The 对阵操作 action bar that used to sit here (定角锁定,
              随机生成剩余对阵, 重置, 解除本场对阵, 结束锦标赛, plus the
              selection-status line) has moved into the rail, directly
              below the team list -- see the <aside> above, by explicit
              request. `DraftAction`/`DraftIcon` stay defined and are
              still used by the Draft Captain/Player header's own 撤销
              button elsewhere in this file. Of the original five calls,
              four moved here as-is; 解除本场对阵 moved onto the roster rows
              themselves instead (see matchOfTeam/handleRemoveMatch above),
              by explicit request. */}
        </div>
      </div>

      {error && (
        <div className="fixed bottom-6 right-6 z-50 bg-panel-alt/95 backdrop-blur border border-danger/40 shadow-[0_0_24px_rgba(255,77,109,0.2)] text-danger text-xs px-4 py-3 rounded-lg cursor-pointer"
          onClick={() => setError(null)}>
          ⚠ {error}（点击关闭）
        </div>
      )}

      {confirmReset && (
        <ConfirmDialog
          title="确认重置对阵"
          message="将清除所有已生成的对阵、所有锁定与所有手动配对，恢复到刚进入最终对阵时的空白状态。此操作无法撤销。"
          confirmLabel="确认重置"
          tone="danger"
          busy={busyAction === "reset"}
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => { setConfirmReset(false); pendingActionRef.current.reset?.(); }}
        />
      )}
      {confirmEnd && (
        <ConfirmDialog
          title="确认结束锦标赛"
          message="将结束当前锦标赛：清空所有参赛名单、已选战队与对阵数据，所有已连接用户都会被送回锦标赛大厅。若要参加下一届锦标赛，需要重新点击「参加比赛」。此操作无法撤销。"
          confirmLabel="确认结束"
          tone="danger"
          busy={busyAction === "end"}
          onCancel={() => setConfirmEnd(false)}
          onConfirm={() => { setConfirmEnd(false); pendingActionRef.current.end?.(); }}
        />
      )}
      {confirmRemoveIdx != null && (() => {
        const m = displayMatches[confirmRemoveIdx];
        const aName = m ? teamLabel(teamByIdx.get(m.a)) : "";
        const bName = m?.b != null ? teamLabel(teamByIdx.get(m.b)) : null;
        return (
          <ConfirmDialog
            title="确认解除本场对阵"
            message={bName
              ? `将解除「${aName}」与「${bName}」的对阵，两支战队都会回到未匹配状态。此操作无法撤销。`
              : `将解除「${aName}」的轮空，该战队会回到未匹配状态。此操作无法撤销。`}
            confirmLabel="确认解除"
            tone="danger"
            busy={busyAction === `remove:${confirmRemoveIdx}`}
            onCancel={() => setConfirmRemoveIdx(null)}
            onConfirm={() => { setConfirmRemoveIdx(null); pendingActionRef.current.remove?.(); }}
          />
        );
      })()}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   INITIAL STATE — teamCount, playersPerTeam, and roundOrders all come from
   the Tournament Lobby's Tournament Settings (锦标赛设置); captainCandidates
   and pool come from the Tournament Lobby's actual joined participants
   (tournament_participants, split by Team Role / 角色) -- both fetched by
   DraftArenaPage below. No team count / roster size / round count / player
   list is assumed here: the number of TeamCards, the number of roster
   slots per team, and every name in the Captain Pool / Player Pool all
   scale to whatever is currently configured and currently joined.

   This still only reflects participants as of when the Draft Arena page
   was opened (fetch-on-open, same as Tournament Settings -- Section 7);
   live updates while the page is already open are a later phase.
   ════════════════════════════════════════════════════════════════════════ */
function seedTournament(teamCount, playersPerTeam, roundOrders, captainCandidates, pool) {
  const rosterSlotCount = Math.max(0, (Number(playersPerTeam) || 0) - 1);
  return {
    ...initialTournament(roundOrders),
    teams: Array.from({ length: Math.max(0, Number(teamCount) || 0) }, () => ({
      captain: null,
      slots: Array.from({ length: rosterSlotCount }, () => null),
    })),
    captainCandidates: Array.isArray(captainCandidates) ? captainCandidates : [],
    pool: Array.isArray(pool) ? pool : [],
  };
}

// Fallback used only if Tournament Settings can't be loaded at all (e.g.
// the request fails) -- lets the page still render something usable
// instead of being stuck on "加载中…" forever. Not a design assumption
// about any particular tournament; matches fetchTournamentSettings()'s own
// fallback defaults (Section 7) so behavior is consistent either way.
const SETTINGS_LOAD_FALLBACK = { tournamentName: '', teamCount: 8, playersPerTeam: 5, draftOrder: null }

// Builds the draft's round-order strings (DraftArena's internal
// "12345678"-per-round format) from Tournament Settings: prefers the
// admin's actually-saved draftOrder (Section 7, Draft Order Settings)
// when it matches the current playersPerTeam's round count, otherwise
// falls back to the same default Snake Draft generator the settings
// dialog itself falls back to -- so this is never a hardcoded assumption,
// only ever a reflection of what's configured (or its documented default).
function buildRoundOrders(settings) {
  const rounds = draftRoundCount(settings.playersPerTeam)
  const source = Array.isArray(settings.draftOrder) && settings.draftOrder.length === rounds
    ? settings.draftOrder
    : generateSnakeDraft(settings.teamCount, settings.playersPerTeam)
  return source.map((round) => round.join(','))
}

// Tournament Participant Synchronization (Phase 5): the Captain Pool and
// Player Pool are built from the Tournament Lobby's real joined roster
// (fetchLobby() -- the exact same tournament_participants + accounts data
// the Lobby itself renders), split by Team Role (角色). Only participants
// who actually joined the tournament ever appear here; nobody else does,
// by construction of fetchLobby() itself. avatarId is intentionally
// omitted -- this project only has avatarUrl-or-default, no id-based
// avatar selection (see Avatar/SquareAvatar below).
function toDraftPlayer(participant) {
  return { id: participant.accountId, name: participant.displayName, avatarUrl: participant.avatarUrl, gender: participant.gender }
}

/* ════════════════════════════════════════════════════════════════════════
   DEFAULT EXPORT — a self-contained page: same outer background + font /
   scrollbar setup as the full Dashboard app shell, just without the
   Login/Register, Navigation, Admin Dashboard, or Lobby screens around it.

   Tournament Name / Number of Teams / Players per Team / Draft Order are
   read from the Tournament Lobby's Tournament Settings
   (fetchTournamentSettings(), Section 7), and the Captain Pool / Player
   Pool are read from the Tournament Lobby's real joined participants
   (fetchLobby(), Section 7) -- both fetched here on every mount, i.e.
   every time the Draft Arena is entered, it reflects whatever was most
   recently saved/joined in the Lobby. `tournament` starts with an empty
   `teams: []` (which the inner DraftArena renders as "加载中…") until both
   resolve, then is seeded to the real teamCount/playersPerTeam/
   roundOrders/captainCandidates/pool. Live, real-time synchronization
   while the Draft Arena is already open is a later phase -- this only
   guarantees "latest settings and roster as of opening the page". The
   Tournament Lobby's 开始比赛 button already validates the roster against
   Tournament Settings before ever navigating here (see TournamentLobby.jsx),
   so in the normal flow the pools this seeds with are never empty or
   mismatched in size -- but this page doesn't re-validate that itself.
   ════════════════════════════════════════════════════════════════════════ */
export default function DraftArenaPage({ onExitToLobby, account, onLogout, theme, onThemeChange }) {
  const [tournamentName, setTournamentName] = useState('')
  const [settingsMeta, setSettingsMeta] = useState({ teamCount: 0, playersPerTeam: 0 })
  const [tournament, setTournament] = useState(() => initialTournament([]))
  const [finalMatches, setFinalMatches] = useState(null) // { teams, matchups } | null
  const [stage, setStage] = useState('draft') // 'draft' | 'final'
  const [proceedError, setProceedError] = useState(null)
  // Phase 6 (Spectator Page): the *ephemeral* captain-candidate selection
  // (clicked but not yet assigned to a team) -- reported up from
  // DraftArena's own local `selectedCaptain` state via onSelectedCaptainChange
  // below, purely so it can be broadcast too (see the effect right after
  // this). Never used for anything else in DraftArenaPage itself.
  const [selectedCaptainId, setSelectedCaptainId] = useState(null)
  // Undo stack (DraftArena's own local `draftHistory`), reported up the
  // same way, purely so it can be broadcast/persisted too -- see
  // `seededDraftHistory`/`ready` below for the other half of this (feeding
  // a *resumed* history back in as DraftArena's own initial state).
  const [draftHistory, setDraftHistory] = useState([])
  // Whether the mount effect below has actually resolved -- either
  // resumed an in-progress draft or seeded a fresh one. `<DraftArena>`
  // itself isn't rendered until this is true (see the render below): its
  // `draftHistory` is seeded once, lazily, from `initialDraftHistory` on
  // its own first mount, so that prop's value has to already be correct
  // *before* DraftArena exists at all -- a later change wouldn't
  // retroactively fix it the way updating the `tournament` prop can.
  const [ready, setReady] = useState(false)
  const [seededDraftHistory, setSeededDraftHistory] = useState([])
  // 选秀台 nav tab, by explicit request: this page used to be reached
  // *only* via Tournament Lobby's 开始比赛 (which pre-validates the
  // roster's exact composition against Tournament Settings before ever
  // navigating here), so the "no persisted tournament_draft_state yet"
  // fallback below could safely assume it was always safe to auto-seed
  // a fresh draft from the current roster -- that fallback *was* the
  // draft-start mechanism, 开始比赛 never called a separate "start"
  // endpoint of its own. Now that this page is also reachable directly
  // from the nav bar (no validation gate in front of it), that
  // assumption no longer holds: an Admin/Developer just checking in
  // shouldn't have a fresh draft silently seeded under them from
  // whatever the roster happens to look like right now. Set true by the
  // mount effect below whenever there's no persisted draft to resume
  // AND 开始比赛 did not just explicitly request a start
  // (requestDraftStart() in tournamentApi.js) -- or, if it did, the
  // roster somehow no longer matches Tournament Settings' exact required
  // composition (the same check 开始比赛 itself already performs -- see
  // `requirement`/`roleCounts` in TournamentLobby.jsx). A roster that
  // merely *looks* ready (e.g. right after 创建临时玩家) is NOT enough:
  // that used to auto-seed and persist a phantom draft the moment any
  // staff account opened this page, which the Spectator Page and every
  // other client then showed as a started tournament.
  const [noDraftYet, setNoDraftYet] = useState(false)

  const isStaff = account && (account.permission_role === 'admin' || account.permission_role === 'developer')

  // Standard top nav, by explicit request: this page used to give
  // AppShell backAction/backLabel/title instead, rendering an isolated
  // "< 返回锦标赛大厅" back-link header in place of the tabbed nav bar
  // every other page gets (AppShell renders one or the other based on
  // whether `nav` is passed -- see AppShell.jsx). Same nav array shape
  // as TournamentLobby.jsx/AdminDashboard.jsx (管理后台 gated to staff,
  // same as everywhere else it appears); `handleNavigate` mirrors
  // AdminDashboard's own pattern -- 'lobby' goes through the existing
  // `onExitToLobby` prop (identical to onOpenLobby/onOpenAdmin
  // elsewhere: just `window.location.hash = 'lobby'`, already what this
  // page needs when leaving), everything else sets the hash directly,
  // which App.jsx's hashchange routing already handles the same way
  // for every other page. No new props needed. `onExitToLobby` itself
  // is unchanged and still used for its other existing purposes below
  // (结束锦标赛, FinalMatchupsStage's onEnded).
  //
  // 选秀台 tab, by later explicit request: this page now has its own
  // dedicated nav item (between 锦标赛大厅 and 观赛, isStaff-gated same
  // as 管理后台), reachable directly instead of only via Tournament
  // Lobby's 开始比赛 -- `section="draft"` below now highlights *that*
  // tab as active, rather than borrowing 锦标赛大厅's highlight the way
  // this page did before that tab existed. See `noDraftYet` above for
  // what changed in the mount effect once this page could be reached
  // without 开始比赛's own roster-readiness validation happening first,
  // and App.jsx for the matching `#draft` route gating.
  const draftNav = [
    ...(isStaff ? [{ key: 'admin', icon: 'admin', label: '管理后台' }] : []),
    { key: 'lobby', icon: 'lobby', label: '锦标赛大厅' },
    ...(isStaff ? [{ key: 'draft', icon: 'draft', label: '选秀台' }] : []),
    { key: 'spectate', icon: 'spectate', label: '观赛' },
  ]
  function handleDraftNavigate(key) {
    if (key === 'lobby') return onExitToLobby?.()
    window.location.hash = key
  }

  // Seeds `tournament` (and `seededDraftHistory`) on mount. Resuming an
  // in-progress draft (Live Draft State's `tournament_draft_state` +
  // `tournament_draft_history` -- see their split, and why, in
  // tournamentApi.js's own comment above fetchDraftState/fetchDraftHistory)
  // now takes priority: if a row already exists there, this admin (or a
  // different one) started a draft that hasn't reached Final Matchups or
  // been abandoned via 结束锦标赛/重置 yet, so pick it up exactly where it
  // was left -- teams, every pick so far (including the Undo stack behind
  // them), and the current phase, all read straight from that persisted
  // snapshot rather than reconstructing from current Tournament
  // Settings/roster (which keeps a resumed draft internally consistent
  // even if either changed while nobody was actively at this page). Falls
  // through to the original from-scratch seed
  // (fetchTournamentSettings()+fetchLobby() -> seedTournament(), empty
  // Undo stack) only when there's genuinely no draft in progress yet.
  // Both persisted pieces are fetched together up front (cheap either
  // way -- fetchDraftHistory() just returns `[]` when nothing's saved)
  // rather than one gating the other, so this stays a single round trip
  // pair instead of a waterfall.
  useEffect(() => {
    let cancelled = false
    // fetchDraftHistory() is allowed to fail independently of
    // fetchDraftState() -- a hiccup fetching the (larger, REST-only)
    // Undo stack shouldn't discard a perfectly valid resumed board; it
    // just resumes with an empty Undo stack instead (Undo simply has
    // nothing to undo until a new pick happens).
    Promise.all([fetchDraftState(), fetchDraftHistory().catch(() => [])])
      .then(([existing, history]) => {
        if (cancelled) return
        if (existing && Array.isArray(existing.teams) && existing.teams.length > 0) {
          setTournamentName(existing.tournamentName || '')
          setSettingsMeta({ teamCount: existing.teamCount || 0, playersPerTeam: existing.playersPerTeam || 0 })
          setTournament({
            teams: existing.teams,
            pickIndex: existing.pickIndex ?? 0,
            pool: Array.isArray(existing.pool) ? existing.pool : [],
            lastPick: null,
            draftPhase: existing.draftPhase || 'captain',
            captainCandidates: Array.isArray(existing.captainCandidates) ? existing.captainCandidates : [],
            roundOrders: Array.isArray(existing.roundOrders) ? existing.roundOrders : [],
          })
          setSeededDraftHistory(history)
          setReady(true)
          return
        }
        return Promise.all([fetchTournamentSettings(), fetchLobby()]).then(([settings, participants]) => {
          if (cancelled) return
          setTournamentName(settings.tournamentName || '')
          setSettingsMeta({ teamCount: settings.teamCount, playersPerTeam: settings.playersPerTeam })
          const captainCandidates = participants.filter((p) => p.tournamentRole === 'captain').map(toDraftPlayer)
          const pool = participants.filter((p) => p.tournamentRole === 'player').map(toDraftPlayer)
          // 选秀台 nav tab readiness check -- see the noDraftYet comment
          // above `useState` for why this now exists. Mirrors
          // TournamentLobby.jsx's own `requirement`/`roleCounts` exactly
          // (captains == team count, players == team count × (players
          // per team − 1)) rather than inventing a second definition of
          // "ready" that could drift from 开始比赛's own validation.
          const requiredCaptains = Math.max(0, settings.teamCount || 0)
          const requiredPlayers = Math.max(0, (settings.teamCount || 0) * Math.max(0, (settings.playersPerTeam || 0) - 1))
          const isReady =
            captainCandidates.length === requiredCaptains &&
            pool.length === requiredPlayers &&
            (captainCandidates.length + pool.length) === requiredCaptains + requiredPlayers
          // Bug fix: a ready roster alone must NOT start a draft. Seeding
          // here is what gets persisted (see the sync effect below) and
          // broadcast to the Spectator Page/every client, so it only
          // happens when 开始比赛 explicitly asked for it -- see
          // requestDraftStart() in tournamentApi.js. Consumed here (after
          // the `cancelled` check above, so a StrictMode double-mount's
          // discarded first run never eats it), and always consumed even
          // if the roster turns out not ready, so it can't linger.
          const startRequested = consumeDraftStartRequest()
          if (!startRequested || !isReady) {
            setNoDraftYet(true)
            setSeededDraftHistory([])
            setReady(true)
            return
          }
          setTournament(seedTournament(settings.teamCount, settings.playersPerTeam, buildRoundOrders(settings), captainCandidates, pool))
          setSeededDraftHistory([])
          setReady(true)
        })
      })
      .catch(() => {
        if (cancelled) return
        setTournamentName(SETTINGS_LOAD_FALLBACK.tournamentName)
        setSettingsMeta({ teamCount: SETTINGS_LOAD_FALLBACK.teamCount, playersPerTeam: SETTINGS_LOAD_FALLBACK.playersPerTeam })
        setTournament(seedTournament(SETTINGS_LOAD_FALLBACK.teamCount, SETTINGS_LOAD_FALLBACK.playersPerTeam, buildRoundOrders(SETTINGS_LOAD_FALLBACK), [], []))
        setSeededDraftHistory([])
        setReady(true)
      })
    return () => { cancelled = true }
  }, [])

  // Live Draft State persistence (also the layer a resume reads back
  // from, see the mount effect above): every time this admin/developer's
  // local `tournament` (or the Undo stack / ephemeral captain selection
  // reported up from DraftArena) actually changes during the draft, save
  // a snapshot of it to the database. Fire-and-forget by design -- a slow
  // or failed write here must never block or alter the admin's own
  // drafting experience (all of this stays 100% local `DraftArena` state
  // first; this is only ever a mirror of it, never the other way around
  // while actively drafting). A non-staff account that somehow reaches
  // this page (Section 8's pre-existing, unrelated known gap) simply has
  // every call rejected server-side, same as any other admin-only RPC --
  // harmless.
  //
  // `state` and `history` (draftHistory) are sent as two separate
  // payloads to syncDraftState() -- not one -- because folding
  // draftHistory into the same payload/row that Realtime broadcasts to
  // the Spectator Page was a real, shipped bug: draftHistory alone was
  // measured at ~3MB for a full 8x5 draft, and once that combined row
  // crossed Supabase Realtime's 1,024 KB Postgres Changes payload cap,
  // Realtime silently dropped the entire `state` field from the change
  // event (see tournament_draft_history's comment in schema.sql), so the
  // Spectator Page saw a row with no state and rendered its "nothing
  // saved" placeholder -- reliably around the 6th teammate pick -- even
  // though the correct state was sitting in Postgres. `history` is only
  // ever read back by this same page's own resume-on-mount (see above),
  // never by the Spectator Page, and is written to a table that isn't on
  // the Realtime publication at all, so it can never trigger that failure
  // again regardless of how large a draft's Undo stack grows.
  //
  // Leading-edge immediate + trailing-edge coalesced, not a plain
  // trailing debounce -- this distinction matters and is the whole point:
  // a plain trailing debounce (the previous version of this effect) waits
  // out the full window on *every single change*, even an isolated pick
  // with nothing else happening around it -- so the Spectator Page was
  // never less than ~200ms behind the real draft, by design, all the
  // time. That 200ms only ever existed to protect against a *rapid click
  // burst* recomputing this payload once per click (see the cost note
  // below) -- it was never meant to delay the common case of one pick at
  // a time, which is most of a real draft. So: if no window is currently
  // open, run immediately (nothing to protect against yet) and open a
  // window purely to catch anything that lands in the next instant; if a
  // change arrives while a window is already open (an actual burst),
  // coalesce it into that window's trailing fire instead of running again
  // right away. A quiet draft (the common case) now reaches Supabase --
  // and therefore the Spectator Page -- with no artificial delay at all;
  // a rapid burst (e.g. spam-clicking Undo late in a draft, when
  // draftHistory is longest and JSON.stringify-ing it is most expensive)
  // still only pays that recomputation cost once per window instead of
  // once per click, same protection as before.
  //
  // `syncInFlightRef`/`pendingWhileInFlightRef` -- a SEPARATE guard from
  // the 200ms window above, and just as load-bearing: root-caused a real,
  // reported `57014 canceling statement due to statement timeout` /
  // 500 on `sync_draft_state`. The 200ms window only throttles *when a
  // write starts*; `syncDraftState(...).catch(...)` is fire-and-forget,
  // never awaited, so nothing ever stopped a SECOND write from starting
  // before the FIRST one's network round trip finished. Both tables this
  // writes to are singleton rows (`id = true`) -- every write to either
  // one takes the same row lock -- so two overlapping requests don't run
  // concurrently in Postgres, the second one just blocks until the first
  // commits. Normally that block is milliseconds, harmless. But several
  // picks landing close together (very plausible right at the end of a
  // draft -- an admin moving fast, or several picks within the same
  // ~200ms window each still opening their own leading-edge send once
  // the window before them closes) can queue up multiple overlapping
  // writes faster than each one's round trip clears, and the queue can
  // compound: request 3 waits on request 2 which waits on request 1.
  // Enough of a backlog and a later request in that queue can genuinely
  // exceed Postgres's own statement_timeout waiting for a lock that was
  // always going to be released in milliseconds -- it just never got the
  // chance to even start executing. `enter_final_matchups()` (进入最终对阵)
  // deletes these exact same two rows, so it queues behind this same lock
  // too -- see `flushPendingDraftSync` and `handleProceed`'s own comment
  // further down for the other half of this fix. The fix here: never
  // let two `sync_draft_state` requests be in flight at once -- if one
  // is already running when a new write is due, queue it (superseding
  // anything already queued, only the latest state matters) and fire it
  // the instant the in-flight one finishes, rather than opening a second,
  // overlapping request.
  const draftBroadcastRef = useRef(null)
  const draftBroadcastTimerRef = useRef(null)
  const pendingBroadcastRef = useRef(null)
  const syncInFlightRef = useRef(false)
  const pendingWhileInFlightRef = useRef(null)
  useEffect(() => {
    if (!isStaff || stage !== 'draft') return
    if (!tournament.teams || tournament.teams.length === 0) return

    const send = (state, history) => {
      if (syncInFlightRef.current) {
        // A write to this same singleton row is already in flight --
        // queue this one instead of starting a second, overlapping
        // request that would just sit blocked waiting for the same row
        // lock. Only the latest queued write survives; a superseded one
        // is dropped outright, never sent.
        pendingWhileInFlightRef.current = () => send(state, history)
        return
      }
      syncInFlightRef.current = true
      // Fire-and-forget by design (see this effect's own comment above) --
      // never awaited/blocking, but never silently swallowed either: a
      // failed write here is exactly the kind of thing that otherwise
      // looks like "the app is fine, the Spectator Page/resume is just
      // randomly stale," so it's worth a console trace even though the
      // admin's own drafting experience must never wait on or be
      // interrupted by it.
      syncDraftState(state, history)
        .catch((err) => console.error('sync_draft_state failed:', err))
        .finally(() => {
          syncInFlightRef.current = false
          const next = pendingWhileInFlightRef.current
          pendingWhileInFlightRef.current = null
          next?.()
        })
    }

    const run = () => {
      const state = {
        tournamentName,
        teamCount: settingsMeta.teamCount,
        playersPerTeam: settingsMeta.playersPerTeam,
        draftPhase: tournament.draftPhase,
        teams: tournament.teams,
        captainCandidates: tournament.captainCandidates,
        pool: tournament.pool,
        pickIndex: tournament.pickIndex,
        roundOrders: tournament.roundOrders,
        selectedCaptainId,
      }
      const json = JSON.stringify({ state, draftHistory })
      if (draftBroadcastRef.current === json) return
      draftBroadcastRef.current = json
      send(state, draftHistory)
    }

    if (draftBroadcastTimerRef.current) {
      // A coalescing window from a very recent change is already open --
      // queue this one for the trailing fire at the end of it instead of
      // running again immediately.
      pendingBroadcastRef.current = run
      return
    }

    // No window open: the common case. Run immediately, then open a
    // short window purely to coalesce anything that arrives right behind
    // it (the actual burst-protection case).
    run()
    draftBroadcastTimerRef.current = setTimeout(() => {
      draftBroadcastTimerRef.current = null
      const pending = pendingBroadcastRef.current
      pendingBroadcastRef.current = null
      pending?.()
    }, 200)
  }, [isStaff, stage, tournamentName, settingsMeta, tournament, selectedCaptainId, draftHistory])

  // Flush any still-pending coalesced write on unmount (leaving this page
  // mid-burst) so the very last change before navigating away is never
  // silently dropped -- a `[]`-deps effect so this runs exactly once, on
  // true unmount, not on every dependency change above. Harmless no-op in
  // the common case: outside of a burst, nothing is ever left pending
  // since the leading edge above already ran synchronously.
  useEffect(() => {
    return () => {
      if (draftBroadcastTimerRef.current) clearTimeout(draftBroadcastTimerRef.current)
      pendingBroadcastRef.current?.()
    }
  }, [])

  // 进入最终对阵's own fix, other half of the `sync_draft_state`
  // 57014/500 root cause above: `enter_final_matchups()` deletes the
  // exact same two singleton rows `sync_draft_state` writes to, so it
  // queues behind the exact same row lock. `readyToProceed` (see
  // `allDrafted`/`hiddenKeys` above) already keeps this from firing while
  // a flight animation is still playing, but a pick's own write can still
  // be in flight or queued (the in-flight/coalescing guards above) well
  // after its animation already finished -- animation duration and
  // network round-trip time are unrelated. `handleProceed` awaits this
  // before calling `enterFinalMatchups()` specifically so that DELETE is
  // never one more request piling into the same queue -- it simply waits
  // for the queue to fully drain first, the same way a careful caller
  // would wait for a lock rather than contend for it. Polls on a short
  // interval rather than exposing a "resolve me" callback from the effect
  // above, since this only needs to run once, right before this one
  // specific action, not be wired into that effect's own lifecycle.
  async function flushPendingDraftSync() {
    const deadline = Date.now() + 10000
    while (draftBroadcastTimerRef.current || syncInFlightRef.current || pendingWhileInFlightRef.current) {
      if (Date.now() > deadline) {
        // Sane ceiling, not a fix for anything -- the fix above is what
        // keeps this queue short and fast under normal conditions. This
        // only exists so a genuinely hung network call (a different
        // failure than the lock pileup this effect fixes) can't leave
        // 进入最终对阵 permanently stuck waiting on a request that will
        // never resolve.
        console.error('flushPendingDraftSync: gave up waiting after 10s, proceeding anyway')
        break
      }
      await new Promise((r) => setTimeout(r, 50))
    }
  }

  // Draft progress now persists across leaving this page entirely: the
  // Live Draft State broadcast above is the *only* place captain
  // assignments/picks/phase live outside this one browser tab's local
  // state, so it deliberately does NOT get cleared just because the
  // admin navigates back to the Tournament Lobby mid-draft anymore --
  // that's exactly what lets the mount effect above resume it later.
  // enter_final_matchups()/end_tournament() are still the only two things
  // that clear it (both server-side, in schema.sql) -- reaching Final
  // Matchups or ending the tournament are genuine "this draft is over"
  // events; leaving the page is not.

  // Final Matchups Synchronization (Phase 5, Section: Final Matchups
  // stage): fetched once on mount (so a client opening the page *after*
  // someone else already clicked 进入最终对阵 lands straight on the Final
  // Matchups stage, not stuck showing a fresh empty draft board), then kept
  // live via Realtime for the rest of the page's lifetime -- regardless of
  // which stage this client is currently on. An INSERT/UPDATE means "render
  // (or re-render) the Final Matchups stage with this data"; a DELETE means
  // End Tournament just ran, so every connected client -- drafting or
  // already on the Final Matchups stage -- leaves for the Tournament Lobby
  // immediately, exactly like the requirement that no player automatically
  // remains in the next tournament.
  useEffect(() => {
    let cancelled = false
    let unsubscribe = null
    let retryTimer = null

    // Immediate initial read (fast first paint, before the realtime
    // channel has necessarily finished subscribing yet).
    fetchFinalMatchups()
      .then((row) => {
        if (cancelled || !row) return
        setFinalMatches(row)
        setStage('final')
      })
      .catch((err) => console.error('fetchFinalMatchups (initial) failed:', err))

    function connect() {
      unsubscribe = subscribeFinalMatchups(
        (payload) => {
          if (cancelled) return
          if (payload.eventType === 'DELETE') {
            setFinalMatches(null)
            setStage('draft')
            ;(onExitToLobby || (() => {}))()
            return
          }
          const row = payload.new
          if (!row) return
          // `teams` is snapshotted once by enter_final_matchups and never
          // changes again for the lifetime of this tournament_matches row --
          // every later mutation (lock/pair/roll/remove/reset) only ever
          // touches `matchups`. But Postgres logical replication can omit an
          // unchanged jsonb column's value from a realtime UPDATE payload
          // once it's large enough to be TOASTed, so a matchups-only update
          // can arrive here with `teams` missing/empty even though the
          // database itself still has it. Guard against that by keeping
          // whatever non-empty teams we already have instead of wiping the
          // whole roster to nothing.
          const incomingTeams = Array.isArray(row.teams) ? row.teams : []
          setFinalMatches((prev) => ({
            teams: incomingTeams.length > 0 ? incomingTeams : prev?.teams ?? [],
            matchups: Array.isArray(row.matchups) ? row.matchups : [],
          }))
          setStage('final')
        },
        // Realtime resilience: Supabase's client retries the underlying
        // WebSocket on its own, but a channel that was live through a long
        // backgrounded tab or a rough network patch can come back
        // reporting 'CHANNEL_ERROR'/'TIMED_OUT' without ever cleanly
        // re-subscribing -- silently stuck on stale data. So: on any
        // non-SUBSCRIBED status, tear the channel down and reconnect
        // shortly; and on every SUBSCRIBED (the first connect *and* every
        // later reconnect), re-fetch once so nothing missed while
        // disconnected is silently lost. Same pattern used by the
        // Spectator Page's own subscriptions (SpectatorPage.jsx), since
        // this is the exact same underlying channel/table.
        (status) => {
          if (cancelled) return
          if (status === 'SUBSCRIBED') {
            fetchFinalMatchups()
              .then((row) => { if (!cancelled && row) { setFinalMatches(row); setStage('final') } })
              .catch((err) => console.error('fetchFinalMatchups (reconnect) failed:', err))
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            unsubscribe?.()
            unsubscribe = null
            if (!cancelled) retryTimer = setTimeout(connect, 2000)
          }
        }
      )
    }
    connect()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      unsubscribe?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 进入最终对阵: snapshots the just-finished draft's teams (captain
  // identity only) into the tournament_matches singleton via
  // enterFinalMatchups(). The Realtime subscription above (which fires for
  // this client too, not just others) is what actually flips `stage` to
  // 'final' once the write lands -- this just kicks the write off and
  // surfaces an error inline if it's rejected (e.g. session expired, or a
  // non-staff account somehow reaches this button).
  async function handleProceed() {
    setProceedError(null)
    try {
      // Wait for any pending/in-flight tournament_draft_state write to
      // fully drain first -- see flushPendingDraftSync's own comment
      // above. enter_final_matchups() deletes the exact same two
      // singleton rows sync_draft_state writes to; without this, this
      // DELETE could queue up behind (or race) an in-flight or
      // about-to-fire write to those rows and contend for the same lock
      // -- root cause of a real, reported `57014 canceling statement due
      // to statement timeout` / 500 on sync_draft_state. This is a plain
      // wait, not a retry or a fallback -- if a write itself fails, its
      // own console.error already covers that; this only ever waits for
      // the queue to be empty before adding the next thing to it.
      await flushPendingDraftSync()
      const teamsPayload = tournament.teams.map((team, idx) => toFinalMatchupTeam(team, idx))
      // Apply this click's own result directly, the same way every
      // mutation inside FinalMatchupsStage already does (createManualMatchup
      // / rollTournamentMatchupsPool / removeTournamentMatchup /
      // resetTournamentMatchups -- see their own handlers) -- this button
      // was the one exception that instead awaited the RPC, discarded its
      // result, and relied entirely on the tournament_matches Realtime
      // subscription's own echo to ever flip `stage` to 'final'. That's a
      // real, reported bug: a genuine INSERT/UPDATE succeeding server-side
      // is not the same event as *this client's own subscription* having
      // already processed it by the time this function returns -- the two
      // are only *usually* close together, not guaranteed to be, so the
      // very first click could genuinely produce no visible change until
      // something else (a second click's own write, prompting a second
      // Realtime round trip) happened to arrive. Using the RPC's own
      // return value removes that dependency entirely for the client that
      // just performed the action -- Realtime remains exactly as useful as
      // before for every *other* connected client (a second staff tab, or
      // Spectators already on the Final Matchups view).
      const row = await enterFinalMatchups(teamsPayload)
      setFinalMatches(row)
      setStage('final')
    } catch (err) {
      setProceedError(err.message || '生成最终对阵失败')
    }
  }

  return (
    <AppShell
      account={account}
      section="draft"
      nav={draftNav}
      onNavigate={handleDraftNavigate}
      onLogout={onLogout}
      theme={theme}
      onThemeChange={onThemeChange}
      bgVariant="default"
    >
      {/* Theme Switcher: this body used to be wrapped in DraftVisualLock
          (forcing it dark regardless of the account's theme, per DEVLOG
          Section 3's "self-contained, not meant to be restyled" rule).
          That exclusion has been lifted for both Draft Arena and
          SpectatorPage.jsx together (DEVLOG Sections 3/8/9) -- both now
          follow the theme like every other page, via the same themed
          classes (bg-panel, text-ink-primary, and so on). */}
      <GlobalStyle />
      {stage === 'final' && finalMatches ? (
        <FinalMatchupsStage
          tournamentName={tournamentName}
          teams={finalMatches.teams}
          matchups={finalMatches.matchups}
          isStaff={isStaff}
          onEnded={onExitToLobby}
        />
      ) : !ready ? (
        <div className="flex items-center justify-center flex-1 text-ink-muted">加载中…</div>
      ) : noDraftYet ? (
        <EmptyDraftView subtitle="请先前往「锦标赛大厅」点击「开始比赛」以开启本次选秀。" />
      ) : (
        <DraftArena
          tournament={tournament}
          setTournament={setTournament}
          onProceed={handleProceed}
          tournamentName={tournamentName}
          isStaff={isStaff}
          onSelectedCaptainChange={(captain) => setSelectedCaptainId(captain?.id ?? null)}
          initialDraftHistory={seededDraftHistory}
          onDraftHistoryChange={setDraftHistory}
        />
      )}
      {proceedError && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-xs font-bold cursor-pointer bg-panel-alt/95 backdrop-blur border border-danger/40 text-danger shadow-[0_0_24px_rgba(255,77,109,0.25)]"
          onClick={() => setProceedError(null)}>
          ⚠ {proceedError}（点击关闭）
        </div>
      )}
    </AppShell>
  );
}
