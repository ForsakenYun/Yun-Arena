import React, { useState, useLayoutEffect, useEffect, useRef } from "react";
import {
  fetchTournamentSettings, draftRoundCount, generateSnakeDraft, fetchLobby,
  fetchFinalMatchups, subscribeFinalMatchups, enterFinalMatchups, rollTournamentMatchupsPool,
  lockTournamentMatchup, resetTournamentMatchups, endTournament, toFinalMatchupTeam,
  createManualMatchup, removeTournamentMatchup, syncDraftState, fetchDraftState,
} from "../lib/tournamentApi.js";
import ConfirmDialog from "./ConfirmDialog.jsx";

/* ════════════════════════════════════════════════════════════════════════
   CONSTANTS & THEME (unchanged from Dashboard.jsx)
   ════════════════════════════════════════════════════════════════════════ */
const TEAL = "#00f5d4";
const TEAL_DIM = "#0d3b38";
const TEAL_SOFT = "#7df3e1";

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
  id: 0, label: "Hex", color: "#00f5d4",
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
    <span className="inline-block text-[9px] font-bold px-1.5 py-0.5 rounded leading-none"
      style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.4)" }}>
      队长
    </span>
  );
}

function Avatar({ avatarId = DEFAULT_AVATAR_ID, avatarUrl = null, size = 36, glow = false }) {
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
        border: glow ? `1.5px solid ${TEAL}` : `1px solid ${TEAL_DIM}`,
        boxShadow: glow ? `0 0 12px ${TEAL}66` : "none",
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
    <h1 className={`${size} font-black tracking-wide text-white ${className}`}
      style={{ textShadow: "0 0 6px rgba(0,245,212,0.9), 0 0 18px rgba(0,245,212,0.55), 0 0 42px rgba(0,245,212,0.3)", letterSpacing: "0.04em" }}>
      {children}
    </h1>
  );
}

function PanelFrame({ children, className = "", onClick, style, ...rest }) {
  return (
    <div className={`relative rounded-2xl border ${className}`} onClick={onClick}
      style={{ background: "linear-gradient(to bottom, #0a1414, #060a0a)", borderColor: "rgba(0,245,212,0.25)", boxShadow: "0 0 0 1px rgba(0,245,212,0.06), 0 0 24px rgba(0,245,212,0.08)", ...style }}
      {...rest}>
      {children}
    </div>
  );
}

function TeamCard({ team, activeTeamIdx, teamIdx, useCaptainName = false, assignable = false, onAssignCaptain, hiddenKeys }) {
  const isActive = activeTeamIdx === teamIdx;
  const displayName = useCaptainName && team.captain ? `${team.captain.name}的战队` : `${teamIdx + 1}号战队`;
  const canAssign = assignable && !team.captain;
  const captainHidden = !!hiddenKeys && hiddenKeys.has(`cap:${teamIdx}`);
  return (
    <PanelFrame
      className={`p-3 flex-shrink-0 scroll-m-8 transition-all duration-300 ${isActive ? "scale-[1.03]" : ""} ${canAssign ? "cursor-pointer hover:brightness-125" : ""}`}
      style={{ width: TEAM_CARD_W }}
      data-team-panel={teamIdx}
      onClick={canAssign ? () => onAssignCaptain(teamIdx) : undefined}>
      <div className="absolute inset-0 rounded-2xl pointer-events-none"
        style={{ boxShadow: isActive ? `0 0 0 2px ${TEAL}, 0 0 26px ${TEAL}99` : canAssign ? `0 0 0 2px #22c55e, 0 0 18px #22c55e66` : "none", transition: "box-shadow 0.3s" }} />
      <div className="relative mb-2">
        <div className="text-center px-6">
          <span className="text-[11px] font-black tracking-widest truncate inline-block max-w-full" style={{ color: TEAL, textShadow: `0 0 8px ${TEAL}99`, textTransform: useCaptainName ? "none" : "uppercase" }}>{displayName}</span>
        </div>
        {isActive && <span className="absolute top-1/2 right-0 -translate-y-1/2 text-[9px] font-bold px-2 py-0.5 rounded-full animate-pulse flex-shrink-0" style={{ background: TEAL, color: "#000" }}>选人中</span>}
      </div>
      <div className="flex items-center gap-2 mb-2 p-1.5 rounded-lg w-full"
        data-slot-key={`cap:${teamIdx}`}
        style={{
          height: CAPTAIN_SLOT_H,
          boxSizing: "border-box",
          overflow: "hidden",
          opacity: captainHidden ? 0 : 1,
          background: canAssign ? "rgba(34,197,94,0.08)" : "rgba(0,0,0,0.4)",
          borderWidth: 1,
          borderStyle: canAssign ? "dashed" : "solid",
          borderColor: canAssign ? "#22c55e" : "rgba(255,255,255,0.05)",
          boxShadow: canAssign ? "0 0 12px rgba(34,197,94,0.35)" : "none",
        }}>
        {canAssign ? (
          <>
            <div className="w-[34px] h-[34px] rounded-lg border border-dashed flex items-center justify-center text-sm flex-shrink-0" style={{ borderColor: "#22c55e", color: "#22c55e" }}>+</div>
            <span className="text-[11px] font-bold italic" style={{ color: "#22c55e" }}>→ 分配队长</span>
          </>
        ) : team.captain ? (
          <>
            <Avatar avatarId={team.captain.avatarId} avatarUrl={team.captain.avatarUrl} size={34} glow />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold text-white truncate leading-tight">{team.captain.name}</div>
              <div className="mt-0.5"><CaptainBadge /></div>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 w-full">
            <div className="w-[34px] h-[34px] rounded-lg border border-dashed border-white/15 flex items-center justify-center text-white/20 text-xs flex-shrink-0">?</div>
            <span className="text-[11px] italic text-white/25">等待队长</span>
          </div>
        )}
      </div>
      <div className="space-y-1">
        {team.slots.map((slot, i) => {
          const slotKey = `slot:${teamIdx}:${i}`;
          const slotHidden = !!hiddenKeys && hiddenKeys.has(slotKey);
          return (
            <div key={i} data-slot-key={slotKey}
              className={`flex items-center gap-2 p-1.5 rounded-lg border text-[11px] ${slot ? "bg-black/30" : "bg-black/10 border-dashed border-white/10 text-white/25"}`}
              style={{ ...(slot ? { borderColor: TEAL_DIM } : {}), opacity: slotHidden ? 0 : 1 }}>
              <span className="w-6 h-5 flex items-center justify-center rounded text-[9px] font-bold flex-shrink-0"
                style={{ background: slot ? `${TEAL}22` : "transparent", color: slot ? TEAL : "#3a4a4a", border: `1px solid ${slot ? TEAL+"55" : "#1c2b2e"}` }}>
                {POSITIONS[i % 5]?.id ?? "?"}
              </span>
              {slot ? (
                <>
                  <Avatar avatarId={slot.avatarId} avatarUrl={slot.avatarUrl} size={20} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-white text-[10px]">{slot.name}</div>
                  </div>
                </>
              ) : <span className="italic">空位</span>}
            </div>
          );
        })}
      </div>
    </PanelFrame>
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
const PLAYER_CARD_BG = "linear-gradient(to bottom, #bfe6de 0%, #97cfc2 100%)";
const PLAYER_CARD_BORDER = "#5aa696";
const PLAYER_CARD_STAT_BG = "#d3ece5";
const PLAYER_CARD_STAT_BORDER = "#a9d9cc";
const PLAYER_CARD_TEXT = "#16232b";
const STAT_PILL_COLORS = { winRate: "#2f7a80", champion: "#c97a3f", position: "#3f6fca", rating: "#7c5cc9" };

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

function PlayerStatCard({ player, onClick, disabled, selected, badge }) {
  const stats = placeholderStats(player.id);
  return (
    <button onClick={onClick} disabled={disabled} type="button" data-card-id={player.id}
      className={`relative flex-shrink-0 text-left rounded-2xl transition-all duration-200 ${disabled ? "" : "hover:scale-[1.03]"}`}
      style={{
        width: PLAYER_CARD_W, padding: PLAYER_CARD_PAD,
        background: PLAYER_CARD_BG, border: `2px solid ${selected ? "#22c55e" : PLAYER_CARD_BORDER}`,
        boxShadow: selected ? "0 0 0 3px rgba(34,197,94,0.3), 0 0 18px rgba(34,197,94,0.35), 0 4px 14px rgba(0,0,0,0.25)" : "0 4px 14px rgba(0,0,0,0.25)",
        transform: selected ? "scale(1.035)" : "scale(1)",
        transitionTimingFunction: "cubic-bezier(.2,.8,.2,1)",
        opacity: disabled ? 0.35 : 1, cursor: disabled ? "not-allowed" : "pointer",
      }}>
      {badge && (
        <span className="absolute z-10 font-black rounded-full"
          style={{ top: 8, right: 8, background: "#22c55e", color: "#04150a", fontSize: 9, padding: "2px 7px", boxShadow: "0 2px 6px rgba(0,0,0,0.35)" }}>
          {badge}
        </span>
      )}
      <SquareAvatar avatarId={player.avatarId ?? DEFAULT_AVATAR_ID} avatarUrl={player.avatarUrl} size={PLAYER_CARD_AVATAR} />
      <div className="text-center font-black truncate" style={{ color: PLAYER_CARD_TEXT, fontSize: PLAYER_CARD_NAME_FONT, marginTop: PLAYER_CARD_GAP }}>{player.name}</div>
      <div className="rounded-xl" style={{ background: PLAYER_CARD_STAT_BG, border: `1px solid ${PLAYER_CARD_STAT_BORDER}`, padding: PLAYER_CARD_STAT_PAD, marginTop: PLAYER_CARD_GAP }}>
        <div className="grid grid-cols-2" style={{ rowGap: PLAYER_CARD_GAP, columnGap: PLAYER_CARD_PAD * 0.4 }}>
          <StatPill label="胜率" value={`${stats.winRate}%`} color={STAT_PILL_COLORS.winRate} />
          <StatPill label="冠军" value={stats.champion} color={STAT_PILL_COLORS.champion} />
          <StatPill label="擅长位置" value={stats.position} color={STAT_PILL_COLORS.position} />
          <StatPill label="天梯分" value={stats.rating} color={STAT_PILL_COLORS.rating} />
        </div>
      </div>
    </button>
  );
}

export { GlobalStyle };
function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800;900&display=swap');
      .font-display { font-family: 'Orbitron', sans-serif; }
      ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #060a0a; }
      ::-webkit-scrollbar-thumb { background: ${TEAL_DIM}; border-radius: 4px; }
      input::placeholder { color: rgba(255,255,255,0.2); }
      input:focus { outline: none; border-color: ${TEAL} !important; box-shadow: 0 0 10px rgba(0,245,212,0.4); }
      .no-scrollbar::-webkit-scrollbar { display: none; }
      .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

      /* Card Slide assignment animation (captain + teammate draft) */
      .df-ghost {
        position: fixed; z-index: 999; display: flex; align-items: center; gap: 8px;
        padding: 4px 10px 4px 4px; border-radius: 10px;
        background: rgba(10,20,20,0.95); border: 1px solid ${TEAL};
        box-shadow: 0 0 16px rgba(0,245,212,0.5);
        pointer-events: none; will-change: left, top;
      }
      .df-ghost-avatar {
        border-radius: 8px; background: ${TEAL}; flex-shrink: 0; overflow: hidden;
        display: flex; align-items: center; justify-content: center; font-weight: 800; color: #04150a;
      }
      .df-ghost-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .df-ghost-name { font-size: 11.5px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      @keyframes dfSettle { 0% { transform: scale(1.15); } 100% { transform: scale(1); } }
      .df-settle { animation: dfSettle 0.2s ease-out; }
      @keyframes dfHit { 0% { box-shadow: 0 0 0 0 rgba(0,245,212,0.5); } 100% { box-shadow: 0 0 0 12px rgba(0,245,212,0); } }
      .df-hit { animation: dfHit 0.45s ease-out; }
    `}</style>
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
              {isRoundStart && idx > 0 && <div className="flex items-center mx-1"><div className="w-px h-7" style={{ background: "rgba(0,245,212,0.2)" }} /></div>}
              <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
                <span className="text-[7px] font-black tracking-wider" style={{ color: isRoundStart ? "rgba(0,245,212,0.45)" : "transparent" }}>{isRoundStart ? `R${pick.round}` : "."}</span>
                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-black transition-all duration-200"
                  style={isCurrent ? { background: "rgba(74,222,128,0.18)", color: "#4ade80", border: "1.5px solid rgba(74,222,128,0.75)", boxShadow: "0 0 10px rgba(74,222,128,0.8)", transform: "scale(1.25)" }
                    : isPast ? { background: "transparent", color: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.04)" }
                    : { background: "rgba(0,245,212,0.03)", color: "rgba(0,245,212,0.3)", border: "1px solid rgba(0,245,212,0.1)" }}>
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
    Object.assign(clone.style, { left: `${startLeft}px`, top: `${startTop}px`, width: `${chipW}px`, height: `${chipH}px` });
    document.body.appendChild(clone);

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      clone.remove();
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
    const anim = clone.animate(
      [
        { left: `${startLeft}px`, top: `${startTop}px`, opacity: 1 },
        { left: `${dstRect.left}px`, top: `${dstRect.top}px`, opacity: 0.95 },
      ],
      { duration: 550, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" }
    );
    anim.onfinish = settle;
    anim.oncancel = settle;
    // Hard safety net in case the animation lifecycle is ever interrupted.
    setTimeout(settle, 700);
  };

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

  // Keep the current picker's team card in view. Once the team panel is
  // tall enough to need its own internal scrolling (see the container
  // below), nothing else would otherwise bring a newly-active team back
  // into view when the turn passes to it -- it could sit scrolled off-
  // screen indefinitely, and any pick that lands on it would fly its card
  // to a destination the user can't see. TeamCard carries scroll-m-8 (see
  // below) so scrollIntoView leaves the same 32px of clearance around the
  // card that its container's own padding already guarantees at rest --
  // block:"nearest" alone only guarantees the card's bare box is visible
  // and can flush it right against the container's edge, which wouldn't
  // leave room for the glow's box-shadow reach beyond that box. This only
  // scrolls within the card's own overflow-y-auto ancestor (see below);
  // it never touches the browser's own scroll position, since nothing
  // above that container is actually scrollable on desktop.
  useEffect(() => {
    if (activeTeamIdx < 0) return;
    const el = document.querySelector(`[data-team-panel="${activeTeamIdx}"]`);
    if (el) el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [activeTeamIdx]);

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
  const headerRingColor = draftPhase === "captain" ? "#22c55e" : TEAL;
  const HEADER_RING_R = 32;
  const HEADER_RING_CIRC = 2 * Math.PI * HEADER_RING_R;
  const headerRingOffset = HEADER_RING_CIRC * (1 - headerProgressPct / 100);

  if (teams.length === 0) return <div className="flex items-center justify-center flex-1 text-white/40">加载中…</div>;

  return (
    <div className="w-full flex flex-col flex-1 lg:min-h-0 px-4 sm:px-5 lg:px-6 py-5 gap-4 lg:overflow-hidden">
      <PanelFrame className="shrink-0" style={{ height: HEADER_H, boxSizing: "border-box", overflow: "hidden" }}>
        <div className="h-full flex items-stretch">
          {/* Nav column -- same back/undo handlers, disabled state, and
              history-count badge as before, just restyled as a compact
              ghost-button pair instead of one large button + one chip.
              Undo is Admin-only -- not rendered at all (not merely
              disabled) for non-staff viewers (e.g. the Spectator Page,
              Phase 6). The back button itself is controlled separately
              via `showBackButton` (defaults to `isStaff`, so admin usage
              here is unchanged) -- Phase 6's Spectator Page sets it to
              `true` even though isStaff=false, with its own `backLabel`,
              so its exit button sits in this exact same position/style
              as the admin's, instead of a separate page-level header. */}
          {(showBackButton || isStaff) && (
            <div className="flex-shrink-0 flex flex-col justify-center gap-2.5 px-5" style={{ borderRight: "1px solid rgba(0,245,212,0.16)" }}>
              {showBackButton && (
                <button onClick={onBack}
                  className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold border transition-all whitespace-nowrap"
                  style={{ background: "rgba(0,245,212,0.05)", borderColor: "rgba(0,245,212,0.28)", color: TEAL_SOFT }}>
                  {backLabel}
                </button>
              )}
              {isStaff && (
                <button onClick={undoLastPick} disabled={draftHistory.length === 0}
                  className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold border transition-all whitespace-nowrap"
                  style={{ background: draftHistory.length > 0 ? "rgba(251,191,36,0.08)" : "rgba(0,0,0,0.2)", borderColor: draftHistory.length > 0 ? "#fbbf2466" : "rgba(255,255,255,0.06)", color: draftHistory.length > 0 ? "#fbbf24" : "rgba(255,255,255,0.15)", cursor: draftHistory.length === 0 ? "not-allowed" : "pointer", boxShadow: draftHistory.length > 0 ? "0 0 10px rgba(251,191,36,0.2)" : "none" }}>
                  ↩ 撤销上一次选择
                  {draftHistory.length > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-black leading-none" style={{ background: "#fbbf2422", color: "#fbbf24" }}>{draftHistory.length}</span>}
                </button>
              )}
            </div>
          )}

          {/* Masthead -- tournament name (teal glow, the event's identity)
              stacked above the phase pill + current-turn headline (white
              glow, the primary focus), same data/branches as before. */}
          <div className="flex-1 min-w-0 flex flex-col justify-center px-8 gap-1.5">
            {tournamentName && (
              <div className="font-display font-extrabold text-2xl truncate"
                style={{ color: TEAL, textShadow: "0 0 14px rgba(0,245,212,0.45), 0 0 34px rgba(0,245,212,0.2)" }}>
                {tournamentName}
              </div>
            )}
            <div className="flex flex-col items-start gap-2 min-w-0">
              <span
                className="text-[11px] font-black px-3 py-0.5 rounded-full tracking-widest"
                style={{
                  background:
                    draftPhase === "captain"
                      ? "rgba(34,197,94,0.12)"
                      : "rgba(0,245,212,0.12)",
                  color: draftPhase === "captain" ? "#22c55e" : TEAL,
                  border: `1px solid ${
                    draftPhase === "captain"
                      ? "rgba(34,197,94,0.4)"
                      : TEAL + "55"
                  }`,
                }}
              >
                {draftPhase === "captain"
                  ? "第一阶段 —— 队长分配"
                  : "第二阶段 —— 队员选秀"}
              </span>

              {draftPhase === "captain" ? (
                <GlowHeading size="text-3xl" className="font-display">
                  {effectiveSelectedCaptain
                    ? `将 ${effectiveSelectedCaptain.name.toUpperCase()} 分配到战队`
                    : "选择一名队长"}
                </GlowHeading>
              ) : allDrafted ? (
                <GlowHeading size="text-3xl" className="font-display">
                  全部选手已选完 🏆
                </GlowHeading>
              ) : (
                <GlowHeading size="text-3xl" className="font-display">
                  {teams[activeTeamIdx]?.captain?.name?.toUpperCase()} 的选人回合
                </GlowHeading>
              )}
            </div>
            <div className="text-[11px] text-white/40 truncate">
              {draftPhase === "captain"
                ? (effectiveSelectedCaptain ? "现在点击下方一张空战队卡片（点击整张卡片即可）→" : `剩余${captainCandidates.length}人 · 已分配${8-captainCandidates.length}/8`)
                : (!allDrafted && <>第{roundLabel}轮，共{roundOrders.length}轮 · 战队{activeTeamIdx+1} · 第{pickIndex+1}/{customSnakeOrder.length}顺位</>)}
            </div>
          </div>

          {/* Progress + final-bracket action -- same two handlers/values
              feeding a single ring (see headerProgressPct above) instead
              of two separate bars, and the same onProceed/disabled logic
              on the button, restyled to match the ghost-button language
              used everywhere else in this header. */}
          <div className="flex-shrink-0 flex items-center gap-6 px-8" style={{ borderLeft: "1px solid rgba(0,245,212,0.16)" }}>
            <div className="relative flex-shrink-0" style={{ width: 78, height: 78 }}>
              <svg width="78" height="78" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="39" cy="39" r={HEADER_RING_R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="7" />
                <circle cx="39" cy="39" r={HEADER_RING_R} fill="none" stroke={headerRingColor} strokeWidth="7"
                  strokeDasharray={HEADER_RING_CIRC} strokeDashoffset={headerRingOffset} strokeLinecap="round"
                  style={{ transition: "stroke-dashoffset 500ms" }} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center font-display font-bold" style={{ color: headerRingColor }}>
                <span className="text-base leading-none">{Math.round(headerProgressPct)}%</span>
                <span className="text-[9px] font-semibold text-white/40 tracking-wider mt-0.5">进度</span>
              </div>
            </div>
            {isStaff && (
              <button onClick={onProceed} disabled={!allDrafted}
                className="font-bold text-sm px-5 py-2.5 rounded-xl border whitespace-nowrap transition-all"
                style={{ background: "rgba(0,245,212,0.07)", borderColor: allDrafted ? TEAL : "rgba(255,255,255,0.08)", color: allDrafted ? TEAL_SOFT : "rgba(255,255,255,0.2)", boxShadow: allDrafted ? "0 0 18px rgba(0,245,212,0.28)" : "none", cursor: allDrafted ? "pointer" : "not-allowed" }}>
                进入最终对阵 →
              </button>
            )}
          </div>
        </div>
      </PanelFrame>

      {/* Team panels (top) + candidate/draft pool (bottom) stack vertically,
          sharing the rest of the browser height on desktop. Each section
          scrolls internally on its own (overflow-y-auto on its own content
          area) instead of the whole page growing taller, per the Full
          Browser Layout Standard. Below lg, this falls back to a plain
          stacked column with normal page scroll, same as the rest of the
          project's main pages. */}
      <div className="flex-1 lg:min-h-0 flex flex-col lg:overflow-hidden">
        {draftPhase === "teammate" && (
          <div className="shrink-0">
            <DraftSequenceStrip customSnakeOrder={customSnakeOrder} pickIndex={pickIndex} roundOrders={roundOrders} draftFinished={allDrafted} />
          </div>
        )}

        {/* Sized to its own content (no forced flex-basis): with only
            flex-shrink + min-h-0 + max-height set, this box is exactly as
            tall as the team-card row(s) actually are. It only shrinks (and
            only then does overflow-y-auto start a scrollbar) once real
            content — enough rows of teams — doesn't fit in the space below
            the header/sequence strip; a single row never triggers a
            scrollbar or leaves unused space below it. The lg:max-h-[55%]
            cap just keeps a pathological number of rows from squeezing the
            candidate/draft pool panel below it down to nothing.

            p-8 is one fixed value for both phases (not phase-conditional
            like an earlier pass of this fix) so Captain and Player Draft
            look the same. It's sized for the bigger of the two glows this
            section can ever paint -- the Player Draft phase's current-
            picker glow (2px ring + 26px blur ≈ 28px reach) -- which also
            comfortably covers the Captain phase's smaller canAssign glow
            (2px ring + 18px blur ≈ 20px reach), so one value is safe for
            both with no clipping either way. items-start stops the default
            flex cross-axis stretch from ever growing a sibling to match
            another card's box (see PlayerStatCard below for why that
            matters). */}
        <div className="lg:max-h-[55%] lg:shrink lg:min-h-0 overflow-y-auto pt-2 px-8 pb-5">
          <div className="flex flex-wrap items-start gap-x-4 gap-y-6 pb-1">
            {teams.map((team, i) => (
              <TeamCard key={i} team={team} activeTeamIdx={activeTeamIdx} teamIdx={i}
                assignable={draftPhase === "captain" && !!effectiveSelectedCaptain}
                onAssignCaptain={handleTeamSlotClick}
                hiddenKeys={hiddenKeys} />
            ))}
          </div>
        </div>

        <div className="flex-1 lg:min-h-0 flex flex-col lg:overflow-hidden">
          {draftPhase === "captain" && (
            <PanelFrame className="p-4 flex flex-col flex-1 lg:min-h-0 lg:overflow-hidden">
              <h2 className="shrink-0 font-display text-sm font-bold tracking-widest mb-3" style={{ color: "#22c55e" }}>队长候选池（{captainCandidates.length}人未分配）</h2>
              <div className="flex-1 lg:min-h-0 overflow-y-auto p-8">
                <div className="flex flex-wrap items-start gap-x-4 gap-y-4">
                  {captainCandidates.map((c) => (
                    <PlayerStatCard key={c.id} player={c} onClick={() => handleCaptainClick(c)} selected={effectiveSelectedCaptain?.id === c.id} badge="队长" />
                  ))}
                  {captainCandidates.length === 0 && <div className="flex flex-col items-center py-8 text-white/30 text-center w-full"><div className="text-3xl mb-2">✅</div><div className="text-sm">所有队长已分配完毕！</div></div>}
                </div>
              </div>
              {isStaff && allCaptainsAssigned && (
                <button onClick={startTeammateDraft} disabled={!roundOrderValid.every(Boolean)}
                  className="w-full mt-4 py-3 rounded-xl font-extrabold tracking-widest text-sm uppercase border transition-all shrink-0"
                  style={{ background: roundOrderValid.every(Boolean) ? `linear-gradient(to bottom,${TEAL},#00c2a8)` : "rgba(0,0,0,0.3)", color: roundOrderValid.every(Boolean) ? "#000" : "rgba(255,255,255,0.2)", borderColor: roundOrderValid.every(Boolean) ? TEAL : "rgba(255,255,255,0.08)", boxShadow: roundOrderValid.every(Boolean) ? "0 0 22px rgba(0,245,212,0.65)" : "none", cursor: roundOrderValid.every(Boolean) ? "pointer" : "not-allowed" }}>
                  {roundOrderValid.every(Boolean) ? "🚀 锁定并开始队员选秀 →" : "⚠ 请先修正轮次顺序"}
                </button>
              )}
            </PanelFrame>
          )}

          {draftPhase === "teammate" && (
            <PanelFrame className="p-4 flex flex-col flex-1 lg:min-h-0 lg:overflow-hidden">
              <h2 className="shrink-0 font-display text-sm font-bold tracking-widest mb-3" style={{ color: TEAL }}>待选选手（{pool?.length ?? 0}）</h2>
              {pool && pool.length > 0 ? (
                <div className="flex-1 lg:min-h-0 overflow-y-auto p-8">
                  <div className="flex flex-wrap items-start gap-x-4 gap-y-4">
                    {pool.map((p) => (
                      <PlayerStatCard key={p.id} player={p} onClick={() => handlePlayerCardClick(p)} disabled={allDrafted} />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center py-10 text-white/30">
                  <div className="text-4xl mb-2">🏆</div>
                  <div className="font-display text-sm tracking-widest">选秀完成</div>
                </div>
              )}
            </PanelFrame>
          )}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   FINAL MATCHUPS STAGE — "01 冠军海报版" (Movie Poster Premiere)

   This is a DIRECT COPY of the HTML / CSS / JS for concept "01 冠军海报版"
   from final_matchups_concept3_variants_v2.html -- not a React
   reimplementation of it. The markup below (FMP_HTML) is the reference
   file's own `.stage` innerHTML for that concept, unedited. The stylesheet
   below (FMP_CSS) is the reference's own shared `.pv-*` rules plus its
   `.h1-*` / `[data-c="1"]` rules, unedited except that every selector is
   prefixed with `#fmpStage` so it can't leak onto the rest of this app's
   pages (the reference relied on a `[data-c="1"]` ancestor for the same
   scoping job; `#fmpStage` does the same job here). The script below
   (inside the mount effect) is the reference's own `makeModel`,
   `initials`, `renderFilmstrip`, `renderCasting`, `runRollSequence`, and
   its Variant-1 IIFE -- same functions, same variable names, same
   choreography (3-2-1 countdown, 7-tick flicker at 150ms, 1200ms pause
   between reveals, identical CSS class toggling for every animation).

   The only edits are the minimum wiring called for so this can run inside
   a React app against real data instead of the reference's standalone
   demo page (see Section 8 below for the fuller backend rewrite this
   grew into once real Random Pool / bye / lock-unlock-remove behavior
   was required):
     1. `TEAMS` (a hardcoded 8-name array in the reference) is built from
        this tournament's real captain names instead.
     2. `lockBtn` (定角锁定) still does exactly what the reference's own
        button did -- hand-pick 2 teams, lock them together immediately --
        just persisted via createManualMatchup() instead of only mutating
        an in-memory model. `rollBtn` (开幕！随机生成剩余对阵) is now
        scoped to whatever the admin has selected from the casting pool
        (any number of teams, no cap) and calls the real
        roll_tournament_matchups_pool RPC (see Section 8) -- the pool's
        teams only, nothing else. `reset1` / `end1` call
        resetTournamentMatchups / endTournament. `runRollSequence` itself
        is never touched; only `computeRollPlan()` is told the server's
        actual result (via `model._pendingPlan`, set right before it
        runs) instead of computing its own client-only shuffle, since a
        real roll must reveal what the server actually assigned.
     3. A small amount of chrome the reference didn't need (it was never
        embedded in a larger app, and its demo had no way to undo
        anything): a plain "back" control and an error banner above the
        poster, admin/developer-only visibility for the casting pool +
        action bar, and (appended by script, not by editing FMP_HTML) a
        lock/unlock + dissolve control pair on the featured spotlight
        card plus a small pool-size hint. None of this touches the
        poster's own markup (FMP_HTML), CSS (FMP_CSS), or the
        countdown/flicker/reveal script -- all of it lives outside
        `#fmpStage`'s copied nodes, styled by a separate FMP_WIRE_CSS
        stylesheet.
     4. A sync effect so that when another connected admin locks / rolls /
        removes / resets / ends from their own client, this client's
        `model` (and therefore the on-screen poster) picks it up via this
        project's existing Realtime subscription (`matchups`/`teams`
        props), the same live-sync guarantee every other stage in this
        app already has.
   ════════════════════════════════════════════════════════════════════════ */

function teamLabel(team) {
  return team?.captainName ? `${team.captainName} 战队` : "（空）战队";
}

// ---------------------------------------------------------------------
// FMP_CSS -- copied from final_matchups_concept3_variants_v2.html's
// shared `.pv-*` block and its `.h1-*` / `[data-c="1"]` VARIANT 1 block,
// verbatim, with every selector prefixed `#fmpStage ` for page-scoping
// (see note above) and `[data-c="1"]` folded into `#fmpStage` itself
// since this page only ever renders this one concept.
// ---------------------------------------------------------------------
const FMP_CSS = `
#fmpStage{--ac:#e8b45a;--ac2:#8a6a1e;--ac-a:rgba(232,180,90,.45);--ac-a2:rgba(232,180,90,.12);}

#fmpStage .pv-filmstrip{margin-top:14px;height:78px;display:flex;gap:8px;align-items:center;overflow-x:auto;padding:4px 2px;}
#fmpStage .pv-frame{flex-shrink:0;width:100px;height:64px;border-radius:7px;border:2px solid rgba(255,255,255,.1);background:rgba(255,255,255,.02);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;transition:all .15s ease;}
#fmpStage .pv-frame:hover{border-color:var(--ac);}
#fmpStage .pv-frame.active{border-color:var(--ac);box-shadow:0 0 14px var(--ac-a,rgba(232,180,90,.4));}
#fmpStage .pv-frame .fn{font-family:'Orbitron',sans-serif;font-size:9px;color:rgba(255,255,255,.35);}
#fmpStage .pv-frame .ft{font-family:'Cinzel',serif;font-size:10px;color:#f3dfb0;text-align:center;padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:92px;}
#fmpStage .pv-frame .fe{font-family:'Rajdhani',sans-serif;font-size:9px;color:rgba(255,255,255,.25);}
#fmpStage .pv-casting{margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:14px;min-height:66px;align-content:flex-start;}
#fmpStage .pv-castcard{display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.02);cursor:pointer;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:12.5px;color:#fff;transition:all .15s ease;}
#fmpStage .pv-castcard:hover{border-color:var(--ac);}
#fmpStage .pv-castcard.sel{border-color:var(--ac);background:var(--ac-a2,rgba(232,180,90,.12));box-shadow:0 0 14px var(--ac-a,rgba(232,180,90,.35));}
#fmpStage .pv-actions{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;}
#fmpStage .pv-btn{font-family:'Orbitron',sans-serif;font-weight:800;font-size:11px;letter-spacing:.03em;padding:12px 20px;border-radius:10px;border:1px solid;cursor:pointer;transition:all .16s ease;}
#fmpStage .pv-btn:disabled{opacity:.3;cursor:not-allowed;}
#fmpStage .pv-btn.gold{background:linear-gradient(135deg,var(--ac),var(--ac2,#8a6a1e));color:#160f04;border-color:transparent;}
#fmpStage .pv-btn.ghost{background:rgba(255,255,255,.03);color:rgba(255,255,255,.6);border-color:rgba(255,255,255,.16);}
#fmpStage .pv-btn.danger{background:rgba(255,59,59,.08);color:#ff6b6b;border-color:#5a1414;}

#fmpStage .h1{position:relative;height:620px;border-radius:14px;overflow:hidden;border:1px solid rgba(232,180,90,.22);
  background:radial-gradient(ellipse at 50% 0%, rgba(232,180,90,.14), transparent 55%), linear-gradient(180deg,#1a1206,#070502 75%);}
#fmpStage .h1-rays{position:absolute;left:50%;top:-10%;width:900px;height:900px;transform:translateX(-50%);background:conic-gradient(from 0deg, transparent 0deg, rgba(232,180,90,.06) 6deg, transparent 14deg);animation:fmpH1Spin 40s linear infinite;}
@keyframes fmpH1Spin{to{transform:translateX(-50%) rotate(360deg);}}
#fmpStage .h1-grain{position:absolute;inset:0;opacity:.045;background-image:radial-gradient(circle,#fff 1px,transparent 1px);background-size:3px 3px;pointer-events:none;}
#fmpStage .h1-title{position:relative;z-index:3;text-align:center;padding-top:38px;}
#fmpStage .h1-t-orn{color:#e8b45a;font-size:14px;opacity:.6;letter-spacing:.5em;margin-bottom:6px;}
#fmpStage .h1-t-main{font-family:'Cinzel',serif;font-weight:900;font-size:40px;color:#f3dfb0;letter-spacing:.12em;text-shadow:0 0 30px rgba(232,180,90,.5);}
#fmpStage .h1-t-sub{margin-top:8px;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:12px;letter-spacing:.35em;color:rgba(232,180,90,.55);}
#fmpStage .h1-badge{position:absolute;top:20px;right:20px;z-index:5;font-family:'Orbitron',sans-serif;font-size:10px;font-weight:800;letter-spacing:.08em;padding:6px 12px;border:1px solid #e8b45a;border-radius:5px;color:#f3dfb0;background:rgba(0,0,0,.4);}
#fmpStage .h1-cast{position:relative;z-index:3;display:flex;justify-content:center;gap:14px;margin-top:34px;flex-wrap:wrap;padding:0 30px;}
#fmpStage .h1-portrait{width:56px;height:56px;border-radius:50%;border:2px solid rgba(232,180,90,.3);background:radial-gradient(circle at 35% 30%, #3a2f16, #16110a 75%);display:flex;align-items:center;justify-content:center;font-family:'Cinzel',serif;font-weight:700;font-size:19px;color:rgba(232,180,90,.5);transition:all .5s ease;}
#fmpStage .h1-portrait.used{border-color:#e8b45a;color:#f3dfb0;box-shadow:0 0 16px rgba(232,180,90,.5);}
#fmpStage .h1-portrait.dim{opacity:.3;}
#fmpStage .h1-portrait.bye{border-color:#c9ced6;color:#eef1f4;box-shadow:0 0 16px rgba(201,206,214,.5);}
#fmpStage .h1-feature{position:relative;z-index:3;height:230px;display:flex;flex-direction:column;align-items:center;justify-content:center;margin-top:14px;}
#fmpStage .h1-feature-idle{font-family:'Rajdhani',sans-serif;font-size:13px;color:rgba(255,255,255,.3);letter-spacing:.05em;}
#fmpStage .h1-feature-pair{display:none;flex-direction:column;align-items:center;gap:14px;}
#fmpStage .h1-feature-pair.show{display:flex;}
#fmpStage .h1-finale{display:none;flex-direction:column;align-items:center;gap:14px;width:100%;}
#fmpStage .h1-finale.show{display:flex;animation:fmpH1FinaleIn 1s ease forwards;}
@keyframes fmpH1FinaleIn{from{opacity:0;transform:scale(.92);}to{opacity:1;transform:scale(1);}}
#fmpStage .h1-finale-title{font-family:'Cinzel',serif;font-weight:900;font-size:20px;letter-spacing:.1em;color:#f3dfb0;text-shadow:0 0 20px rgba(232,180,90,.6);}
#fmpStage .h1-finale-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px 26px;margin-top:6px;}
#fmpStage .h1-finale-row{display:flex;align-items:center;gap:10px;font-family:'Cinzel',serif;font-size:13px;color:#f3dfb0;opacity:0;}
#fmpStage .h1-finale-row.in{animation:fmpH1FrIn .5s ease forwards;}
@keyframes fmpH1FrIn{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}
#fmpStage .h1-finale-row .vs{color:#e8b45a;font-family:'Orbitron',sans-serif;font-size:10px;}
#fmpStage .h1-finale-row .no{color:rgba(232,180,90,.5);font-family:'Orbitron',sans-serif;font-size:9px;width:26px;}
#fmpStage .h1-fp-frame{position:relative;display:flex;align-items:center;justify-content:center;gap:30px;padding:22px 40px;border:1.5px solid #e8b45a;border-radius:8px;background:rgba(0,0,0,.3);box-shadow:0 0 40px rgba(232,180,90,.25), inset 0 0 30px rgba(232,180,90,.08);}
#fmpStage .h1-fp-frame::before,#fmpStage .h1-fp-frame::after{content:'';position:absolute;width:14px;height:14px;border:2px solid #f3dfb0;}
#fmpStage .h1-fp-frame::before{top:-2px;left:-2px;border-right:none;border-bottom:none;}
#fmpStage .h1-fp-frame::after{bottom:-2px;right:-2px;border-left:none;border-top:none;}
#fmpStage .h1-fp-name{font-family:'Cinzel',serif;font-weight:800;font-size:28px;color:#f3dfb0;opacity:0;text-shadow:0 0 20px rgba(232,180,90,.6);}
#fmpStage .h1-fp-name.in{animation:fmpH1NameIn .8s ease forwards;}
@keyframes fmpH1NameIn{from{opacity:0;letter-spacing:.5em;filter:blur(8px);}to{opacity:1;letter-spacing:.03em;filter:blur(0);}}
#fmpStage .h1-fp-vs{font-family:'Orbitron',sans-serif;font-weight:900;font-size:16px;color:#e8b45a;}
#fmpStage .h1-fp-tag{font-family:'Rajdhani',sans-serif;font-weight:700;font-size:11px;letter-spacing:.3em;color:rgba(232,180,90,.5);}
#fmpStage .h1-countdown{position:absolute;inset:0;z-index:8;display:flex;align-items:center;justify-content:center;pointer-events:none;}
#fmpStage .h1-countdown span{font-family:'Cinzel',serif;font-weight:900;font-size:130px;color:#f3dfb0;text-shadow:0 0 50px rgba(232,180,90,.8);display:none;}
#fmpStage .h1-countdown span.go{display:block;animation:fmpH1Count 1s cubic-bezier(.2,.8,.3,1) forwards;}
@keyframes fmpH1Count{0%{transform:scale(2.6);opacity:0;}30%{opacity:1;}100%{transform:scale(.6);opacity:0;}}
#fmpStage .h1-flash{position:absolute;inset:0;background:radial-gradient(circle at 50% 40%, rgba(255,240,210,.85), transparent 62%);opacity:0;z-index:7;pointer-events:none;}
#fmpStage .h1-flash.go{animation:fmpH1Flash .8s ease;}
@keyframes fmpH1Flash{0%{opacity:.8;}100%{opacity:0;}}

/* This project has a global prefers-reduced-motion rule (src/index.css)
   that collapses every animation/transition on the page to ~0ms for
   accessibility. The reference file has no such rule and always plays
   its animations at full speed/timing regardless of that OS setting.
   To render #fmpStage identically to the reference in every environment,
   its own animations are exempted from that collapse -- this changes
   nothing about the animations themselves (names/keyframes/durations
   above are untouched), it only stops something outside the copied CSS
   from truncating them. */
@media (prefers-reduced-motion: reduce) {
  #fmpStage, #fmpStage * {
    animation-duration: revert !important;
    animation-iteration-count: revert !important;
    transition-duration: revert !important;
  }
}
`;

// ---------------------------------------------------------------------
// FMP_HTML -- copied verbatim from the reference's
// <section data-c="1"> > <div class="stage"> innerHTML (i.e. everything
// except the demo-file's own concept-picker chrome -- the "01 冠军海报版"
// title/description blurb above the stage -- which belongs to the
// reference file's showcase wrapper, not to the page itself). Every id
// (hero1, h1Cast, h1Idle, fs1, lock1, roll1, ...) is unchanged so the
// script below can address these exact elements exactly like the
// reference's own script did.
// ---------------------------------------------------------------------
const FMP_HTML = `
<div class="h1" id="hero1">
  <div class="h1-rays"></div>
  <div class="h1-grain"></div>
  <div class="h1-badge" id="h1Badge">ROUND 1 · PREMIERE</div>
  <div class="h1-title">
    <div class="h1-t-orn">✦ ✦ ✦</div>
    <div class="h1-t-main" id="h1TitleMain">冠军之战</div>
    <div class="h1-t-sub">FINAL MATCHUPS · WORLD CHAMPIONSHIP</div>
  </div>
  <div class="h1-cast" id="h1Cast"></div>
  <div class="h1-feature" id="h1Feature">
    <div class="h1-feature-idle" id="h1Idle">敬请期待首个对阵公布 · 手动配对或随机生成开启序幕</div>
    <div class="h1-feature-pair" id="h1Pair">
      <div class="h1-fp-frame">
        <span class="h1-fp-name" id="h1NameA">—</span>
        <span class="h1-fp-vs">VS</span>
        <span class="h1-fp-name" id="h1NameB">—</span>
      </div>
      <div class="h1-fp-tag" id="h1Tag">MATCH 01</div>
    </div>
    <div class="h1-finale" id="h1Finale">
      <div class="h1-finale-title">对阵表已揭晓 · FINAL LINEUP</div>
      <div class="h1-finale-grid" id="h1FinaleGrid"></div>
    </div>
  </div>
  <div class="h1-countdown" id="h1Countdown"><span id="h1CNum">3</span></div>
  <div class="h1-flash" id="h1Flash"></div>
</div>
<div class="pv-filmstrip" id="fs1"></div>
<div class="pv-casting" id="cast1"></div>
<div class="pv-actions" id="actions1">
  <button class="pv-btn gold" id="lock1" disabled>🎬 定角锁定</button>
  <button class="pv-btn gold" id="roll1" style="background:linear-gradient(135deg,#2a8f8a,#e8b45a)">🎞️ 开幕！随机生成剩余对阵</button>
  <button class="pv-btn ghost" id="reset1">🔄 重置</button>
  <button class="pv-btn danger" id="end1">🏁 结束锦标赛</button>
</div>
`;

// ---------------------------------------------------------------------
// FMP_WIRE_CSS -- NOT from the reference. A small, separate stylesheet
// (deliberately kept apart from FMP_CSS above, which stays byte-for-byte
// identical to the reference) for the two elements the reference's demo
// never needed: per-match lock/unlock/dissolve controls, and a pool-size
// hint. Same gold/Rajdhani vocabulary as the rest of the card so it
// doesn't visually clash, but these are new nodes appended by the script
// below -- FMP_HTML itself is never edited.
// ---------------------------------------------------------------------
const FMP_WIRE_CSS = `
.fmpwire-pairctl{display:flex;gap:10px;align-self:center;}
.fmpwire-btn{font-family:'Orbitron',sans-serif;font-weight:800;font-size:11px;letter-spacing:.03em;padding:12px 20px;border-radius:10px;border:1px solid #e8b45a;background:rgba(0,0,0,.3);color:#ff8f8f;cursor:pointer;transition:all .16s ease;}
.fmpwire-btn:hover{border-color:#f3dfb0;color:#ffb3b3;}
.fmpwire-btn:disabled{opacity:.3;cursor:not-allowed;}
.fmpwire-hint{font-family:'Rajdhani',sans-serif;font-weight:700;font-size:11px;color:rgba(255,255,255,.4);align-self:center;}
`;

// Exported (Phase 6) so the read-only Spectator Page can reuse this exact
// stage -- with isStaff={false} -- for a genuinely live, real-data view of
// Final Matchups, instead of reimplementing this poster/roll/reveal
// animation a second time. Nothing about how it's used from DraftArenaPage
// below (isStaff=true/false there too) changes.
export function FinalMatchupsStage({ tournamentName, teams, matchups, isStaff, onBack, backLabel = "← 返回选手管理", showBackButton = true }) {
  const containerRef = useRef(null);
  const modelRef = useRef(null);
  const activeIdxRef = useRef(-1);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [busyAction, setBusyAction] = useState(null);
  const [error, setError] = useState(null);
  const stateRef = useRef({ teams, matchups, isStaff }); // always-current props for handlers below
  stateRef.current = { teams, matchups, isStaff };
  const pendingActionRef = useRef({ reset: null, end: null }); // holds the fn a confirm dialog will run

  // True for the whole duration of a Random Roll's on-screen sequence
  // (countdown -> flicker -> reveal, one match at a time). The server
  // already has the fully-resolved result the instant the roll RPC
  // returns -- well before that multi-second sequence finishes playing --
  // and Realtime pushes that resolved `matchups` prop back to this
  // component almost immediately. Without this guard, the prop-sync
  // effect below would immediately overwrite the cast portraits /
  // filmstrip with the fully-revealed end state instead of letting the
  // sequence reveal it one match at a time like the reference.
  const rollAnimatingRef = useRef(false);
  const renderAllRef = useRef(() => {}); // set by the mount effect; called by the prop-sync effect below so both share one render path (and one place that attaches click listeners)
  const showFinaleRef = useRef(() => {});
  // Spectator-only ("isStaff=false") replay: set by the mount effect to a
  // function that plays the exact same countdown -> flicker -> reveal
  // sequence onPoolRollClick's own runRollSequence call uses, driven by
  // an already-resolved result instead of a fresh RPC response -- see
  // the prop-sync effect below, which is this ref's only caller.
  const playAppendedRevealRef = useRef(async () => {});

  // Mount once: build the model from real data and wire up the
  // reference's own script (verbatim functions + Variant-1 IIFE) against
  // the real DOM this component just rendered.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return undefined;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    // ---- makeModel(): the reference's own shape (teams/selected/
    // usedSet/remaining/toggleSelect/lockSelected/reset/computeRollPlan/
    // applyRollResult), adapted so `matches` is a true append-only array
    // mirroring exactly what the server persists (the reference's demo
    // never needed byes, so it always pre-sized `matches` to a fixed
    // teams.length/2 with null placeholders -- that assumption breaks for
    // any odd team count, which real tournaments have all the time, so
    // matches now grows exactly the way the real matchups column does:
    // starts empty, only ever appended to). `toggleSelect` no longer caps
    // at 2 -- "Unlimited team pool" -- 定角锁定 below still requires
    // choosing exactly 2 before it does anything, same as before.
    function makeModel(teamLabels) {
      return {
        teams: teamLabels.slice(),
        matches: [],
        selected: [],
        usedSet() { const s = new Set(); this.matches.forEach((m) => { if (m.a) s.add(m.a); if (m.b) s.add(m.b); }); return s; },
        remaining() { const u = this.usedSet(); return this.teams.filter((t) => !u.has(t)); },
        toggleSelect(t) {
          if (this.selected.includes(t)) this.selected = this.selected.filter((x) => x !== t);
          else this.selected.push(t);
        },
        lockSelected() {
          if (this.selected.length !== 2) return null;
          const [a, b] = this.selected;
          const idx = this.matches.length;
          this.matches.push({ a, b, locked: true });
          this.selected = [];
          return idx;
        },
        reset() { this.matches = []; this.selected = []; },
        isComplete() { return this.matches.length > 0 && this.remaining().length === 0; },
        // Only ever called with a real {emptyIdxs, plan} handed to it via
        // `_pendingPlan` (set right before runRollSequence() runs, from
        // the server's actual roll result) -- see onPoolRollClick below.
        // The reference's own client-only shuffle is kept as a fallback
        // so this still behaves exactly like the reference if ever called
        // with no override, it's just never exercised in production
        // since a real override is always supplied.
        computeRollPlan() {
          if (this._pendingPlan) { const p = this._pendingPlan; this._pendingPlan = null; return p; }
          const remaining = this.remaining();
          const shuffled = remaining.slice();
          for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
          const emptyIdxs = this.matches.map((m, i) => ({ m, i })).filter((x) => !x.m.a && !x.m.b).map((x) => x.i);
          const plan = {}; let p = 0;
          emptyIdxs.forEach((idx) => { plan[idx] = { a: shuffled[p++] ?? null, b: shuffled[p++] ?? null }; });
          return { emptyIdxs, plan };
        },
        applyRollResult(idx, pair) { this.matches[idx] = { a: pair.a, b: pair.b, locked: false }; },
      };
    }
    function initials(name) { return name ? name[0] : "?"; }

    // ---- shared filmstrip + casting renderers, copied from the
    // reference, extended only to treat a bye (`b === null`, impossible
    // in the reference's own always-even demo) as a filled/complete slot
    // rather than "未生成", and to label it accordingly.
    function renderFilmstrip(el, model, activeIdx, onPick) {
      el.innerHTML = model.matches.map((m, i) => `
        <div class="pv-frame ${i === activeIdx ? "active" : ""}" data-idx="${i}">
          <div class="fn">MATCH ${String(i + 1).padStart(2, "0")}</div>
          ${m.a != null ? `<div class="ft">${m.b != null ? `${m.a} / ${m.b}` : `${m.a} 轮空`}</div>` : `<div class="fe">未生成</div>`}
        </div>`).join("");
      el.querySelectorAll(".pv-frame").forEach((f) => f.addEventListener("click", () => {
        const i = +f.dataset.idx; const m = model.matches[i];
        if (m.a != null) onPick(i);
      }));
    }
    function renderCasting(el, model, onToggle) {
      const used = model.usedSet();
      el.innerHTML = model.teams.filter((t) => !used.has(t)).map((t) => {
        const sel = model.selected.includes(t);
        return `<button class="pv-castcard ${sel ? "sel" : ""}" data-team="${t}">${t}</button>`;
      }).join("") || '<div style="color:rgba(255,255,255,.3);font-size:12px;">全部战队已配对</div>';
      el.querySelectorAll(".pv-castcard").forEach((b) => b.addEventListener("click", () => { onToggle(b.dataset.team); }));
    }

    // ---- generic roll sequence, copied verbatim, unmodified.
    async function runRollSequence(model, hooks) {
      const { emptyIdxs, plan } = model.computeRollPlan();
      if (emptyIdxs.length === 0) return;
      if (hooks.before) await hooks.before();
      for (const n of [3, 2, 1]) { await hooks.countdown(n); await wait(750); }
      for (let k = 0; k < emptyIdxs.length; k++) {
        const idx = emptyIdxs[k];
        for (let f = 0; f < 7; f++) {
          const rn1 = model.teams[Math.floor(Math.random() * model.teams.length)];
          const rn2 = model.teams[Math.floor(Math.random() * model.teams.length)];
          await hooks.flicker(idx, rn1, rn2, f);
          await wait(150);
        }
        const pair = plan[idx];
        model.applyRollResult(idx, pair);
        await hooks.reveal(idx, pair, k === emptyIdxs.length - 1);
        await wait(1200);
      }
      if (hooks.allDone) await hooks.allDone();
    }

    // ---- team labels, built from this tournament's real captains
    // instead of the reference's hardcoded TEAMS array. labelFromServer
    // builds the same label directly from an RPC response's own `teams`
    // snapshot, so applyServerRow() below never has to cross-reference
    // stale client props.
    function labelFromServer(t) { return t?.captainName ? `${t.captainName} 战队` : "（空）战队"; }
    const teamLabels = stateRef.current.teams.map((t) => teamLabel(t));
    const labelToIdx = new Map(stateRef.current.teams.map((t) => [teamLabel(t), t.idx]));

    const model = makeModel(teamLabels);
    modelRef.current = model;

    // Every mutating RPC below returns the fresh row -- always trust that
    // over any locally-guessed mutation, so the model can never drift
    // from what the server actually persisted.
    function applyServerRow(result) {
      if (!result) return;
      const byIdx = new Map((result.teams || []).map((t) => [t.idx, labelFromServer(t)]));
      model.teams = (result.teams || []).map((t) => labelFromServer(t));
      model.matches = (result.matchups || []).map((m) => ({
        a: m.a != null ? byIdx.get(m.a) : null,
        b: m.b != null ? byIdx.get(m.b) : null,
        locked: !!m.locked,
      }));
    }

    const castEl = root.querySelector("#h1Cast");
    const idleEl = root.querySelector("#h1Idle");
    const pairEl = root.querySelector("#h1Pair");
    const nameA = root.querySelector("#h1NameA");
    const nameB = root.querySelector("#h1NameB");
    const vsEl = root.querySelector(".h1-fp-vs"); // the reference's own "VS" span -- has no id in FMP_HTML, selected by its existing class instead of adding one
    const tagEl = root.querySelector("#h1Tag");
    const cnumEl = root.querySelector("#h1CNum");
    const flashEl = root.querySelector("#h1Flash");
    const badgeEl = root.querySelector("#h1Badge");
    const fsEl = root.querySelector("#fs1");
    const castPoolEl = root.querySelector("#cast1");
    const lockBtn = root.querySelector("#lock1");
    const rollBtn = root.querySelector("#roll1");
    const finaleEl = root.querySelector("#h1Finale");
    const finaleGridEl = root.querySelector("#h1FinaleGrid");
    const actionsWrap = root.querySelector("#actions1");

    // ---- Minimum extra wiring the reference's own demo never needed:
    // per-match dissolve control (the reference had no concept of undoing
    // an already-created matchup), and a small pool counter. Both are
    // appended as NEW nodes -- FMP_HTML itself is never edited -- and
    // styled by a small separate stylesheet (FMP_WIRE_CSS), never by
    // touching FMP_CSS. "✕ 解除对阵" (pairCtl) lives in the same action
    // bar as 定角锁定/开幕！随机生成剩余对阵/重置/结束锦标赛 (#actions1 /
    // `actionsWrap`), not beneath the featured matchup box -- grouping
    // every admin action for the currently-featured match together with
    // the rest of the admin controls, rather than splitting it off into
    // its own spot elsewhere on the page.
    const pairCtl = document.createElement("div");
    pairCtl.className = "fmpwire-pairctl";
    pairCtl.innerHTML = `
      <button type="button" class="fmpwire-btn" id="fmpwireRemove">✕ 解除对阵</button>
    `;
    actionsWrap.appendChild(pairCtl);
    const pairRemoveBtn = pairCtl.querySelector("#fmpwireRemove");

    const poolHint = document.createElement("div");
    poolHint.className = "fmpwire-hint";
    actionsWrap.appendChild(poolHint);

    function updatePairControls() {
      // Always visible for staff once this is possible at all (same
      // pattern as lockBtn/定角锁定, which is always rendered and just
      // toggles `.disabled` based on selection) -- enabled only once a
      // match is actually selected/featured, disabled otherwise.
      if (!stateRef.current.isStaff) { pairCtl.style.display = "none"; return; }
      pairCtl.style.display = "flex";
      const idx = activeIdxRef.current;
      const m = idx >= 0 ? model.matches[idx] : null;
      pairRemoveBtn.disabled = !m || busyRef.current !== null;
    }

    function renderCast() {
      const used = model.usedSet();
      // A team currently sitting alone in a bye entry (m.a set, m.b null)
      // gets the "bye" modifier alongside "used" so its portrait is
      // recolored silver instead of the normal gold -- purely a color
      // swap, same size/shape/border-width/glow-radius/animation as
      // every other portrait.
      const byeTeams = new Set(model.matches.filter((m) => m.a && m.b == null).map((m) => m.a));
      castEl.innerHTML = model.teams.map((t) =>
        `<div class="h1-portrait ${used.has(t) ? (byeTeams.has(t) ? "used bye" : "used") : "dim"}">${initials(t)}</div>`
      ).join("");
    }
    function renderAll() {
      renderCast();
      renderFilmstrip(fsEl, model, activeIdxRef.current, cutTo);
      renderCasting(castPoolEl, model, (t) => { model.toggleSelect(t); renderAll(); });
      // Lock is enabled from 2 selected teams up -- with exactly 2 it
      // creates an immediate manual pairing; with 3+ it kicks off Random
      // Roll for exactly that selected group (see onLockClick below).
      lockBtn.disabled = model.selected.length < 2 || busyRef.current !== null;
      // Roll is disabled only when there's truly nothing it could do:
      // busy, or (no pool selected AND no free teams left to default to).
      // An empty pool is not a blocker -- it's the "roll everyone free"
      // case.
      const rollTargetCount = model.selected.length > 0 ? model.selected.length : model.remaining().length;
      rollBtn.disabled = rollTargetCount < 1 || busyRef.current !== null;
      poolHint.textContent = model.selected.length > 0
        ? `已选择 ${model.selected.length} 支战队进入随机池`
        : (model.remaining().length > 0 ? `未选择战队 · 将随机排位全部剩余 ${model.remaining().length} 支战队` : "");
      badgeEl.textContent = model.isComplete() ? "TOURNAMENT READY" : "ROUND 1 · PREMIERE";
      updatePairControls();
    }
    function showFinale() {
      finaleGridEl.innerHTML = model.matches.map((m, i) =>
        m.b != null
          ? `<div class="h1-finale-row" style="animation-delay:${i * 180}ms"><span class="no">0${i + 1}</span>${m.a} <span class="vs">VS</span> ${m.b}</div>`
          : `<div class="h1-finale-row" style="animation-delay:${i * 180}ms"><span class="no">0${i + 1}</span>${m.a} <span class="vs"></span> 轮空</div>`
      ).join("");
      finaleGridEl.querySelectorAll(".h1-finale-row").forEach((r) => r.classList.add("in"));
      pairEl.classList.remove("show");
      finaleEl.classList.remove("show"); void finaleEl.offsetWidth; finaleEl.classList.add("show");
      flashEl.classList.remove("go"); void flashEl.offsetWidth; flashEl.classList.add("go");
    }
    function cutTo(idx) {
      activeIdxRef.current = idx;
      const m = model.matches[idx];
      idleEl.style.display = "none";
      finaleEl.classList.remove("show");
      pairEl.classList.add("show");
      if (m.b != null) {
        nameA.textContent = m.a || "—";
        if (vsEl) { vsEl.textContent = "VS"; vsEl.style.display = ""; }
        nameB.textContent = m.b;
        nameB.style.display = "";
      } else {
        // Bye: only "A 战队 轮空" is shown, centered in the frame -- no
        // "VS", no second team. The "VS" span and the second-name span
        // are now hidden with display:none (not just emptied text), so
        // the flex row's `gap` no longer reserves space for them and
        // #fmpStage .h1-fp-frame naturally shrink-wraps to the single
        // remaining name plus its existing symmetric 22px/40px padding
        // -- which is what centers it. Same 3 spans as the reference
        // (h1NameA / h1-fp-vs / h1NameB); nothing about the markup,
        // corner-bracket decoration, glow, or reveal animation those
        // spans already play is touched.
        nameA.textContent = `${m.a || "—"} 轮空`;
        if (vsEl) { vsEl.textContent = ""; vsEl.style.display = "none"; }
        nameB.textContent = "";
        nameB.style.display = "none";
      }
      [nameA, nameB].forEach((el) => { el.classList.remove("in"); void el.offsetWidth; el.classList.add("in"); });
      tagEl.textContent = `MATCH ${String(idx + 1).padStart(2, "0")}`;
      flashEl.classList.remove("go"); void flashEl.offsetWidth; flashEl.classList.add("go");
      renderFilmstrip(fsEl, model, activeIdxRef.current, cutTo);
      updatePairControls();
    }

    // busyRef mirrors React's busy state into the imperative script so
    // renderAll() can disable buttons during an in-flight request the
    // same way the reference disabled `rollBtn` mid-sequence.
    const busyRef = { current: null };

    async function withBusy(action, fn) {
      busyRef.current = action;
      setBusyAction(action);
      setError(null);
      renderAll();
      try {
        await fn();
      } catch (err) {
        setError(err?.message || "操作失败，请重试");
      } finally {
        busyRef.current = null;
        setBusyAction(null);
        renderAll();
      }
    }

    // lock1 -- with exactly 2 teams selected, hand-pick and lock that pair
    // together immediately (unchanged from before). With 3 or more
    // selected, 定角锁定 now means "lock this exact group in and
    // randomize it": it hands the selected teams straight to the same
    // Random Roll flow as roll1 (onPoolRollClick below), using them as
    // the explicit pool, so e.g. selecting A+B+C and clicking Lock rolls
    // those 3 immediately -- one random pair plus one random bye -- via
    // the real backend and the same countdown/flicker/reveal sequence,
    // without needing a separate click on 开幕！随机生成剩余对阵.
    async function onLockClick() {
      if (model.selected.length < 2 || busyRef.current) return;
      if (model.selected.length > 2) {
        await onPoolRollClick();
        return;
      }
      const [la, lb] = model.selected;
      const idxA = labelToIdx.get(la), idxB = labelToIdx.get(lb);
      await withBusy("pair", async () => {
        const result = await createManualMatchup(idxA, idxB);
        model.selected = [];
        applyServerRow(result);
        const idx = model.matches.length - 1; // createManualMatchup always appends
        renderAll();
        if (model.isComplete()) showFinale(); else cutTo(idx);
      });
    }

    // roll1 -- Random Roll. If the admin has selected teams from the
    // casting pool (model.selected), the roll is scoped to exactly that
    // pool. If nothing is selected, this rolls every currently-free team
    // instead -- the same "roll everyone" behavior the reference's own
    // button implied, now genuinely computed server-side (not guessed on
    // the client) so it can't race with what's actually free. Either way
    // `runRollSequence` itself is never touched; the real
    // roll_tournament_matchups_pool RPC shuffles + pairs server-side
    // (including a bye if the rolled group is odd), and the reveal
    // sequence plays back that real result -- teams outside whatever
    // group ends up being rolled, and every existing matchup (locked or
    // unlocked), are guaranteed untouched by the RPC itself, not just by
    // convention here.
    async function onPoolRollClick() {
      if (rollBtn.disabled || busyRef.current) return;
      const poolLabels = model.selected.slice();
      const explicitPool = poolLabels.length > 0;
      if (!explicitPool && model.remaining().length < 1) return; // nothing free to roll either way
      const poolIdxs = explicitPool ? poolLabels.map((l) => labelToIdx.get(l)) : null; // null = let the server default to "every free team"
      idleEl.style.display = "none";
      rollAnimatingRef.current = true; // block the prop-sync effect until the sequence below finishes
      await withBusy("roll", async () => {
        const beforeLen = stateRef.current.matchups.length; // roll_tournament_matchups_pool only ever appends, either way, so anything from here on is new
        const result = await rollTournamentMatchupsPool(poolIdxs);
        model.selected = [];
        // Deliberately do NOT apply the server's result to model.matches
        // yet. The reference's own reveal engine (runRollSequence, via
        // model.applyRollResult) is what's supposed to grow model.matches
        // one entry at a time, in step with each reveal -- that's the
        // entire mechanism the countdown -> flicker -> reveal choreography
        // relies on for "only the just-revealed match's teams light up".
        // Writing the full, already-known result here immediately would
        // make every rolled team's cast portrait light up together the
        // instant the very first reveal fires renderAll(), since
        // renderCast()'s used/dim state is computed by scanning the
        // entirety of model.matches. Only team LABELS are safe to sync
        // early (they don't drive any lit/dim state); the actual match
        // entries are handed to the sequence as a plan and applied by it,
        // exactly once per reveal step, exactly like the reference.
        const teamsByIdx = new Map((result.teams || []).map((t) => [t.idx, labelFromServer(t)]));
        model.teams = (result.teams || []).map((t) => labelFromServer(t));
        const newIdxs = [];
        const plan = {};
        (result.matchups || []).forEach((m, i) => {
          if (i < beforeLen) return; // pre-existing entry -- untouched, not part of this reveal
          newIdxs.push(i);
          plan[i] = { a: m.a != null ? teamsByIdx.get(m.a) : null, b: m.b != null ? teamsByIdx.get(m.b) : null };
        });
        model._pendingPlan = { emptyIdxs: newIdxs, plan };

        await runRollSequence(model, {
          countdown: async (n) => { cnumEl.textContent = n; cnumEl.classList.remove("go"); void cnumEl.offsetWidth; cnumEl.classList.add("go"); },
          flicker: async (idx, a, b) => {
            pairCtl.style.display = "none";
            pairEl.classList.add("show");
            nameA.textContent = a; nameB.textContent = b;
            nameA.style.opacity = nameA.style.opacity === "1" ? ".25" : "1";
            nameB.style.opacity = nameA.style.opacity;
            tagEl.textContent = `MATCH ${String(idx + 1).padStart(2, "0")} · ANALYZING`;
          },
          reveal: async (idx) => {
            // model.matches[idx] was just written by runRollSequence's own
            // model.applyRollResult(idx, plan[idx]) call, immediately
            // before this hook fires -- so renderAll() here only ever
            // lights up the teams revealed so far, never teams from
            // later, still-unrevealed matches in this same roll.
            nameA.style.opacity = "1"; nameB.style.opacity = "1";
            renderAll();
            cutTo(idx);
          },
          allDone: async () => {
            // Final reconciliation against the server's own row (covers
            // e.g. `locked` flags) -- by now model.matches already equals
            // this anyway, since every entry was written incrementally
            // above, so this is a no-op in practice, not a second reveal.
            applyServerRow(result);
            renderAll();
            if (model.isComplete()) showFinale();
          },
        });
      });
      rollAnimatingRef.current = false; // sequence finished -- prop-sync effect may resume (and will just confirm the same end state)
    }

    // Spectator-only replay: same countdown->flicker->reveal choreography
    // as onPoolRollClick's own runRollSequence call just above, but fed an
    // already-resolved `{newTeams, newMatches}` (this component's own
    // `teams`/`matchups` props, label-resolved) instead of driving off a
    // fresh RPC response -- so a spectator watching someone else's roll
    // sees it play out live instead of snapping straight to the result.
    // If `newMatches` isn't strictly longer than what the model already
    // has (nothing was appended -- a lock/unlock/remove/reset instead),
    // this just syncs directly, same as the prop-sync effect always did.
    async function playAppendedReveal(newTeams, newMatches) {
      const beforeLen = model.matches.length;
      if (newMatches.length <= beforeLen) {
        model.teams = newTeams;
        model.matches = newMatches;
        if (activeIdxRef.current >= model.matches.length) activeIdxRef.current = -1;
        if (activeIdxRef.current < 0 && model.matches.length === 0) {
          idleEl.style.display = "block";
          pairEl.classList.remove("show");
        }
        renderAll();
        if (model.isComplete() && !finaleEl.classList.contains("show")) showFinale();
        return;
      }
      idleEl.style.display = "none";
      model.teams = newTeams;
      const emptyIdxs = [];
      const plan = {};
      for (let i = beforeLen; i < newMatches.length; i++) {
        emptyIdxs.push(i);
        plan[i] = { a: newMatches[i].a, b: newMatches[i].b };
        model.matches[i] = { a: null, b: null, locked: false };
      }
      model._pendingPlan = { emptyIdxs, plan };
      await runRollSequence(model, {
        countdown: async (n) => { cnumEl.textContent = n; cnumEl.classList.remove("go"); void cnumEl.offsetWidth; cnumEl.classList.add("go"); },
        flicker: async (idx, a, b) => {
          pairCtl.style.display = "none";
          pairEl.classList.add("show");
          nameA.textContent = a; nameB.textContent = b;
          nameA.style.opacity = nameA.style.opacity === "1" ? ".25" : "1";
          nameB.style.opacity = nameA.style.opacity;
          tagEl.textContent = `MATCH ${String(idx + 1).padStart(2, "0")} · ANALYZING`;
        },
        reveal: async (idx) => {
          nameA.style.opacity = "1"; nameB.style.opacity = "1";
          renderAll();
          cutTo(idx);
        },
        allDone: async () => {
          model.teams = newTeams;
          model.matches = newMatches;
          renderAll();
          if (model.isComplete()) showFinale();
        },
      });
    }
    playAppendedRevealRef.current = playAppendedReveal;

    // Matchup-level dissolve on whatever's currently featured -- the
    // reference never needed this (its demo had no way to undo
    // anything); this project's backend already supports it, so it's
    // wired here.
    async function onPairRemove() {
      const idx = activeIdxRef.current;
      if (idx < 0 || busyRef.current) return;
      await withBusy(`remove:${idx}`, async () => {
        const result = await removeTournamentMatchup(idx);
        applyServerRow(result);
        activeIdxRef.current = -1;
        pairEl.classList.remove("show");
        if (model.matches.length === 0) idleEl.style.display = "block";
        renderAll();
      });
    }

    async function onResetClick() {
      if (busyRef.current) return;
      pendingActionRef.current.reset = () => withBusy("reset", async () => {
        const result = await resetTournamentMatchups();
        applyServerRow(result);
        activeIdxRef.current = -1;
        renderAll();
        pairEl.classList.remove("show"); finaleEl.classList.remove("show"); idleEl.style.display = "block";
      });
      setConfirmReset(true);
    }
    async function onEndClick() {
      if (busyRef.current) return;
      pendingActionRef.current.end = () => withBusy("end", async () => { await endTournament(); });
      setConfirmEnd(true);
    }

    root.querySelector("#lock1").addEventListener("click", onLockClick);
    root.querySelector("#roll1").addEventListener("click", onPoolRollClick);
    root.querySelector("#reset1").addEventListener("click", onResetClick);
    root.querySelector("#end1").addEventListener("click", onEndClick);
    pairRemoveBtn.addEventListener("click", onPairRemove);

    // Title text (real tournament name) -- the reference hardcoded
    // "冠军之战" as demo copy; this is the one piece of text content
    // swapped for real data, same font/size/position/animation.
    const titleEl = root.querySelector("#h1TitleMain");
    if (titleEl) titleEl.textContent = stateRef.current.__tournamentName || "冠军之战";

    // Casting pool + action bar visibility for isStaff is handled by a
    // dedicated reactive effect below (so it responds to isStaff changing
    // after mount, not just at mount time).

    // Seed the model from whatever Final Matchups state already existed
    // the moment this stage mounted (e.g. this admin refreshed mid-way
    // through an existing tournament) instead of assuming a blank slate.
    applyServerRow({ teams: stateRef.current.teams.map((t) => ({ idx: t.idx, captainName: t.captainName })), matchups: stateRef.current.matchups });
    if (model.matches.length > 0) idleEl.style.display = "none";

    renderAllRef.current = renderAll;
    showFinaleRef.current = showFinale;

    renderAll();
    if (model.isComplete()) showFinale();

    return () => {
      root.querySelector("#lock1")?.removeEventListener("click", onLockClick);
      root.querySelector("#roll1")?.removeEventListener("click", onPoolRollClick);
      root.querySelector("#reset1")?.removeEventListener("click", onResetClick);
      root.querySelector("#end1")?.removeEventListener("click", onEndClick);
      pairRemoveBtn.removeEventListener("click", onPairRemove);
      pairCtl.remove();
      poolHint.remove();
    };
    // Mount once -- see the sync effect below for how later prop changes
    // (Realtime updates from other clients) get reflected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the model (and therefore the on-screen poster) in sync whenever
  // `matchups`/`teams` change from Realtime -- e.g. another connected
  // Admin/Developer locks, rolls, removes, or resets from their own
  // client. The reference never needed this (single local `model`, no
  // server); it's required here for the same live-sync guarantee every
  // other stage in this project already has.
  useEffect(() => {
    if (rollAnimatingRef.current) return; // a Random Roll reveal sequence is actively playing -- let it finish rendering its own frames
    const model = modelRef.current;
    const root = containerRef.current;
    if (!model || !root) return;
    const teamsByIdx = new Map(teams.map((t) => [t.idx, t]));
    const newTeams = teams.map((t) => teamLabel(t));
    const newMatches = matchups.map((m) => ({
      a: m.a != null ? teamLabel(teamsByIdx.get(m.a)) : null,
      b: m.b != null ? teamLabel(teamsByIdx.get(m.b)) : null,
      locked: !!m.locked,
    }));

    // Spectator-only ("isStaff=false"): if this update is a pure append
    // (every previously-known entry is unchanged, and at least one new,
    // already-resolved entry was added) -- i.e. someone else just locked
    // a manual pairing or ran a Random Roll -- replay it live via
    // playAppendedRevealRef instead of snapping straight to the result.
    // Never fires on the very first sync right after mount (the mount
    // effect above already seeded model.matches from these same initial
    // props, so beforeLen === newMatches.length then, which fails the
    // ">" check below) and never for isStaff=true (unchanged, pre-
    // existing behavior for admins -- the one who actually clicked
    // already gets their own sequence from onPoolRollClick).
    const beforeLen = model.matches.length;
    const isPureAppend = !isStaff && newMatches.length > beforeLen &&
      newMatches.slice(0, beforeLen).every((m, i) => {
        const prevMatch = model.matches[i];
        return prevMatch && prevMatch.a === m.a && prevMatch.b === m.b && prevMatch.locked === m.locked;
      });

    if (isPureAppend) {
      rollAnimatingRef.current = true;
      playAppendedRevealRef.current(newTeams, newMatches).finally(() => { rollAnimatingRef.current = false; });
      return;
    }

    model.teams = newTeams;
    model.matches = newMatches;
    // Realtime can move a currently-featured match's index (e.g. another
    // admin removed an earlier entry, shifting everything after it down)
    // or dissolve it outright -- drop the spotlight rather than risk
    // showing the wrong pair.
    if (activeIdxRef.current >= model.matches.length) activeIdxRef.current = -1;
    if (activeIdxRef.current < 0 && model.matches.length === 0) {
      const idleEl = root.querySelector("#h1Idle");
      const pairEl = root.querySelector("#h1Pair");
      if (idleEl) idleEl.style.display = "block";
      if (pairEl) pairEl.classList.remove("show");
    }
    // Delegate to the exact same render function the mount effect itself
    // uses (renderAllRef), so this can never drift out of sync with it --
    // in particular, so the casting-pool chips this rebuilds always keep
    // their click listeners (renderAll()/renderCasting() re-attach them
    // on every call; a hand-rolled innerHTML rebuild here previously did
    // not, which silently broke pool selection after the very first
    // Realtime update).
    renderAllRef.current();
    const finaleEl = root.querySelector("#h1Finale");
    if (model.isComplete() && finaleEl && !finaleEl.classList.contains("show")) {
      showFinaleRef.current();
    }
  }, [teams, matchups, isStaff]);

  // isStaff visibility, kept reactive (not just set once at mount) --
  // casting pool + action bar + per-match lock/unlock/remove controls are
  // admin/developer tools; everyone else gets a read-only poster
  // (filmstrip still clickable to browse revealed matchups).
  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const castingWrap = root.querySelector("#cast1");
    const actionsWrap = root.querySelector("#actions1");
    if (castingWrap) castingWrap.style.display = isStaff ? "" : "none";
    if (actionsWrap) actionsWrap.style.display = isStaff ? "" : "none";
    if (!isStaff) {
      const pairCtl = root.querySelector(".fmpwire-pairctl");
      if (pairCtl) pairCtl.style.display = "none";
    } else {
      renderAllRef.current();
    }
  }, [isStaff]);

  stateRef.current.__tournamentName = tournamentName;

  return (
    <div className="w-full flex flex-col flex-1 lg:min-h-0 px-4 sm:px-5 lg:px-6 py-5 gap-3 lg:overflow-y-auto">
      <div className="flex items-center justify-between flex-wrap gap-2 shrink-0">
        {showBackButton ? (
          <button onClick={onBack}
            className="text-xs font-bold px-3 py-1.5 rounded-lg border transition-all"
            style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.16)", color: "rgba(255,255,255,0.6)" }}>
            {backLabel}
          </button>
        ) : <span />}
        {error && (
          <div className="text-xs font-bold px-3 py-1.5 rounded-lg" style={{ background: "rgba(255,59,59,.1)", color: "#ff6b6b" }}>
            ⚠ {error}
          </div>
        )}
      </div>
      <style>{FMP_CSS}</style>
      <style>{FMP_WIRE_CSS}</style>
      <div id="fmpStage" ref={containerRef} style={{ maxWidth: 1300, width: "100%", margin: "0 auto" }}
        dangerouslySetInnerHTML={{ __html: FMP_HTML }} />
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
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   INITIAL STATE — teamCount, playersPerTeam, and roundOrders all come from
   the Tournament Lobby's Tournament Settings (锦标赛设置); captainCandidates
   and pool come from the Tournament Lobby's actual joined participants
   (tournament_participants, split by Tournament Role) -- both fetched by
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
// the Lobby itself renders), split by Tournament Role. Only participants
// who actually joined the tournament ever appear here; nobody else does,
// by construction of fetchLobby() itself. avatarId is intentionally
// omitted -- this project only has avatarUrl-or-default, no id-based
// avatar selection (see Avatar/SquareAvatar below).
function toDraftPlayer(participant) {
  return { id: participant.accountId, name: participant.displayName, avatarUrl: participant.avatarUrl }
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
export default function DraftArenaPage({ onExitToLobby, account }) {
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

  const isStaff = account && (account.permission_role === 'admin' || account.permission_role === 'developer')

  // Seeds `tournament` (and `seededDraftHistory`) on mount. Resuming an
  // in-progress draft (Live Draft State, Phase 6's `tournament_draft_state`
  // -- originally added only as a one-way broadcast for the Spectator
  // Page) now takes priority: if a row already exists there, this admin
  // (or a different one) started a draft that hasn't reached Final
  // Matchups or been abandoned via 结束锦标赛/重置 yet, so pick it up
  // exactly where it was left -- teams, every pick so far (including the
  // Undo stack behind them), and the current phase, all read straight
  // from that persisted snapshot rather than reconstructing from current
  // Tournament Settings/roster (which keeps a resumed draft internally
  // consistent even if either changed while nobody was actively at this
  // page). Falls through to the original from-scratch seed
  // (fetchTournamentSettings()+fetchLobby() -> seedTournament(), empty
  // Undo stack) only when there's genuinely no draft in progress yet.
  useEffect(() => {
    let cancelled = false
    fetchDraftState()
      .then((existing) => {
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
          setSeededDraftHistory(Array.isArray(existing.draftHistory) ? existing.draftHistory : [])
          setReady(true)
          return
        }
        return Promise.all([fetchTournamentSettings(), fetchLobby()]).then(([settings, participants]) => {
          if (cancelled) return
          setTournamentName(settings.tournamentName || '')
          setSettingsMeta({ teamCount: settings.teamCount, playersPerTeam: settings.playersPerTeam })
          const captainCandidates = participants.filter((p) => p.tournamentRole === 'captain').map(toDraftPlayer)
          const pool = participants.filter((p) => p.tournamentRole === 'player').map(toDraftPlayer)
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

  // Live Draft State broadcast (Phase 6 -- Spectator Page; also now the
  // persistence layer a resume reads back from, see the mount effect
  // above): every time this admin/developer's local `tournament` (or the
  // Undo stack / ephemeral captain selection reported up from
  // DraftArena) actually changes during the draft, mirror a snapshot of
  // it to the database. Fire-and-forget by design -- a slow or failed
  // write here must never block or alter the admin's own drafting
  // experience (all of this stays 100% local `DraftArena` state first;
  // this is only ever a mirror of it, never the other way around while
  // actively drafting). A non-staff account that somehow reaches this
  // page (Section 8's pre-existing, unrelated known gap) simply has every
  // call rejected server-side, same as any other admin-only RPC --
  // harmless.
  const draftBroadcastRef = useRef(null)
  useEffect(() => {
    if (!isStaff || stage !== 'draft') return
    if (!tournament.teams || tournament.teams.length === 0) return
    const payload = {
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
      draftHistory,
    }
    const json = JSON.stringify(payload)
    if (draftBroadcastRef.current === json) return
    draftBroadcastRef.current = json
    syncDraftState(payload).catch(() => {})
  }, [isStaff, stage, tournamentName, settingsMeta, tournament, selectedCaptainId, draftHistory])

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
    fetchFinalMatchups()
      .then((row) => {
        if (cancelled || !row) return
        setFinalMatches(row)
        setStage('final')
      })
      .catch(() => {})

    const unsubscribe = subscribeFinalMatchups((payload) => {
      if (payload.eventType === 'DELETE') {
        setFinalMatches(null)
        setStage('draft')
        ;(onExitToLobby || (() => {}))()
        return
      }
      const row = payload.new
      if (!row) return
      setFinalMatches({
        teams: Array.isArray(row.teams) ? row.teams : [],
        matchups: Array.isArray(row.matchups) ? row.matchups : [],
      })
      setStage('final')
    })

    return () => { cancelled = true; unsubscribe() }
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
      const teamsPayload = tournament.teams.map((team, idx) => toFinalMatchupTeam(team, idx))
      await enterFinalMatchups(teamsPayload)
    } catch (err) {
      setProceedError(err.message || '生成最终对阵失败')
    }
  }

  return (
    <div className="min-h-screen w-full text-white font-sans flex flex-col lg:h-screen lg:overflow-hidden" style={{ background: "radial-gradient(ellipse at top, #0b1716 0%, #050807 55%, #020303 100%)" }}>
      <GlobalStyle />
      {stage === 'final' && finalMatches ? (
        <FinalMatchupsStage
          tournamentName={tournamentName}
          teams={finalMatches.teams}
          matchups={finalMatches.matchups}
          isStaff={isStaff}
          onBack={onExitToLobby || (() => {})}
        />
      ) : !ready ? (
        <div className="flex items-center justify-center flex-1 text-white/40">加载中…</div>
      ) : (
        <DraftArena
          tournament={tournament}
          setTournament={setTournament}
          onBack={onExitToLobby || (() => {})}
          onProceed={handleProceed}
          tournamentName={tournamentName}
          isStaff={isStaff}
          onSelectedCaptainChange={(captain) => setSelectedCaptainId(captain?.id ?? null)}
          initialDraftHistory={seededDraftHistory}
          onDraftHistoryChange={setDraftHistory}
        />
      )}
      {proceedError && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-xs font-bold"
          style={{ background: "rgba(20,4,4,0.95)", border: "1px solid #5a1414", color: "#f87171" }}
          onClick={() => setProceedError(null)}>
          ⚠ {proceedError}（点击关闭）
        </div>
      )}
    </div>
  );
}
