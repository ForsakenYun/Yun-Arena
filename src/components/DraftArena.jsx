import React, { useState, useLayoutEffect, useEffect, useRef } from "react";
import { fetchTournamentSettings, draftRoundCount, generateSnakeDraft, fetchLobby } from "../lib/tournamentApi.js";

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
      className={`p-3 flex-shrink-0 transition-all duration-300 ${isActive ? "scale-[1.03]" : ""} ${canAssign ? "cursor-pointer hover:brightness-125" : ""}`}
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
        background: PLAYER_CARD_BG, border: `${selected ? 3 : 2}px solid ${selected ? "#22c55e" : PLAYER_CARD_BORDER}`,
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

  if (teams.length === 0) return <div className="flex items-center justify-center flex-1 text-white/40">加载中…</div>;

  return (
    <div className="w-full flex flex-col flex-1 lg:min-h-0 px-4 sm:px-5 lg:px-6 py-5 gap-4 lg:overflow-hidden">
      <PanelFrame className="p-4 shrink-0" style={{ height: HEADER_H, boxSizing: "border-box", overflow: "hidden" }}>
        <div className="flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="flex flex-col gap-2 flex-shrink-0">
            <PrimaryButton variant="ghost" onClick={onBack}>← 返回选手管理</PrimaryButton>
            <button onClick={undoLastPick} disabled={draftHistory.length === 0}
              className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wide border transition-all"
              style={{ background: draftHistory.length > 0 ? "rgba(251,191,36,0.08)" : "rgba(0,0,0,0.2)", borderColor: draftHistory.length > 0 ? "#fbbf2466" : "rgba(255,255,255,0.06)", color: draftHistory.length > 0 ? "#fbbf24" : "rgba(255,255,255,0.15)", cursor: draftHistory.length === 0 ? "not-allowed" : "pointer", boxShadow: draftHistory.length > 0 ? "0 0 10px rgba(251,191,36,0.2)" : "none" }}>
              ↩ 撤销上一次选择
              {draftHistory.length > 0 && <span className="ml-1 text-[9px] px-1.5 py-0.5 rounded-full font-black leading-none" style={{ background: "#fbbf2422", color: "#fbbf24" }}>{draftHistory.length}</span>}
            </button>
          </div>
          <div className="text-center flex-1">
            <div className="flex items-center justify-center gap-2 mb-1">
              {tournamentName && (
                <>
                  <span className="text-[10px] font-bold tracking-wide text-white/45 truncate max-w-[180px]">{tournamentName}</span>
                  <span className="w-px h-3 flex-shrink-0" style={{ background: "rgba(255,255,255,0.15)" }} />
                </>
              )}
              <span className="text-[10px] font-black px-3 py-0.5 rounded-full tracking-widest"
                style={{ background: draftPhase === "captain" ? "rgba(34,197,94,0.12)" : "rgba(0,245,212,0.12)", color: draftPhase === "captain" ? "#22c55e" : TEAL, border: `1px solid ${draftPhase === "captain" ? "rgba(34,197,94,0.4)" : TEAL+"55"}` }}>
                {draftPhase === "captain" ? "第一阶段 —— 队长分配" : "第二阶段 —— 队员选秀"}
              </span>
            </div>
            {draftPhase === "captain" ? (
              <><GlowHeading size="text-xl" className="font-display">{selectedCaptain ? `将 ${selectedCaptain.name.toUpperCase()} 分配到战队` : "选择一名队长"}</GlowHeading>
              <div className="text-[11px] text-white/40 mt-1">{selectedCaptain ? "现在点击下方一张空战队卡片（点击整张卡片即可）→" : `剩余${captainCandidates.length}人 · 已分配${8-captainCandidates.length}/8`}</div></>
            ) : allDrafted ? <GlowHeading size="text-xl" className="font-display">全部选手已选完 🏆</GlowHeading> : (
              <><div className="text-[11px] tracking-[0.3em] font-bold mb-1" style={{ color: "rgba(125,243,225,0.6)" }}>第{roundLabel}轮，共{roundOrders.length}轮</div>
              <GlowHeading size="text-xl" className="font-display">{teams[activeTeamIdx]?.captain?.name?.toUpperCase()} 的选人回合</GlowHeading>
              <div className="text-[11px] text-white/40 mt-1">战队{activeTeamIdx+1} · 第{pickIndex+1}/{customSnakeOrder.length}顺位</div></>
            )}
          </div>
          <div className="flex-shrink-0">
            <PrimaryButton onClick={onProceed} disabled={!allDrafted}>进入最终对阵 →</PrimaryButton>
          </div>
        </div>
        <div className="mt-4 flex gap-2 items-center text-[9px] text-white/30">
          <span className="w-16 text-right">队长</span>
          <div className="w-36 h-1.5 rounded-full bg-black/50 overflow-hidden border" style={{ borderColor: "rgba(34,197,94,0.2)" }}>
            <div className="h-full transition-all duration-500" style={{ width: `${((8-captainCandidates.length)/8)*100}%`, background: "linear-gradient(to right,#16a34a,#22c55e)", boxShadow: "0 0 8px #22c55e" }} />
          </div>
          <span className="w-20 text-center">队员</span>
          <div className="flex-1 h-1.5 rounded-full bg-black/50 overflow-hidden border" style={{ borderColor: TEAL_DIM }}>
            <div className="h-full transition-all duration-500" style={{ width: draftPhase === "teammate" ? `${(pickIndex/customSnakeOrder.length)*100}%` : "0%", background: `linear-gradient(to right,${TEAL},#0ea5e9)`, boxShadow: "0 0 8px #00f5d4" }} />
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
      <div className="flex-1 lg:min-h-0 flex flex-col gap-4 lg:overflow-hidden">
        {draftPhase === "teammate" && (
          <div className="shrink-0">
            <DraftSequenceStrip customSnakeOrder={customSnakeOrder} pickIndex={pickIndex} roundOrders={roundOrders} draftFinished={allDrafted} />
          </div>
        )}

        <div className="lg:basis-2/5 lg:shrink lg:min-h-0 overflow-y-auto p-8">
          <div className="flex flex-wrap gap-x-6 gap-y-8 pb-1">
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
              <div className="flex-1 lg:min-h-0 overflow-y-auto pr-1">
                <div className="flex flex-wrap gap-x-4 gap-y-4">
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
                <div className="flex-1 lg:min-h-0 overflow-y-auto pr-1">
                  <div className="flex flex-wrap gap-x-4 gap-y-4">
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
export default function DraftArenaPage({ onExitToLobby }) {
  const [tournamentName, setTournamentName] = useState('')
  const [tournament, setTournament] = useState(() => initialTournament([]))

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

  return (
    <div className="min-h-screen w-full text-white font-sans flex flex-col lg:h-screen lg:overflow-hidden" style={{ background: "radial-gradient(ellipse at top, #0b1716 0%, #050807 55%, #020303 100%)" }}>
      <GlobalStyle />
      <DraftArena
        tournament={tournament}
        setTournament={setTournament}
        onBack={onExitToLobby || (() => {})}
        onProceed={() => {}}
        tournamentName={tournamentName}
      />
    </div>
  );
}
