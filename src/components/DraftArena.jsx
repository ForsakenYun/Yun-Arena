import React, { useState, useLayoutEffect, useEffect, useRef, useMemo } from "react";
import {
  fetchTournamentSettings, draftRoundCount, generateSnakeDraft, fetchLobby,
  fetchFinalMatchups, subscribeFinalMatchups, enterFinalMatchups, rollTournamentMatchupsPool,
  lockTournamentMatchup, resetTournamentMatchups, endTournament, toFinalMatchupTeam,
  createManualMatchup, removeTournamentMatchup, syncDraftState, fetchDraftState,
} from "../lib/tournamentApi.js";
import ConfirmDialog from "./ConfirmDialog.jsx";
import AppShell from "./AppShell.jsx";

/* ════════════════════════════════════════════════════════════════════════
   CONSTANTS & THEME (unchanged from Dashboard.jsx)
   ════════════════════════════════════════════════════════════════════════ */
const TEAL = "#22E5FF";
const TEAL_DIM = "#2B3159";
const TEAL_SOFT = "#8FEEFF";
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
    <h1 className={`${size} font-display font-black tracking-wide text-gradient ${className}`}
      style={{ filter: "drop-shadow(0 0 18px rgba(124,92,255,0.45)) drop-shadow(0 0 34px rgba(34,229,255,0.25))", letterSpacing: "0.04em" }}>
      {children}
    </h1>
  );
}

function PanelFrame({ children, className = "", onClick, style, ...rest }) {
  return (
    <div className={`relative rounded-2xl border backdrop-blur-sm ${className}`} onClick={onClick}
      style={{ background: "linear-gradient(160deg, rgba(22,26,51,0.92), rgba(14,16,32,0.96))", borderColor: "rgba(124,92,255,0.22)", boxShadow: "0 0 0 1px rgba(124,92,255,0.06), 0 0 30px rgba(124,92,255,0.10)", ...style }}
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
  const filled = team.slots.filter(Boolean).length + (team.captain ? 1 : 0);
  const total = team.slots.length + 1;
  return (
    <div
      data-team-panel={teamIdx}
      onClick={canAssign ? () => onAssignCaptain(teamIdx) : undefined}
      className={`relative rounded-xl border px-3 py-3 transition-all duration-300 ${canAssign ? "cursor-pointer" : ""}`}
      style={{
        background: isActive ? "linear-gradient(160deg, rgba(34,229,255,0.12), rgba(14,16,32,0.96))" : "linear-gradient(160deg, rgba(22,26,51,0.85), rgba(14,16,32,0.9))",
        borderColor: isActive ? TEAL : canAssign ? "#22c55e" : "rgba(43,49,89,0.7)",
        borderStyle: canAssign ? "dashed" : "solid",
        boxShadow: isActive ? `0 0 0 1px ${TEAL}55, 0 0 22px ${TEAL}33` : canAssign ? "0 0 14px rgba(34,197,94,0.2)" : "none",
      }}>
      {/* header row: name + fill progress + live indicator, all on one line */}
      <div className="flex items-center gap-2 mb-2.5">
        <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-black shrink-0"
          style={{ background: isActive ? TEAL : "rgba(255,255,255,0.06)", color: isActive ? "#06070F" : "rgba(255,255,255,0.4)" }}>
          {teamIdx + 1}
        </span>
        <span className="text-[11px] font-bold tracking-wide truncate flex-1" style={{ color: isActive ? TEAL : "rgba(255,255,255,0.85)" }}>{displayName}</span>
        {isActive && <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full shrink-0 animate-pulse" style={{ background: "linear-gradient(135deg,#7C5CFF,#22E5FF)", color: "#06070F" }}>选人中</span>}
        <span className="text-[9px] font-mono text-white/30 shrink-0">{filled}/{total}</span>
      </div>

      {/* captain slot */}
      <div className="flex items-center gap-2 mb-1.5 px-2 rounded-lg w-full"
        data-slot-key={`cap:${teamIdx}`}
        style={{
          height: CAPTAIN_SLOT_H, boxSizing: "border-box", overflow: "hidden", opacity: captainHidden ? 0 : 1,
          background: canAssign ? "rgba(34,197,94,0.08)" : "rgba(0,0,0,0.3)",
          border: canAssign ? "1px dashed #22c55e" : "1px solid rgba(255,255,255,0.04)",
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
              <div className="text-[10.5px] font-bold text-white truncate leading-tight">{team.captain.name}</div>
            </div>
            <CaptainBadge />
          </>
        ) : (
          <div className="flex items-center gap-2 w-full">
            <div className="w-[26px] h-[26px] rounded-md border border-dashed border-white/15 flex items-center justify-center text-white/20 text-[10px] flex-shrink-0">?</div>
            <span className="text-[10px] italic text-white/25">等待队长</span>
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
              className={`flex items-center gap-1.5 px-1.5 py-1 rounded-md border text-[10px] ${slot ? "bg-black/25" : "bg-black/10 border-dashed border-white/10 text-white/25"}`}
              style={{ ...(slot ? { borderColor: TEAL_DIM } : {}), opacity: slotHidden ? 0 : 1 }}>
              <span className="w-4 h-4 flex items-center justify-center rounded text-[8px] font-bold flex-shrink-0"
                style={{ background: slot ? `${TEAL}22` : "transparent", color: slot ? TEAL : "#3a4a4a", border: `1px solid ${slot ? TEAL+"55" : "#1c2b2e"}` }}>
                {POSITIONS[i % 5]?.id ?? "?"}
              </span>
              {slot ? (
                <>
                  <Avatar avatarId={slot.avatarId} avatarUrl={slot.avatarUrl} size={17} />
                  <div className="min-w-0 flex-1 truncate font-semibold text-white text-[10px]">{slot.name}</div>
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
const PLAYER_CARD_BG = "linear-gradient(155deg, #1B2040 0%, #12142A 100%)";
const PLAYER_CARD_BORDER = "rgba(124,92,255,0.4)";
const PLAYER_CARD_STAT_BG = "rgba(6,7,15,0.55)";
const PLAYER_CARD_STAT_BORDER = "rgba(124,92,255,0.2)";
const PLAYER_CARD_TEXT = "#F4F2FF";
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

function PlayerStatCard({ player, onClick, disabled, selected, badge }) {
  const stats = placeholderStats(player.id);
  return (
    <button onClick={onClick} disabled={disabled} type="button" data-card-id={player.id}
      className={`relative text-left rounded-xl transition-all duration-200 w-full ${disabled ? "" : "hover:-translate-y-0.5"}`}
      style={{
        padding: PLAYER_CARD_PAD,
        background: PLAYER_CARD_BG, border: `2px solid ${selected ? "#22c55e" : PLAYER_CARD_BORDER}`,
        boxShadow: selected ? "0 0 0 3px rgba(34,197,94,0.3), 0 0 18px rgba(34,197,94,0.35)" : "0 0 0 1px rgba(124,92,255,0.08), 0 6px 16px rgba(4,3,15,0.4)",
        opacity: disabled ? 0.35 : 1, cursor: disabled ? "not-allowed" : "pointer",
      }}>
      {badge && (
        <span className="absolute z-10 font-black rounded-full"
          style={{ top: 6, right: 6, background: "#22c55e", color: "#04150a", fontSize: 8, padding: "2px 6px" }}>
          {badge}
        </span>
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
      ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #06070F; }
      ::-webkit-scrollbar-thumb { background: linear-gradient(180deg, #7C5CFF, #22E5FF); border-radius: 4px; }
      input::placeholder { color: rgba(255,255,255,0.2); }
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

function DraftSequenceStrip({ customSnakeOrder, pickIndex, roundOrders, draftFinished }) {
  return (
    <PanelFrame className="p-4 mb-4 overflow-x-auto">
      <div className="flex flex-row items-center gap-1 flex-wrap">
        {customSnakeOrder.map((pick, idx) => {
          const isPast = idx < pickIndex; const isCurrent = idx === pickIndex;
          const isRoundStart = idx === 0 || pick.round !== customSnakeOrder[idx-1].round;
          return (
            <React.Fragment key={idx}>
              {isRoundStart && idx > 0 && <div className="flex items-center mx-1"><div className="w-px h-7" style={{ background: "rgba(34,229,255,0.2)" }} /></div>}
              <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
                <span className="text-[7px] font-black tracking-wider" style={{ color: isRoundStart ? "rgba(34,229,255,0.45)" : "transparent" }}>{isRoundStart ? `R${pick.round}` : "."}</span>
                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-black transition-all duration-200"
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
    <div className="w-full flex flex-col flex-1 lg:min-h-0 lg:overflow-hidden">
      {/* ═══ STATUS STRIP — flush under the shared AppShell bar, not a
          floating card. This is the "what's happening right now" line:
          phase → who's on the clock → progress → the one action that
          matters. Back/exit lives in AppShell now (backAction), so this
          strip only carries draft-specific controls (Undo, Proceed). ═══ */}
      <div className="shrink-0 border-b border-panel-line/80 bg-void/30 backdrop-blur-sm px-5 sm:px-8 h-20 flex items-center gap-6">
        <div className="flex-1 min-w-0 flex items-center gap-4">
          <span
            className="shrink-0 text-[10px] font-black px-2.5 py-1 rounded-full tracking-widest"
            style={{
              background: draftPhase === "captain" ? "rgba(34,197,94,0.12)" : "rgba(34,229,255,0.12)",
              color: draftPhase === "captain" ? "#22c55e" : TEAL,
              border: `1px solid ${draftPhase === "captain" ? "rgba(34,197,94,0.4)" : TEAL + "55"}`,
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
              <GlowHeading size="text-xl" className="truncate block">{teams[activeTeamIdx]?.captain?.name?.toUpperCase()} 的选人回合</GlowHeading>
            )}
            <div className="text-[10.5px] text-white/40 truncate mt-0.5">
              {draftPhase === "captain"
                ? (effectiveSelectedCaptain ? "现在点击左侧一张空战队卡片 →" : `剩余${captainCandidates.length}人 · 已分配${8-captainCandidates.length}/8`)
                : (!allDrafted && <>第{roundLabel}轮，共{roundOrders.length}轮 · 战队{activeTeamIdx+1} · 第{pickIndex+1}/{customSnakeOrder.length}顺位</>)}
            </div>
          </div>
        </div>

        {isStaff && (
          <button onClick={undoLastPick} disabled={draftHistory.length === 0}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-all whitespace-nowrap"
            style={{ background: draftHistory.length > 0 ? "rgba(251,191,36,0.08)" : "rgba(0,0,0,0.2)", borderColor: draftHistory.length > 0 ? "#fbbf2466" : "rgba(255,255,255,0.06)", color: draftHistory.length > 0 ? "#fbbf24" : "rgba(255,255,255,0.15)", cursor: draftHistory.length === 0 ? "not-allowed" : "pointer" }}>
            ↩ 撤销
            {draftHistory.length > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-black leading-none" style={{ background: "#fbbf2422", color: "#fbbf24" }}>{draftHistory.length}</span>}
          </button>
        )}

        <div className="shrink-0 flex items-center gap-4">
          <div className="relative" style={{ width: 52, height: 52 }}>
            <svg width="52" height="52" style={{ transform: "rotate(-90deg)" }}>
              <circle cx="26" cy="26" r={HEADER_RING_R * 0.7} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
              <circle cx="26" cy="26" r={HEADER_RING_R * 0.7} fill="none" stroke={headerRingColor} strokeWidth="5"
                strokeDasharray={HEADER_RING_CIRC * 0.7} strokeDashoffset={headerRingOffset * 0.7} strokeLinecap="round"
                style={{ transition: "stroke-dashoffset 500ms" }} />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center font-display font-bold text-[11px]" style={{ color: headerRingColor }}>
              {Math.round(headerProgressPct)}%
            </div>
          </div>
          {isStaff && (
            <button onClick={onProceed} disabled={!allDrafted}
              className="font-bold text-xs px-4 py-2.5 rounded-lg border whitespace-nowrap transition-all"
              style={{ background: "rgba(34,229,255,0.07)", borderColor: allDrafted ? TEAL : "rgba(255,255,255,0.08)", color: allDrafted ? TEAL_SOFT : "rgba(255,255,255,0.2)", boxShadow: allDrafted ? "0 0 18px rgba(34,229,255,0.28)" : "none", cursor: allDrafted ? "pointer" : "not-allowed" }}>
              进入最终对阵 →
            </button>
          )}
        </div>
      </div>

      {/* ═══ BODY — same rail + main composition used by Lobby (roster +
          action rail) and Admin (section nav + table): a team-overview
          rail on the left, the draftable pool as the dominant content on
          the right. Reversed from Lobby/Admin (rail-left here since teams
          are reference context for the pool, not the primary action
          surface) but built from the same shared shapes. ═══ */}
      <div className="flex-1 lg:min-h-0 flex flex-col lg:flex-row lg:overflow-hidden">
        <aside className="lg:w-[280px] shrink-0 lg:h-full lg:overflow-y-auto px-4 sm:px-5 lg:px-4 py-4 flex flex-col gap-2.5">
          <p className="eyebrow px-1">战队总览 · {teams.length}</p>
          {teams.map((team, i) => (
            <TeamCard key={i} team={team} activeTeamIdx={activeTeamIdx} teamIdx={i}
              assignable={draftPhase === "captain" && !!effectiveSelectedCaptain}
              onAssignCaptain={handleTeamSlotClick}
              hiddenKeys={hiddenKeys} />
          ))}
        </aside>

        <div className="flex-1 lg:min-h-0 flex flex-col lg:overflow-hidden border-t lg:border-t-0 lg:border-l border-panel-line/80">
          {draftPhase === "teammate" && (
            <div className="shrink-0 px-5 sm:px-6 pt-3">
              <DraftSequenceStrip customSnakeOrder={customSnakeOrder} pickIndex={pickIndex} roundOrders={roundOrders} draftFinished={allDrafted} />
            </div>
          )}

          {draftPhase === "captain" && (
            <div className="flex flex-col flex-1 lg:min-h-0 lg:overflow-hidden px-5 sm:px-6 py-4">
              <div className="flex items-center justify-between shrink-0 mb-3">
                <h2 className="font-display text-sm font-bold tracking-widest" style={{ color: "#22c55e" }}>队长候选池</h2>
                <span className="text-xs font-mono text-white/30">{captainCandidates.length} 人未分配</span>
              </div>
              <div className="flex-1 lg:min-h-0 overflow-y-auto">
                <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
                  {captainCandidates.map((c) => (
                    <PlayerStatCard key={c.id} player={c} onClick={() => handleCaptainClick(c)} selected={effectiveSelectedCaptain?.id === c.id} badge="队长" />
                  ))}
                  {captainCandidates.length === 0 && <div className="flex flex-col items-center py-8 text-white/30 text-center col-span-full"><div className="text-3xl mb-2">✅</div><div className="text-sm">所有队长已分配完毕！</div></div>}
                </div>
              </div>
              {isStaff && allCaptainsAssigned && (
                <button onClick={startTeammateDraft} disabled={!roundOrderValid.every(Boolean)}
                  className="w-full mt-4 py-3 rounded-xl font-extrabold tracking-widest text-sm uppercase border transition-all shrink-0"
                  style={{ background: roundOrderValid.every(Boolean) ? `linear-gradient(135deg, #7C5CFF, #22E5FF)` : "rgba(0,0,0,0.3)", color: roundOrderValid.every(Boolean) ? "#06070F" : "rgba(255,255,255,0.2)", borderColor: roundOrderValid.every(Boolean) ? TEAL : "rgba(255,255,255,0.08)", boxShadow: roundOrderValid.every(Boolean) ? "0 0 22px rgba(124,92,255,0.5)" : "none", cursor: roundOrderValid.every(Boolean) ? "pointer" : "not-allowed" }}>
                  {roundOrderValid.every(Boolean) ? "🚀 锁定并开始队员选秀 →" : "⚠ 请先修正轮次顺序"}
                </button>
              )}
            </div>
          )}

          {draftPhase === "teammate" && (
            <div className="flex flex-col flex-1 lg:min-h-0 lg:overflow-hidden px-5 sm:px-6 py-4">
              <div className="flex items-center justify-between shrink-0 mb-3">
                <h2 className="font-display text-sm font-bold tracking-widest" style={{ color: TEAL }}>待选选手</h2>
                <span className="text-xs font-mono text-white/30">{pool?.length ?? 0} 人待选</span>
              </div>
              {pool && pool.length > 0 ? (
                <div className="flex-1 lg:min-h-0 overflow-y-auto">
                  <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
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
@media (prefers-reduced-motion: reduce) {
  #fmpStage2, #fmpStage2 * { animation-duration: 0.001ms !important; }
}
`;

// Ornate corner-bracket "broadcast frame" around a featured VS pair --
// purely decorative chrome around content that's already centered in the
// spotlight card; doesn't add or move any layout region. `pulse` plays a
// one-shot glow burst (keyed by the caller) the instant a match locks in.
function BroadcastFrame({ children, pulse = false, glowColor = "rgba(34,229,255,.9)" }) {
  return (
    <div className="relative px-10 py-8 sm:px-16 sm:py-10 rounded-2xl"
      style={{
        border: "1px solid rgba(124,92,255,.35)",
        background: "rgba(6,7,15,.35)",
        animation: pulse ? "fmpFrameGlow 1s ease-out" : undefined,
      }}>
      {[
        "-top-1 -left-1 border-t-2 border-l-2 rounded-tl-md",
        "-top-1 -right-1 border-t-2 border-r-2 rounded-tr-md",
        "-bottom-1 -left-1 border-b-2 border-l-2 rounded-bl-md",
        "-bottom-1 -right-1 border-b-2 border-r-2 rounded-br-md",
      ].map((cls, i) => (
        <span key={i} className={`absolute ${cls} w-5 h-5 pointer-events-none`} style={{ borderColor: glowColor }} />
      ))}
      {children}
    </div>
  );
}


function TeamFace({ team, dim = false, animateIn = false }) {
  const name = team ? teamLabel(team) : "？？？";
  return (
    <div className={`flex flex-col items-center gap-3 transition-opacity ${dim ? "opacity-40" : ""}`} style={{ minWidth: 112 }}>
      <Avatar avatarUrl={team?.captainAvatarUrl} size={72} glow />
      <span className="font-display font-bold text-xl sm:text-2xl text-ink-primary text-center leading-tight max-w-[220px] truncate"
        style={animateIn ? { animation: "fmpNameSlam .6s cubic-bezier(.2,.8,.2,1) forwards", textShadow: "0 0 26px rgba(34,229,255,.55)" } : undefined}>
        {name}
      </span>
      <span className="text-[9px] font-heading font-semibold tracking-[0.3em] text-ink-faint uppercase">Captain</span>
    </div>
  );
}

function RosterRow({ team, status }) {
  const isUsed = status !== "idle";
  return (
    <div className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg border transition-colors duration-500 ${
      isUsed ? "border-accent2/35 bg-accent2/5" : "border-panel-line bg-void/30"
    }`}>
      <Avatar avatarUrl={team.captainAvatarUrl} size={28} glow={isUsed} />
      <span className={`flex-1 min-w-0 truncate text-xs font-heading font-semibold ${isUsed ? "text-accent2" : "text-ink-muted"}`}>
        {teamLabel(team)}
      </span>
      {status === "bye" && (
        <span className="shrink-0 text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-white/10 text-white/50">轮空</span>
      )}
    </div>
  );
}

function PoolChip({ team, selected, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-2.5 py-1.5 rounded-lg border text-xs font-heading font-semibold transition-all ${
        selected ? "border-accent2 bg-accent2/15 text-white shadow-accent-glow" : "border-panel-line bg-void/30 text-ink-muted hover:border-accent2/40 hover:text-ink-primary"
      }`}>
      {teamLabel(team)}
    </button>
  );
}

function FilmChip({ idx, match, teamByIdx, active, onClick }) {
  const a = teamByIdx.get(match.a);
  const b = match.b != null ? teamByIdx.get(match.b) : null;
  return (
    <button type="button" onClick={onClick}
      className={`shrink-0 w-[140px] px-2.5 py-2 rounded-lg border text-left transition-all ${
        active ? "border-accent2 shadow-accent-glow bg-accent2/10" : "border-panel-line bg-void/30 hover:border-panel-line/60 hover:bg-panel-alt/40"
      }`}>
      <div className="text-[8px] font-mono text-ink-faint mb-0.5 tracking-wider">MATCH {String(idx + 1).padStart(2, "0")}</div>
      <div className="text-[11px] font-heading font-semibold text-ink-primary truncate">
        {b ? `${a?.captainName ?? "?"} / ${b.captainName ?? "?"}` : `${a?.captainName ?? "?"} 轮空`}
      </div>
    </button>
  );
}

export function FinalMatchupsStage({ tournamentName, teams, matchups, isStaff }) {
  const initialMatches = useMemo(() => matchups.map((m) => ({ a: m.a, b: m.b, locked: !!m.locked })), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [displayTeams, setDisplayTeams] = useState(teams);
  const [displayMatches, setDisplayMatches] = useState(initialMatches);
  const [selected, setSelected] = useState([]);
  const [featuredIdx, setFeaturedIdx] = useState(() => {
    if (initialMatches.length === 0) return null;
    return computeComplete(initialMatches, teams) ? null : initialMatches.length - 1;
  });
  const [reveal, setReveal] = useState(null); // { idx, phase: 'countdown'|'flicker'|'reveal', n, flickerA, flickerB }
  const [busyAction, setBusyAction] = useState(null);
  const [error, setError] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const revealingRef = useRef(false);
  const displayMatchesRef = useRef(displayMatches);
  const pendingActionRef = useRef({ reset: null, end: null });
  useEffect(() => { displayMatchesRef.current = displayMatches; }, [displayMatches]);

  const teamByIdx = useMemo(() => new Map(displayTeams.map((t) => [t.idx, t])), [displayTeams]);
  const usedIdxs = useMemo(() => computeUsedIdxs(displayMatches), [displayMatches]);
  const remaining = useMemo(() => displayTeams.filter((t) => !usedIdxs.has(t.idx)), [displayTeams, usedIdxs]);
  const byeIdxs = useMemo(() => new Set(displayMatches.filter((m) => m.a != null && m.b == null).map((m) => m.a)), [displayMatches]);
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
      setFeaturedIdx(idx);
      for (const n of [3, 2, 1]) { setReveal({ idx, phase: "countdown", n }); await fmpWait(600); }
      for (let f = 0; f < 8; f++) {
        const flickerA = labelTeams[Math.floor(Math.random() * labelTeams.length)] || null;
        const flickerB = labelTeams[Math.floor(Math.random() * labelTeams.length)] || null;
        setReveal({ idx, phase: "flicker", flickerA, flickerB });
        await fmpWait(110);
      }
      setDisplayMatches((prev) => { const next = prev.slice(); next[idx] = appended[k]; return next; });
      setReveal({ idx, phase: "reveal" });
      await fmpWait(1100);
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

  async function handleRemove() {
    if (featuredIdx == null || busyAction || reveal) return;
    const idx = featuredIdx;
    await withBusy(`remove:${idx}`, async () => {
      const result = await removeTournamentMatchup(idx);
      const newTeams = result.teams && result.teams.length > 0 ? result.teams : teams;
      const newMatches = (result.matchups || []).map((m) => ({ a: m.a, b: m.b, locked: !!m.locked }));
      setDisplayTeams(newTeams);
      setDisplayMatches(newMatches);
      setFeaturedIdx(newMatches.length > 0 ? Math.min(idx, newMatches.length - 1) : null);
    });
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
    pendingActionRef.current.end = () => withBusy("end", async () => { await endTournament(); });
    setConfirmEnd(true);
  }

  const featured = featuredIdx != null ? displayMatches[featuredIdx] : null;
  const rollDisabled = busyAction || !!reveal || complete || (selected.length === 0 && remaining.length < 1);
  const lockDisabled = busyAction || !!reveal || selected.length < 2;

  return (
    <div id="fmpStage2" className="w-full flex flex-col flex-1 lg:min-h-0 lg:overflow-hidden">
      <style>{FMP_ANIM_CSS}</style>

      {/* status strip -- same flat, flush-under-the-shell idiom as Draft Arena's own status strip */}
      <div className="shrink-0 border-b border-panel-line/80 bg-void/30 backdrop-blur-sm px-5 sm:px-8 h-20 flex items-center gap-6">
        <div className="flex-1 min-w-0 flex items-center gap-4">
          <span className="shrink-0 text-[10px] font-black px-2.5 py-1 rounded-full tracking-widest"
            style={{
              background: complete ? "rgba(34,229,255,.12)" : "rgba(124,92,255,.12)",
              color: complete ? "#22E5FF" : "#A78BFA",
              border: `1px solid ${complete ? "rgba(34,229,255,.4)" : "rgba(124,92,255,.35)"}`,
            }}>
            {complete ? "对阵已就绪" : "对阵抽签"}
          </span>
          <GlowHeading size="text-xl" className="truncate block">
            {reveal ? `MATCH ${String(reveal.idx + 1).padStart(2, "0")} 生成中…`
              : complete ? "全部对阵已生成 🏆"
              : featured ? `MATCH ${String(featuredIdx + 1).padStart(2, "0")}`
              : "等待生成首个对阵"}
          </GlowHeading>
        </div>
      </div>

      {/* body: roster + pairing rail, spotlight reveal as the dominant surface */}
      <div className="flex-1 lg:min-h-0 flex flex-col lg:flex-row lg:overflow-hidden">
        <aside className="lg:w-[280px] shrink-0 lg:h-full lg:overflow-y-auto px-4 sm:px-5 lg:px-4 py-4 flex flex-col gap-2">
          <p className="eyebrow px-1">参赛战队 · {displayTeams.length}</p>
          {displayTeams.map((t) => (
            <RosterRow key={t.idx} team={t} status={byeIdxs.has(t.idx) ? "bye" : usedIdxs.has(t.idx) ? "used" : "idle"} />
          ))}
          {isStaff && (
            <>
              <p className="eyebrow px-1 mt-3">选择配对战队</p>
              <div className="flex flex-wrap gap-1.5">
                {remaining.length === 0 ? (
                  <span className="text-xs text-ink-faint px-1 py-1">全部战队已配对</span>
                ) : (
                  remaining.map((t) => (
                    <PoolChip key={t.idx} team={t} selected={selected.includes(t.idx)} onClick={() => toggleSelect(t.idx)} />
                  ))
                )}
              </div>
            </>
          )}
        </aside>

        <div className="flex-1 lg:min-h-0 flex flex-col lg:overflow-hidden border-t lg:border-t-0 lg:border-l border-panel-line/80 px-5 sm:px-6 py-4 gap-4">
          {/* spotlight */}
          <div className="relative flex-1 min-h-[380px] rounded-2xl border overflow-hidden flex items-center justify-center p-8 sm:p-10"
            style={{
              background: "radial-gradient(ellipse at 50% 0%, rgba(124,92,255,.14), transparent 60%), linear-gradient(180deg,#141833,#0a0c1c 80%)",
              borderColor: complete ? "rgba(34,229,255,.35)" : "rgba(124,92,255,.25)",
            }}>
            {reveal?.phase === "reveal" && (
              <div key={`flash-${reveal.idx}`} className="absolute inset-0 pointer-events-none"
                style={{
                  animation: "fmpFlashBurst .8s ease-out forwards",
                  background: "radial-gradient(circle at 50% 45%, rgba(255,255,255,.55), rgba(124,92,255,.5) 30%, rgba(34,229,255,.3) 50%, transparent 72%)",
                }} />
            )}
            {complete && featuredIdx === null ? (
              <div key={displayMatches.length} className="w-full max-w-2xl flex flex-col items-center gap-6" style={{ animation: "fmpSlamIn .7s ease forwards" }}>
                <div className="text-[11px] font-heading font-semibold uppercase tracking-[0.3em] text-accent2/90">对阵表已揭晓 · Final Lineup</div>
                <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {displayMatches.map((m, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-panel-alt/50 border border-panel-line"
                      style={{ animation: "fmpRowIn .45s ease forwards", animationDelay: `${i * 110}ms`, opacity: 0 }}>
                      <span className="text-[10px] font-mono text-accent2/70 w-6 shrink-0">0{i + 1}</span>
                      <span className="flex-1 min-w-0 text-sm font-heading font-semibold text-ink-primary truncate">{teamByIdx.get(m.a)?.captainName ?? "?"}</span>
                      {m.b != null ? (
                        <>
                          <span className="shrink-0 text-[10px] font-display font-black text-accent-soft">VS</span>
                          <span className="flex-1 min-w-0 text-sm font-heading font-semibold text-ink-primary truncate text-right">{teamByIdx.get(m.b)?.captainName ?? "?"}</span>
                        </>
                      ) : (
                        <span className="shrink-0 text-xs text-ink-muted">轮空 · 直接晋级</span>
                      )}
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
                  <div className="font-display font-black text-white"
                    style={{ fontSize: 140, animation: "fmpCountPulse .6s cubic-bezier(.2,.8,.3,1) forwards", textShadow: "0 0 80px rgba(124,92,255,.9), 0 0 140px rgba(34,229,255,.5)" }}>
                    {reveal.n}
                  </div>
                </div>
              ) : (
                <BroadcastFrame pulse={reveal.phase === "reveal"} glowColor={reveal.phase === "reveal" ? "#7C5CFF" : "#22E5FF"}>
                  <div key={reveal.phase} className="flex items-center gap-8 sm:gap-14"
                    style={{ animation: reveal.phase === "flicker" ? "fmpFlicker .35s ease-in-out infinite" : undefined }}>
                    <TeamFace team={reveal.phase === "reveal" ? teamByIdx.get(displayMatches[reveal.idx]?.a) : reveal.flickerA} animateIn={reveal.phase === "reveal"} />
                    <span className="font-display font-black text-2xl sm:text-3xl text-accent-soft shrink-0"
                      style={reveal.phase === "reveal" ? { animation: "fmpVsPop .5s cubic-bezier(.2,.8,.2,1) forwards" } : undefined}>
                      VS
                    </span>
                    <TeamFace
                      team={reveal.phase === "reveal" ? teamByIdx.get(displayMatches[reveal.idx]?.b) : reveal.flickerB}
                      dim={reveal.phase === "reveal" && displayMatches[reveal.idx]?.b == null}
                      animateIn={reveal.phase === "reveal"}
                    />
                  </div>
                </BroadcastFrame>
              )
            ) : featured ? (
              <div key={featuredIdx} className="flex flex-col items-center gap-6" style={{ animation: "fmpSlamIn .5s ease forwards" }}>
                <BroadcastFrame glowColor="rgba(124,92,255,.6)">
                  <div className="flex items-center gap-8 sm:gap-14">
                    <TeamFace team={teamByIdx.get(featured.a)} />
                    {featured.b != null ? (
                      <>
                        <span className="font-display font-black text-2xl sm:text-3xl text-accent-soft shrink-0">VS</span>
                        <TeamFace team={teamByIdx.get(featured.b)} />
                      </>
                    ) : (
                      <span className="px-4 py-2 rounded-lg bg-accent2/10 border border-accent2/40 text-accent2 font-heading font-bold text-sm whitespace-nowrap">轮空 · 直接晋级</span>
                    )}
                  </div>
                </BroadcastFrame>
                {complete && (
                  <button type="button" onClick={() => setFeaturedIdx(null)} className="text-xs text-ink-muted hover:text-accent2 transition font-heading">
                    ← 返回完整对阵表
                  </button>
                )}
              </div>
            ) : (
              <div className="text-center text-ink-faint text-sm max-w-xs leading-relaxed">
                敬请期待首个对阵公布
                <br />
                手动配对或随机生成开启序幕
              </div>
            )}
          </div>

          {/* filmstrip */}
          {displayMatches.length > 0 && (
            <div className="shrink-0 flex gap-2 overflow-x-auto pb-1">
              {displayMatches.map((m, i) => (
                <FilmChip key={i} idx={i} match={m} teamByIdx={teamByIdx} active={featuredIdx === i}
                  onClick={() => { if (!reveal) setFeaturedIdx(i); }} />
              ))}
            </div>
          )}

          {/* actions */}
          {isStaff && (
            <div className="shrink-0 flex items-center gap-3 flex-wrap">
              <button type="button" onClick={handleLockOrRoll} disabled={lockDisabled} className="btn-primary px-4 py-2.5 text-sm">
                🎬 定角锁定
              </button>
              <button type="button" onClick={handleRoll} disabled={rollDisabled} className="btn-primary px-4 py-2.5 text-sm">
                🎞️ 随机生成剩余对阵
              </button>
              <button type="button" onClick={handleResetClick} disabled={busyAction || !!reveal} className="btn-ghost px-4 py-2.5 text-sm">
                🔄 重置
              </button>
              <button onClick={handleRemove} disabled={!featured || busyAction || !!reveal}
                className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-bold border transition-all whitespace-nowrap"
                style={{
                  background: featured ? "rgba(255,77,109,.08)" : "rgba(0,0,0,.2)",
                  borderColor: featured ? "#FF4D6D66" : "rgba(255,255,255,.06)",
                  color: featured ? "#FF4D6D" : "rgba(255,255,255,.15)",
                  cursor: featured ? "pointer" : "not-allowed",
                }}>
                ✕ 解除本场对阵
              </button>
              <button type="button" onClick={handleEndClick} disabled={busyAction || !!reveal} className="btn-danger px-4 py-2.5 text-sm">
                🏁 结束锦标赛
              </button>
              <span className="text-xs text-ink-muted ml-auto">
                {selected.length > 0 ? `已选择 ${selected.length} 支战队` : remaining.length > 0 ? `未选择 · 将随机排位剩余 ${remaining.length} 支战队` : ""}
              </span>
            </div>
          )}
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
  const draftBroadcastTimerRef = useRef(null)
  const pendingBroadcastRef = useRef(null)
  useEffect(() => {
    if (!isStaff || stage !== 'draft') return
    if (!tournament.teams || tournament.teams.length === 0) return

    // Debounced on purpose: this payload includes the full draftHistory
    // array (every entry itself a deep-cloned snapshot of teams/pool) plus
    // the current teams/pool/captainCandidates again, so JSON.stringify-ing
    // it gets more expensive the deeper into the draft this runs -- doing
    // that synchronously on every single change meant a rapid click burst
    // (e.g. spam-clicking Undo late in a draft, when draftHistory is
    // longest) recomputed it once per click. Deferring it means a burst
    // only pays that cost once, after the last change settles -- since this
    // was already fire-and-forget/eventually-consistent (see comment
    // above), the eventual broadcast content and this admin's own drafting
    // experience are both unchanged; only the redundant mid-burst
    // recomputation is removed. `pendingBroadcastRef` + the unmount effect
    // right below exist so that navigating away mid-debounce still flushes
    // the latest state instead of silently dropping it -- the old
    // synchronous version never had a "pending" state that could be lost.
    const run = () => {
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
    }

    if (draftBroadcastTimerRef.current) clearTimeout(draftBroadcastTimerRef.current)
    pendingBroadcastRef.current = run
    draftBroadcastTimerRef.current = setTimeout(() => {
      draftBroadcastTimerRef.current = null
      pendingBroadcastRef.current = null
      run()
    }, 200)
  }, [isStaff, stage, tournamentName, settingsMeta, tournament, selectedCaptainId, draftHistory])

  // Flush any still-pending debounced broadcast on unmount (leaving this
  // page) so the very last change before navigating away is never silently
  // dropped -- a `[]`-deps effect so this runs exactly once, on true
  // unmount, not on every dependency change above.
  useEffect(() => {
    return () => {
      if (draftBroadcastTimerRef.current) clearTimeout(draftBroadcastTimerRef.current)
      pendingBroadcastRef.current?.()
    }
  }, [])

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
      .catch(() => {})

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
              .catch(() => {})
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
      const teamsPayload = tournament.teams.map((team, idx) => toFinalMatchupTeam(team, idx))
      await enterFinalMatchups(teamsPayload)
    } catch (err) {
      setProceedError(err.message || '生成最终对阵失败')
    }
  }

  return (
    <AppShell
      account={account}
      backAction={onExitToLobby}
      backLabel="返回锦标赛大厅"
      title={tournamentName}
      bgVariant="default"
    >
      <GlobalStyle />
      {stage === 'final' && finalMatches ? (
        <FinalMatchupsStage
          tournamentName={tournamentName}
          teams={finalMatches.teams}
          matchups={finalMatches.matchups}
          isStaff={isStaff}
        />
      ) : !ready ? (
        <div className="flex items-center justify-center flex-1 text-white/40">加载中…</div>
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
