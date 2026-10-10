import type { World } from '../game/engine/generate'
import type { GameState, Moment } from '../game/engine/playsim'

/** L11.5 Q1: where the ball is, tagged with the possessing club ("BUF 32", "NE 45"). */
function gameDayFieldPos(world: World, state: GameState, yard: number): string {
  const defId = state.offId === state.homeId ? state.awayId : state.homeId
  const offAbbr = world.byId[state.offId]?.abbr ?? ''
  const defAbbr = world.byId[defId]?.abbr ?? ''
  if (yard === 50) return '50'
  return yard < 50 ? `${offAbbr} ${yard}` : `${defAbbr} ${100 - yard}`
}

/**
 * FUTURES #4: the moment card's field-position label. During a kickoff
 * `state.offId` is the RECEIVING club, so `gameDayFieldPos` would name the wrong
 * side; on a kickoff the yard is the KICKING club's own line and the kicking club
 * is `moment.teamId`, so name that club instead (e.g. "CAR 35"). Every other
 * moment kind keeps the existing label, unchanged.
 */
export function momentFieldPos(world: World, state: GameState, moment: Moment): string {
  if (moment.kind === 'kickoff') {
    const abbr = world.byId[moment.teamId]?.abbr ?? moment.teamId
    if (moment.yard === 50) return '50'
    return `${abbr} ${moment.yard}`
  }
  return gameDayFieldPos(world, state, moment.yard)
}
