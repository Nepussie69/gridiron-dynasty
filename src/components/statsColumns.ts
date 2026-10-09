// Shared stat-column definitions for the roster Stats tab and the Stats Hub.
//
// These live in their own module (rather than `StatsTable.tsx`) because React
// Fast Refresh requires a component file to export only components; exporting
// object constants from `StatsTable.tsx` trips `react/only-export-components`.

import type { Player, SeasonStats } from '../game/types'
import { coverageGrade, mainStatValue, passerRating } from '../game/engine/stats'

/**
 * One stat column: `get` is the sort value (null = missing / zero-attempt → last).
 * `p` is optional so the Stats Hub can reuse a column for a retired player who
 * is only kept in the career database.
 */
export interface StatCol {
  id: string
  label: string
  title?: string
  get: (s: SeasonStats | undefined, p?: Player) => number | null
  fmt: (s: SeasonStats | undefined, p?: Player) => string
}

export const num = (v: number | null | undefined) => (v == null ? '—' : String(v))

export const COL_GP: StatCol = {
  id: 'gp',
  label: 'GP',
  get: (s) => s?.games ?? null,
  fmt: (s) => num(s?.games),
}

export const COL_PASS_ATT: StatCol = {
  id: 'passAtt',
  label: 'C/ATT',
  get: (s) => s?.passAtt ?? null,
  fmt: (s) => (s ? `${s.passComp}/${s.passAtt}` : '—'),
}

export const COL_PASS_PCT: StatCol = {
  id: 'passPct',
  label: 'CMP%',
  title: 'Completion percentage',
  get: (s) => (s && s.passAtt > 0 ? (s.passComp / s.passAtt) * 100 : null),
  fmt: (s) => (s && s.passAtt > 0 ? ((s.passComp / s.passAtt) * 100).toFixed(1) : '—'),
}

export const COL_PASS_YDS: StatCol = {
  id: 'passYds',
  label: 'YDS',
  get: (s) => s?.passYds ?? null,
  fmt: (s) => num(s?.passYds),
}

export const COL_PASS_TD: StatCol = {
  id: 'passTD',
  label: 'TD',
  get: (s) => s?.passTD ?? null,
  fmt: (s) => num(s?.passTD),
}

export const COL_PASS_INT: StatCol = {
  id: 'passInt',
  label: 'INT',
  get: (s) => s?.ints ?? null,
  fmt: (s) => num(s?.ints),
}

export const COL_RTG: StatCol = {
  id: 'rtg',
  label: 'RTG',
  title: 'Passer rating',
  get: (s) => (s && s.passAtt > 0 ? passerRating(s) : null),
  fmt: (s) => (s && s.passAtt > 0 ? passerRating(s).toFixed(1) : '—'),
}

export const COL_PASS_SK: StatCol = {
  id: 'passSk',
  label: 'SK',
  title: 'Times sacked (sacks are not pass attempts)',
  get: (s) => s?.sk ?? null,
  fmt: (s) => num(s?.sk),
}

export const COL_PASS_SKY: StatCol = {
  id: 'passSky',
  label: 'SKY',
  title: 'Sack yards lost (not subtracted from passing yards)',
  get: (s) => s?.sky ?? null,
  fmt: (s) => num(s?.sky),
}

export const COL_PASS_PRESSURED: StatCol = {
  id: 'pressured',
  label: 'PRS%',
  title: 'Pressured % (pressures faced ÷ dropbacks = pass attempts + times sacked)',
  get: (s) => {
    if (!s) return null
    const db = (s.passAtt ?? 0) + (s.sk ?? 0)
    return db > 0 ? ((s.pressured ?? 0) / db) * 100 : null
  },
  fmt: (s) => {
    if (!s) return '—'
    const db = (s.passAtt ?? 0) + (s.sk ?? 0)
    return db > 0 ? `${(((s.pressured ?? 0) / db) * 100).toFixed(1)}%` : '—'
  },
}

export const COL_RUSH_ATT: StatCol = {
  id: 'rushAtt',
  label: 'CAR',
  get: (s) => s?.rushAtt ?? null,
  fmt: (s) => num(s?.rushAtt),
}

export const COL_RUSH_YDS: StatCol = {
  id: 'rushYds',
  label: 'YDS',
  get: (s) => s?.rushYds ?? null,
  fmt: (s) => num(s?.rushYds),
}

export const COL_RUSH_AVG: StatCol = {
  id: 'rushAvg',
  label: 'YPC',
  title: 'Yards per carry',
  get: (s) => (s && s.rushAtt > 0 ? s.rushYds / s.rushAtt : null),
  fmt: (s) => (s && s.rushAtt > 0 ? (s.rushYds / s.rushAtt).toFixed(1) : '—'),
}

export const COL_RUSH_TD: StatCol = {
  id: 'rushTD',
  label: 'TD',
  get: (s) => s?.rushTD ?? null,
  fmt: (s) => num(s?.rushTD),
}

export const COL_TGT: StatCol = {
  id: 'tgt',
  label: 'TGT',
  get: (s) => s?.targets ?? null,
  fmt: (s) => num(s?.targets),
}

export const COL_REC: StatCol = {
  id: 'rec',
  label: 'REC',
  get: (s) => s?.rec ?? null,
  fmt: (s) => num(s?.rec),
}

export const COL_REC_YDS: StatCol = {
  id: 'recYds',
  label: 'YDS',
  get: (s) => s?.recYds ?? null,
  fmt: (s) => num(s?.recYds),
}

export const COL_REC_AVG: StatCol = {
  id: 'recAvg',
  label: 'Y/R',
  title: 'Yards per reception',
  get: (s) => (s && s.rec > 0 ? s.recYds / s.rec : null),
  fmt: (s) => (s && s.rec > 0 ? (s.recYds / s.rec).toFixed(1) : '—'),
}

export const COL_REC_TD: StatCol = {
  id: 'recTD',
  label: 'TD',
  get: (s) => s?.recTD ?? null,
  fmt: (s) => num(s?.recTD),
}

export const COL_TCK: StatCol = {
  id: 'tck',
  label: 'TCK',
  get: (s) => s?.tackles ?? null,
  fmt: (s) => num(s?.tackles),
}

export const COL_MT: StatCol = {
  id: 'mt',
  label: 'MT',
  title: 'Missed tackles',
  get: (s) => s?.missedTackles ?? null,
  fmt: (s) => num(s?.missedTackles),
}

export const COL_FMT: StatCol = {
  id: 'fmt',
  label: 'FMT',
  title: 'Forced missed tackles',
  get: (s) => s?.forcedMissed ?? null,
  fmt: (s) => num(s?.forcedMissed),
}

export const COL_DROP: StatCol = {
  id: 'drop',
  label: 'DRP',
  title: 'Dropped passes',
  get: (s) => s?.drops ?? null,
  fmt: (s) => num(s?.drops),
}

export const COL_KR: StatCol = {
  id: 'kr',
  label: 'KR',
  title: 'Kickoff returns',
  get: (s) => s?.kickRet ?? null,
  fmt: (s) => num(s?.kickRet),
}

export const COL_KR_YDS: StatCol = {
  id: 'krYds',
  label: 'KR YDS',
  title: 'Kickoff return yards',
  get: (s) => s?.kickRetYds ?? null,
  fmt: (s) => num(s?.kickRetYds),
}

export const COL_KR_AVG: StatCol = {
  id: 'krAvg',
  label: 'KR AVG',
  title: 'Yards per kickoff return',
  get: (s) => (s && (s.kickRet ?? 0) > 0 ? (s.kickRetYds ?? 0) / (s.kickRet ?? 1) : null),
  fmt: (s) => (s && (s.kickRet ?? 0) > 0 ? ((s.kickRetYds ?? 0) / (s.kickRet ?? 1)).toFixed(1) : '—'),
}

export const COL_PR: StatCol = {
  id: 'pr',
  label: 'PR',
  title: 'Punt returns',
  get: (s) => s?.puntRet ?? null,
  fmt: (s) => num(s?.puntRet),
}

export const COL_PR_YDS: StatCol = {
  id: 'prYds',
  label: 'PR YDS',
  title: 'Punt return yards',
  get: (s) => s?.puntRetYds ?? null,
  fmt: (s) => num(s?.puntRetYds),
}

export const COL_PR_AVG: StatCol = {
  id: 'prAvg',
  label: 'PR AVG',
  title: 'Yards per punt return',
  get: (s) => (s && (s.puntRet ?? 0) > 0 ? (s.puntRetYds ?? 0) / (s.puntRet ?? 1) : null),
  fmt: (s) => (s && (s.puntRet ?? 0) > 0 ? ((s.puntRetYds ?? 0) / (s.puntRet ?? 1)).toFixed(1) : '—'),
}

export const COL_RET_TD: StatCol = {
  id: 'retTD',
  label: 'RET TD',
  title: 'Kickoff and punt return touchdowns',
  get: (s) => s?.retTD ?? null,
  fmt: (s) => num(s?.retTD),
}

export const COL_DEF_TD: StatCol = {
  id: 'defTD',
  label: 'DEF TD',
  title: 'Defensive touchdowns (pick-six, fumble return)',
  get: (s) => s?.defTD ?? null,
  fmt: (s) => num(s?.defTD),
}

export const COL_TFL: StatCol = {
  id: 'tfl',
  label: 'TFL',
  get: (s) => s?.tfl ?? null,
  fmt: (s) => num(s?.tfl),
}

export const COL_SCK: StatCol = {
  id: 'sck',
  label: 'SCK',
  get: (s) => s?.defSacks ?? null,
  fmt: (s) => num(s?.defSacks),
}

export const COL_PRS: StatCol = {
  id: 'prs',
  label: 'PRS',
  title: 'Pressures (SCK + QBH + HUR)',
  get: (s) => s?.prs ?? null,
  fmt: (s) => num(s?.prs),
}

export const COL_QBH: StatCol = {
  id: 'qbh',
  label: 'QBH',
  title: 'QB hits (knocked down as or after he throws)',
  get: (s) => s?.qbHits ?? null,
  fmt: (s) => num(s?.qbHits),
}

export const COL_HUR: StatCol = {
  id: 'hur',
  label: 'HUR',
  title: 'Hurries (forced to throw or move early)',
  get: (s) => s?.hurries ?? null,
  fmt: (s) => num(s?.hurries),
}

export const COL_DEF_INT: StatCol = {
  id: 'defInt',
  label: 'INT',
  get: (s) => s?.defInts ?? null,
  fmt: (s) => num(s?.defInts),
}

export const COL_PD: StatCol = {
  id: 'pd',
  label: 'PD',
  title: 'Passes defended',
  get: (s) => s?.passDef ?? null,
  fmt: (s) => num(s?.passDef),
}

export const COL_COV_TGT: StatCol = {
  id: 'covTgt',
  label: 'TGT',
  title: 'Targets allowed',
  get: (s) => s?.defTargets ?? null,
  fmt: (s) => num(s?.defTargets),
}

export const COL_COV_CMP: StatCol = {
  id: 'covCmp',
  label: 'REC',
  title: 'Receptions allowed (completions when he was the defender in coverage)',
  get: (s) => s?.defComp ?? null,
  fmt: (s) => num(s?.defComp),
}

export const COL_COV_YDS: StatCol = {
  id: 'covYds',
  label: 'YDS ALW',
  title: 'Yards allowed',
  get: (s) => s?.defYdsAllowed ?? null,
  fmt: (s) => num(s?.defYdsAllowed),
}

export const COL_COV_TD: StatCol = {
  id: 'covTD',
  label: 'TD',
  title: 'Touchdowns allowed',
  get: (s) => s?.defTDAllowed ?? null,
  fmt: (s) => num(s?.defTDAllowed),
}

export const COL_COV: StatCol = {
  id: 'cov',
  label: 'COV',
  title: 'Coverage grade 0–100 (passer rating allowed, INT bonus)',
  get: (s) => (s ? coverageGrade(s) : null),
  fmt: (s) => {
    const g = s ? coverageGrade(s) : null
    return g == null ? '—' : String(g)
  },
}

export const COL_MAIN: StatCol = {
  id: 'main',
  label: 'Main',
  title: 'The main stat for each player’s position',
  get: (s, p) => (p ? mainStatValue(p, s) : null),
  fmt: (s, p) => (p ? num(mainStatValue(p, s)) : '—'),
}
