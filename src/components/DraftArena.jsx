import React, { useState, useLayoutEffect, useEffect, useRef } from "react";
import {
  fetchTournamentSettings, draftRoundCount, generateSnakeDraft, fetchLobby,
  fetchFinalMatchups, subscribeFinalMatchups, enterFinalMatchups, rollTournamentMatchups,
  lockTournamentMatchup, resetTournamentMatchups, endTournament, toFinalMatchupTeam,
  lockTeamsIntoPool, unlockTeamFromPool, removeTournamentMatchup,
} from "../lib/tournamentApi.js";
import ConfirmDialog from "./ConfirmDialog.jsx";

/* ════════════════════════════════════════════════════════════════════════
   CONSTANTS & THEME (unchanged from Dashboard.jsx)
   ════════════════════════════════════════════════════════════════════════ */
const TEAL = "#00f5d4";
const TEAL_DIM = "#0d3b38";
const TEAL_SOFT = "#7df3e1";
const CORE_ROLE_COLOR = "#f59e0b";
const CAPTAIN_ID = 0;

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

const genUid = (prefix = "id") => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

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

function posLabel(positions) {
  if (!Array.isArray(positions) || positions.length === 0) return "";
  return positions.map((p) => (p === CAPTAIN_ID ? "队长" : `${p}号位`)).join(" ");
}
function coreRoleLabel(coreRole) {
  if (!coreRole || coreRole.length === 0) return "";
  return coreRole.map((r) => { const f = POSITIONS.find((p) => p.id === r); return f ? f.label : "?"; }).join(" ");
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
function CoreRoleBadge({ coreRole }) {
  if (!Array.isArray(coreRole) || coreRole.length === 0) return null;
  return (
    <span className="inline-block text-xs font-bold px-2.5 py-1 rounded"
      style={{ background: `${CORE_ROLE_COLOR}22`, color: CORE_ROLE_COLOR, border: `1px solid ${CORE_ROLE_COLOR}55` }}>
      {coreRoleLabel(coreRole)}
    </span>
  );
}
function SubRoleBadge({ positions }) {
  const label = posLabel(positions);
  if (!label) return null;
  return (
    <span className="inline-block text-xs font-bold px-2.5 py-1 rounded"
      style={{ background: "rgba(0,245,212,0.08)", color: TEAL, border: `1px solid ${TEAL}55` }}>
      {label}
    </span>
  );
}
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

function PrimaryButton({ children, onClick, disabled, variant = "solid", className = "" }) {
  const [hover, setHover] = useState(false);
  const solidStyle = { background: `linear-gradient(to bottom, ${TEAL}, #00c2a8)`, color: "#000", borderColor: TEAL, boxShadow: hover ? "0 0 32px rgba(0,245,212,0.95)" : "0 0 22px rgba(0,245,212,0.65)", transform: hover ? "translateY(-2px)" : "translateY(0)" };
  const ghostStyle = { background: "rgba(0,0,0,0.4)", color: hover ? "#fff" : TEAL_SOFT, borderColor: hover ? TEAL : TEAL_DIM };
  const dangerStyle = { background: hover ? "rgba(248,113,113,0.18)" : "rgba(0,0,0,0.4)", color: "#f87171", borderColor: "#5a1414" };
  const style = variant === "solid" ? solidStyle : variant === "danger" ? dangerStyle : ghostStyle;
  return (
    <button onClick={onClick} disabled={disabled} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      className={`px-6 py-3 rounded-xl font-extrabold tracking-wide text-sm uppercase transition-all duration-150 border ${className}`}
      style={{ ...style, opacity: disabled ? 0.3 : 1, cursor: disabled ? "not-allowed" : "pointer", transform: disabled ? "translateY(0)" : (style.transform || "translateY(0)") }}>
      {children}
    </button>
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
function DraftArena({ tournament, setTournament, onBack, onProceed, tournamentName }) {
  const [selectedCaptain, setSelectedCaptain] = useState(null);
  const [draftHistory, setDraftHistory] = useState([]);

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

  const { teams, pickIndex, pool, lastPick, draftPhase, captainCandidates, roundOrders } = tournament;
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

  const handleCaptainClick = (captain) => setSelectedCaptain((prev) => prev?.id === captain.id ? null : captain);

  const handleTeamSlotClick = (teamIdx) => {
    if (!selectedCaptain || teams[teamIdx]?.captain) return;
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

  const startTeammateDraft = () => { if (!allCaptainsAssigned || !roundOrderValid.every(Boolean)) return; setTournament((prev) => ({ ...prev, draftPhase: "teammate", pickIndex: 0, roundOrdersLocked: true })); };

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
    if (draftPhase !== "teammate" || draftFinished) return;
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
    if (draftHistory.length === 0) return;
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
              ghost-button pair instead of one large button + one chip. */}
          <div className="flex-shrink-0 flex flex-col justify-center gap-2.5 px-5" style={{ borderRight: "1px solid rgba(0,245,212,0.16)" }}>
            <button onClick={onBack}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold border transition-all whitespace-nowrap"
              style={{ background: "rgba(0,245,212,0.05)", borderColor: "rgba(0,245,212,0.28)", color: TEAL_SOFT }}>
              ← 返回选手管理
            </button>
            <button onClick={undoLastPick} disabled={draftHistory.length === 0}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold border transition-all whitespace-nowrap"
              style={{ background: draftHistory.length > 0 ? "rgba(251,191,36,0.08)" : "rgba(0,0,0,0.2)", borderColor: draftHistory.length > 0 ? "#fbbf2466" : "rgba(255,255,255,0.06)", color: draftHistory.length > 0 ? "#fbbf24" : "rgba(255,255,255,0.15)", cursor: draftHistory.length === 0 ? "not-allowed" : "pointer", boxShadow: draftHistory.length > 0 ? "0 0 10px rgba(251,191,36,0.2)" : "none" }}>
              ↩ 撤销上一次选择
              {draftHistory.length > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-black leading-none" style={{ background: "#fbbf2422", color: "#fbbf24" }}>{draftHistory.length}</span>}
            </button>
          </div>

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
                  {selectedCaptain
                    ? `将 ${selectedCaptain.name.toUpperCase()} 分配到战队`
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
                ? (selectedCaptain ? "现在点击下方一张空战队卡片（点击整张卡片即可）→" : `剩余${captainCandidates.length}人 · 已分配${8-captainCandidates.length}/8`)
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
            <button onClick={onProceed} disabled={!allDrafted}
              className="font-bold text-sm px-5 py-2.5 rounded-xl border whitespace-nowrap transition-all"
              style={{ background: "rgba(0,245,212,0.07)", borderColor: allDrafted ? TEAL : "rgba(255,255,255,0.08)", color: allDrafted ? TEAL_SOFT : "rgba(255,255,255,0.2)", boxShadow: allDrafted ? "0 0 18px rgba(0,245,212,0.28)" : "none", cursor: allDrafted ? "pointer" : "not-allowed" }}>
              进入最终对阵 →
            </button>
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
                assignable={draftPhase === "captain" && !!selectedCaptain}
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
                    <PlayerStatCard key={c.id} player={c} onClick={() => handleCaptainClick(c)} selected={selectedCaptain?.id === c.id} badge="队长" />
                  ))}
                  {captainCandidates.length === 0 && <div className="flex flex-col items-center py-8 text-white/30 text-center w-full"><div className="text-3xl mb-2">✅</div><div className="text-sm">所有队长已分配完毕！</div></div>}
                </div>
              </div>
              {allCaptainsAssigned && (
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
   FINAL MATCHUPS STAGE — Concept 1 "Tournament Bracket", blank-canvas /
   admin-in-control workflow. Entered from DraftArena's 进入最终对阵 button
   once drafting is finished; renders in the exact same page shell
   (DraftArenaPage below), same background/font/scrollbar setup, same
   panel/glow language. Every team is named after its captain (never
   "1号战队") -- see teamLabel() below.

   The page starts completely blank -- no matchups exist at all. From
   there the admin has two tools, freely mixable:
     - Manual Pairing: pick exactly two "remaining" teams (teams not yet
       in any matchup) and click 锁定 -- that pairing is created already
       locked, permanently fixed until explicitly unlocked or removed.
     - Random Roll: randomly pairs up whatever teams are still
       "remaining" (i.e. not in any matchup, locked or not) into new
       unlocked matchups. Locked matchups are never touched by a roll.
   Reset wipes every matchup (manual or rolled, locked or not) back to
   the same blank canvas.

   All of this stage's state (teams snapshot + matchups) lives in the
   `tournament_matches` singleton row (see supabase/schema.sql, Section
   6b) and is kept live via Realtime, so Manual Pairing / Random Roll /
   Lock / Reset / End Tournament are all genuinely synchronized across
   every connected client, not just the one that clicked the button.
   ════════════════════════════════════════════════════════════════════════ */
function teamLabel(team) {
  return team?.captainName ? `${team.captainName} 战队` : "（空）战队";
}

function MatchTeamSlot({ team, locked }) {
  if (!team) {
    return (
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.1)" }}>
        <div className="text-xs text-white/25 font-bold">轮空</div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl transition-all"
      style={{ background: locked ? "rgba(251,191,36,0.06)" : "rgba(0,245,212,0.04)", border: `1px solid ${locked ? "#fbbf2466" : TEAL_DIM}` }}>
      <Avatar avatarUrl={team.captainAvatarUrl} size={26} glow={locked} />
      <div className="text-[13px] font-black text-white truncate">{teamLabel(team)}</div>
    </div>
  );
}

function MatchPair({ index, matchup, teamsByIdx, locked, onToggleLock, onRemove, canManage, busyLock, busyRemove }) {
  const teamA = matchup.a != null ? teamsByIdx.get(matchup.a) : null;
  const teamB = matchup.b != null ? teamsByIdx.get(matchup.b) : null;
  const busy = busyLock || busyRemove;
  return (
    <div className="grid items-center gap-4" style={{ gridTemplateColumns: "1fr 96px" }}>
      <div className="flex flex-col gap-2.5">
        <MatchTeamSlot team={teamA} locked={locked} />
        <MatchTeamSlot team={teamB} locked={locked} />
      </div>
      <div className="flex flex-col items-center gap-2">
        <button
          onClick={() => canManage && onToggleLock(index, !locked)}
          disabled={!canManage || busy}
          className="w-full flex flex-col items-center justify-center gap-1 rounded-xl py-4 transition-all"
          style={{
            background: locked ? "rgba(251,191,36,0.08)" : "rgba(0,245,212,0.06)",
            border: `1px solid ${locked ? "#fbbf24" : TEAL}`,
            boxShadow: locked ? "0 0 16px rgba(251,191,36,0.3)" : "0 0 16px rgba(0,245,212,0.25)",
            cursor: canManage ? "pointer" : "default",
            opacity: busy ? 0.5 : 1,
          }}
          title={canManage ? (locked ? "点击解锁此对阵" : "点击锁定此对阵") : undefined}
        >
          <span className="font-display font-black text-sm" style={{ color: locked ? "#fbbf24" : TEAL }}>VS</span>
          <span className="text-[9px]">{locked ? "🔒" : canManage ? "🔓" : ""}</span>
          <span className="text-[8px] font-bold tracking-wider text-white/30">M{String(index + 1).padStart(2, "0")}</span>
        </button>
        {canManage && (
          <button onClick={() => onRemove(index)} disabled={busy}
            className="text-[10px] font-bold text-white/25 hover:text-red-400 transition-colors"
            style={{ opacity: busy ? 0.4 : 1, cursor: busy ? "not-allowed" : "pointer" }}
            title="解除此对阵，两支战队将返回剩余战队池">
            ✕ 解除
          </button>
        )}
      </div>
    </div>
  );
}

// Selectable chip in the "剩余战队" pool -- part of Manual Pairing. Up to
// two can be selected at once (order matters only for which becomes
// team A vs team B, which has no gameplay meaning); selecting a third
// while two are already picked replaces the earliest selection so the
// picker never gets stuck.
function RemainingTeamChip({ team, selected, pooled, onClick, disabled, removable }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="flex items-center gap-2 px-3 py-2 rounded-xl transition-all"
      style={{
        background: pooled ? "rgba(251,191,36,0.12)" : selected ? "rgba(0,245,212,0.14)" : "rgba(255,255,255,0.02)",
        border: `1.5px solid ${pooled ? "#fbbf24" : selected ? TEAL : "rgba(255,255,255,0.1)"}`,
        boxShadow: pooled ? "0 0 14px rgba(251,191,36,0.35)" : selected ? "0 0 14px rgba(0,245,212,0.35)" : "none",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled && !selected && !pooled ? 0.5 : 1,
      }}>
      <Avatar avatarUrl={team.captainAvatarUrl} size={22} glow={selected || pooled} />
      <span className="text-[12px] font-bold text-white truncate">{teamLabel(team)}</span>
      {pooled && <span className="text-[10px]" style={{ color: "#fbbf24" }}>{removable ? "✕" : "🔒"}</span>}
    </button>
  );
}

function FinalMatchupsStage({ tournamentName, teams, matchups, pool, isStaff, onBack }) {
  const [busy, setBusy] = useState(null); // null | 'roll' | 'reset' | 'end' | 'pool' | 'unpool:idx' | 'lock:i' | 'remove:i'
  const [error, setError] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [selected, setSelected] = useState([]); // any number of team idx, staged before "Lock Into Pool"

  const teamsByIdx = new Map(teams.map((t) => [t.idx, t]));
  const usedIdx = new Set();
  matchups.forEach((m) => { if (m.a != null) usedIdx.add(m.a); if (m.b != null) usedIdx.add(m.b); });
  const poolSet = new Set(pool);
  const unmatchedTeams = teams.filter((t) => !usedIdx.has(t.idx));
  const pooledTeams = unmatchedTeams.filter((t) => poolSet.has(t.idx));
  const selectableTeams = unmatchedTeams.filter((t) => !poolSet.has(t.idx));

  const lockedCount = matchups.filter((m) => m.locked).length;
  const totalCount = matchups.length;
  const rollScopeSize = pooledTeams.length >= 2 ? pooledTeams.length : unmatchedTeams.length;

  async function run(action, fn) {
    setBusy(action);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message || "操作失败");
    } finally {
      setBusy(null);
    }
  }

  const handleRoll = () => run("roll", () => rollTournamentMatchups());
  const handleToggleLock = (index, nextLocked) => run(`lock:${index}`, () => lockTournamentMatchup(index, nextLocked));
  const handleRemove = (index) => run(`remove:${index}`, () => removeTournamentMatchup(index));
  const handleReset = () => { setConfirmReset(false); setSelected([]); run("reset", () => resetTournamentMatchups()); };
  const handleEnd = () => { setConfirmEnd(false); run("end", () => endTournament()); };

  const toggleSelectTeam = (idx) => {
    setSelected((prev) => (prev.includes(idx) ? prev.filter((v) => v !== idx) : [...prev, idx]));
  };

  const handleLockIntoPool = () => {
    if (selected.length < 2) return;
    run("pool", async () => {
      await lockTeamsIntoPool(selected);
      setSelected([]);
    });
  };

  const handleUnpool = (idx) => run(`unpool:${idx}`, () => unlockTeamFromPool(idx));

  return (
    <div className="w-full flex flex-col flex-1 lg:min-h-0 px-4 sm:px-5 lg:px-6 py-5 gap-4 lg:overflow-hidden">
      <PanelFrame className="shrink-0" style={{ height: HEADER_H, boxSizing: "border-box", overflow: "hidden" }}>
        <div className="h-full flex items-stretch">
          <div className="flex-shrink-0 flex flex-col justify-center gap-2.5 px-5" style={{ borderRight: "1px solid rgba(0,245,212,0.16)" }}>
            <button onClick={onBack}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold border transition-all whitespace-nowrap"
              style={{ background: "rgba(0,245,212,0.05)", borderColor: "rgba(0,245,212,0.28)", color: TEAL_SOFT }}>
              ← 返回选手管理
            </button>
          </div>

          <div className="flex-1 min-w-0 flex flex-col justify-center px-8 gap-1.5">
            {tournamentName && (
              <div className="font-display font-extrabold text-2xl truncate"
                style={{ color: TEAL, textShadow: "0 0 14px rgba(0,245,212,0.45), 0 0 34px rgba(0,245,212,0.2)" }}>
                {tournamentName}
              </div>
            )}
            <div className="flex flex-col items-start gap-2 min-w-0">
              <span className="text-[11px] font-black px-3 py-0.5 rounded-full tracking-widest"
                style={{ background: "rgba(0,245,212,0.12)", color: TEAL, border: `1px solid ${TEAL}55` }}>
                第三阶段 —— 对阵生成
              </span>
              <GlowHeading size="text-3xl" className="font-display">生成最终对阵</GlowHeading>
            </div>
            <div className="text-[11px] text-white/40 truncate">
              全部选手已选完 · 已生成 {totalCount} 组对阵 · 已锁定 {lockedCount} 组 · 剩余 {unmatchedTeams.length} 支战队
              {pooledTeams.length > 0 && <span> · 随机池 {pooledTeams.length} 支</span>}
              {error && <span className="ml-3" style={{ color: "#f87171" }}>⚠ {error}</span>}
            </div>
          </div>

          <div className="flex-shrink-0 flex items-center gap-6 px-8" style={{ borderLeft: "1px solid rgba(0,245,212,0.16)" }}>
            <div className="text-center">
              <div className="font-display font-black text-2xl" style={{ color: TEAL }}>{unmatchedTeams.length}</div>
              <div className="text-[9px] font-semibold text-white/40 tracking-wider mt-0.5">剩余待配对</div>
            </div>
          </div>
        </div>
      </PanelFrame>

      <div className="flex-1 lg:min-h-0 overflow-y-auto flex flex-col gap-4">
        {isStaff && (unmatchedTeams.length > 0) && (
          <PanelFrame className="p-6 shrink-0">
            <h2 className="font-display text-sm font-bold tracking-widest mb-1" style={{ color: "#22c55e" }}>随机池 · 剩余战队（{selectableTeams.length}）</h2>
            <p className="text-[11px] text-white/35 mb-4">
              选择任意数量的战队后点击「加入随机池」——这不会立刻生成对阵，只是把这些战队标记为下一次「随机排位」的范围。随机排位会在池内随机配对（人数为奇数时随机产生一个轮空名额）。
            </p>
            {selectableTeams.length === 0 ? (
              <div className="text-xs text-white/25 py-3">所有剩余战队均已加入随机池。</div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                {selectableTeams.map((t) => (
                  <RemainingTeamChip key={t.idx} team={t} selected={selected.includes(t.idx)}
                    onClick={() => toggleSelectTeam(t.idx)} disabled={busy !== null} />
                ))}
              </div>
            )}
            <div className="flex items-center gap-3 mt-4">
              <button onClick={handleLockIntoPool} disabled={selected.length < 2 || busy !== null}
                className="font-display font-extrabold tracking-wide text-xs px-5 py-2.5 rounded-xl border transition-all"
                style={{
                  background: selected.length >= 2 ? "rgba(34,197,94,0.14)" : "rgba(0,0,0,0.3)",
                  color: selected.length >= 2 ? "#4ade80" : "rgba(255,255,255,0.25)",
                  borderColor: selected.length >= 2 ? "#22c55e" : "rgba(255,255,255,0.08)",
                  boxShadow: selected.length >= 2 ? "0 0 16px rgba(34,197,94,0.35)" : "none",
                  cursor: selected.length >= 2 && busy === null ? "pointer" : "not-allowed",
                }}>
                {busy === "pool" ? "加入中…" : "🔒 加入随机池"}
              </button>
              {selected.length > 0 && (
                <span className="text-[11px] text-white/40">已选择 {selected.length} 支战队</span>
              )}
            </div>

            {pooledTeams.length > 0 && (
              <div className="mt-5 pt-4" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <h3 className="font-display text-[11px] font-bold tracking-widest mb-3" style={{ color: "#fbbf24" }}>
                  已加入随机池（{pooledTeams.length}）—— 随机排位将只在这些战队之间分配
                </h3>
                <div className="flex flex-wrap items-center gap-3">
                  {pooledTeams.map((t) => (
                    <RemainingTeamChip key={t.idx} team={t} pooled removable
                      onClick={() => handleUnpool(t.idx)} disabled={busy !== null} />
                  ))}
                </div>
              </div>
            )}
          </PanelFrame>
        )}

        <PanelFrame className="p-8 flex-1">
          <h2 className="font-display text-sm font-bold tracking-widest mb-6" style={{ color: TEAL }}>已生成对阵 · {totalCount}</h2>
          {totalCount === 0 ? (
            <div className="flex flex-col items-center py-10 text-white/30 text-center">
              <div className="text-3xl mb-2">🎲</div>
              <div className="text-sm">暂无对阵 —— 加入随机池后随机排位，或直接对全部剩余战队随机排位</div>
            </div>
          ) : (
            <div className="grid gap-8" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
              {matchups.map((m, i) => (
                <MatchPair key={i} index={i} matchup={m} teamsByIdx={teamsByIdx} locked={!!m.locked}
                  onToggleLock={handleToggleLock} onRemove={handleRemove} canManage={isStaff}
                  busyLock={busy === `lock:${i}`} busyRemove={busy === `remove:${i}`} />
              ))}
            </div>
          )}
        </PanelFrame>
      </div>

      {isStaff && (
        <PanelFrame className="shrink-0 p-4 flex items-center justify-center gap-4 flex-wrap">
          <button onClick={handleRoll} disabled={busy !== null || rollScopeSize < 2}
            className="font-display font-extrabold tracking-wide text-sm px-6 py-3 rounded-xl border transition-all"
            style={{ background: `linear-gradient(to bottom, ${TEAL}, #00c2a8)`, color: "#000", borderColor: TEAL, boxShadow: "0 0 22px rgba(0,245,212,0.55)", opacity: busy !== null || rollScopeSize < 2 ? 0.4 : 1, cursor: busy !== null ? "not-allowed" : "pointer" }}>
            {busy === "roll" ? "排位中…" : pooledTeams.length >= 2 ? `🎲 随机排位（随机池 ${pooledTeams.length} 支）` : "🎲 随机排位"}
          </button>
          <button onClick={() => setConfirmReset(true)} disabled={busy !== null || (totalCount === 0 && pooledTeams.length === 0)}
            className="font-display font-extrabold tracking-wide text-sm px-6 py-3 rounded-xl border transition-all"
            style={{ background: "rgba(0,0,0,0.3)", color: TEAL_SOFT, borderColor: TEAL_DIM, opacity: busy !== null || (totalCount === 0 && pooledTeams.length === 0) ? 0.4 : 1, cursor: busy !== null ? "not-allowed" : "pointer" }}>
            🔄 重置
          </button>
          <button onClick={() => setConfirmEnd(true)} disabled={busy !== null}
            className="font-display font-extrabold tracking-wide text-sm px-6 py-3 rounded-xl border transition-all"
            style={{ background: "rgba(248,113,113,0.08)", color: "#f87171", borderColor: "#5a1414", opacity: busy !== null ? 0.4 : 1, cursor: busy !== null ? "not-allowed" : "pointer" }}>
            🏁 结束锦标赛
          </button>
          <span className="text-[10px] text-white/25 ml-2">
            {pooledTeams.length >= 2
              ? "🎲 随机排位只会在随机池内的战队之间分配，其余战队不受影响"
              : "🎲 未加入随机池时，随机排位会分配全部剩余战队（人数为奇数时随机产生轮空）"}
          </span>
        </PanelFrame>
      )}

      {confirmReset && (
        <ConfirmDialog
          title="确认重置对阵"
          message="将清除所有已生成的对阵、所有锁定与随机池中的选择，恢复到刚进入最终对阵时的空白状态。此操作无法撤销。"
          confirmLabel="确认重置"
          tone="danger"
          busy={busy === "reset"}
          onCancel={() => setConfirmReset(false)}
          onConfirm={handleReset}
        />
      )}
      {confirmEnd && (
        <ConfirmDialog
          title="确认结束锦标赛"
          message="将结束当前锦标赛：清空所有参赛名单、已选战队与对阵数据，所有已连接用户都会被送回锦标赛大厅。若要参加下一届锦标赛，需要重新点击「参加比赛」。此操作无法撤销。"
          confirmLabel="确认结束"
          tone="danger"
          busy={busy === "end"}
          onCancel={() => setConfirmEnd(false)}
          onConfirm={handleEnd}
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
   was opened (fetch-on-open, same as Tournament Settings -- Section 24);
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
// fallback defaults (Section 16) so behavior is consistent either way.
const SETTINGS_LOAD_FALLBACK = { tournamentName: '', teamCount: 8, playersPerTeam: 5, draftOrder: null }

// Builds the draft's round-order strings (DraftArena's internal
// "12345678"-per-round format) from Tournament Settings: prefers the
// admin's actually-saved draftOrder (Section 16, Draft Order Settings)
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
   (fetchTournamentSettings(), Section 16), and the Captain Pool / Player
   Pool are read from the Tournament Lobby's real joined participants
   (fetchLobby(), Section 16) -- both fetched here on every mount, i.e.
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
  const [tournament, setTournament] = useState(() => initialTournament([]))
  const [finalMatches, setFinalMatches] = useState(null) // { teams, matchups } | null
  const [stage, setStage] = useState('draft') // 'draft' | 'final'
  const [proceedError, setProceedError] = useState(null)

  const isStaff = account && (account.permission_role === 'admin' || account.permission_role === 'developer')

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchTournamentSettings(), fetchLobby()])
      .then(([settings, participants]) => {
        if (cancelled) return
        setTournamentName(settings.tournamentName || '')
        const captainCandidates = participants.filter((p) => p.tournamentRole === 'captain').map(toDraftPlayer)
        const pool = participants.filter((p) => p.tournamentRole === 'player').map(toDraftPlayer)
        setTournament(seedTournament(settings.teamCount, settings.playersPerTeam, buildRoundOrders(settings), captainCandidates, pool))
      })
      .catch(() => {
        if (cancelled) return
        setTournamentName(SETTINGS_LOAD_FALLBACK.tournamentName)
        setTournament(seedTournament(SETTINGS_LOAD_FALLBACK.teamCount, SETTINGS_LOAD_FALLBACK.playersPerTeam, buildRoundOrders(SETTINGS_LOAD_FALLBACK), [], []))
      })
    return () => { cancelled = true }
  }, [])

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
        pool: Array.isArray(row.pool) ? row.pool : [],
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
          pool={finalMatches.pool || []}
          isStaff={isStaff}
          onBack={onExitToLobby || (() => {})}
        />
      ) : (
        <DraftArena
          tournament={tournament}
          setTournament={setTournament}
          onBack={onExitToLobby || (() => {})}
          onProceed={handleProceed}
          tournamentName={tournamentName}
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
