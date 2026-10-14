import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { simTest, getWorld, staffProbe, hiringProbe, cohesionProbe, draftProbe, draftFlowProbe, seasonProbe, tradeProbe, balanceProbe, marketProbe, deadMoneyProbe, askGmProbe, rookieProbe, careerSmoke, leaguePbpProbe, adviceProbe, scoutBiasProbe, characterProbe, rhythmProbe, dominanceProbe, aiManagerProbe, planMatrix, personnelMatrix, statShape, gameDayEquivalence, ratingSpread, clockProbe, decisionProbe, waiverProbe, faFlowProbe, faFrenzyProbe, skillProbe, masteryProbe, hofProbe, gmDeskProbe, deadlineProbe, contractLifeProbe, draftTradeProbe, devPlanProbe, seasonRealism, scoutTravelProbe, lockerRoomProbe, penaltyProbe, ownerMeetingProbe, ovrDistribution, ownerProbe, staminaProbe, futureProbe, injuryCallProbe, setProbeIsolation, useGame } from './store/gameStore'
import { leagueWorkerDebug } from './game/engine/leagueSim'
import { simulatePlayByPlay, matchupProbe, setMatchups } from './game/engine/playsim'
import { animProbe } from './game/engine/animProbe'
import { weatherProbe } from './game/engine/weather'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.DEV) {
  const w = window as unknown as Record<string, unknown>

  // Dev probes are ISOLATED from real player storage: while any probe runs, the
  // store's autosave is suspended, so a probe can spin up seeded universes,
  // advance seasons or start careers without reading or overwriting a real
  // career slot. (Node-side calibration has no IndexedDB at all, so it is
  // inherently isolated; the standalone save/load shims use a scratch key.)
  let probeDepth = 0
  const isolated = <T extends (...a: never[]) => unknown>(fn: T): T =>
    ((...args: never[]) => {
      probeDepth++
      setProbeIsolation(true)
      const done = () => {
        probeDepth--
        if (probeDepth <= 0) setProbeIsolation(false)
      }
      try {
        const out = fn(...args)
        if (out && typeof (out as Promise<unknown>).then === 'function') {
          return (out as Promise<unknown>).finally(done)
        }
        done()
        return out
      } catch (e) {
        done()
        throw e
      }
    }) as T

  const probes: Record<string, (...a: never[]) => unknown> = {
    __simTest: simTest,
    __staffProbe: staffProbe,
    __hiringProbe: hiringProbe,
    __cohesionProbe: cohesionProbe,
    __masteryProbe: masteryProbe,
    __draftProbe: draftProbe,
    __draftFlowProbe: draftFlowProbe,
    __seasonProbe: seasonProbe,
    __tradeProbe: tradeProbe,
    __balanceProbe: balanceProbe,
    __ownerProbe: ownerProbe,
    __ownerMeetingProbe: ownerMeetingProbe,
    __marketProbe: marketProbe,
    __deadMoneyProbe: deadMoneyProbe,
    __askGmProbe: askGmProbe,
    __gmDeskProbe: gmDeskProbe,
    __contractLifeProbe: contractLifeProbe,
    __rookieProbe: rookieProbe,
    __ovrDistribution: ovrDistribution,
    __careerSmoke: careerSmoke,
    __leaguePbpProbe: leaguePbpProbe,
    __adviceProbe: adviceProbe,
    __scoutBiasProbe: scoutBiasProbe,
    __scoutTravelProbe: scoutTravelProbe,
    __lockerRoomProbe: lockerRoomProbe,
    __characterProbe: characterProbe,
    __rhythmProbe: rhythmProbe,
    __dominanceProbe: dominanceProbe,
    __planMatrix: planMatrix,
    __personnelMatrix: personnelMatrix,
    __statShape: statShape,
    __seasonRealism: seasonRealism,
    __ratingSpread: ratingSpread,
    __gameDayEquivalence: gameDayEquivalence,
    __clockProbe: clockProbe,
    __decisionProbe: decisionProbe,
    __aiManagerProbe: aiManagerProbe,
    __deadlineProbe: deadlineProbe,
    __draftTradeProbe: draftTradeProbe,
    __devPlanProbe: devPlanProbe,
    __waiverProbe: waiverProbe,
    __faFlowProbe: faFlowProbe,
    __faFrenzyProbe: faFrenzyProbe,
    __skillProbe: skillProbe,
    __hofProbe: hofProbe,
    __penaltyProbe: penaltyProbe,
    __staminaProbe: staminaProbe,
    __futureProbe: futureProbe,
    __injuryCallProbe: injuryCallProbe,
  }
  for (const [name, fn] of Object.entries(probes)) w[name] = isolated(fn)
  w.__leagueWorkerDebug = leagueWorkerDebug
  w.__game = useGame
  w.__world = getWorld
  w.__simOne = (homeId = 'BUF', awayId = 'MIA') => simulatePlayByPlay(getWorld(), homeId, awayId, 12345)
  w.__animProbe = (games = 2) => animProbe(getWorld(), games)
  w.__weatherProbe = (opts?: { seasons?: number; weeks?: number }) => weatherProbe(getWorld(), opts)
  w.__matchupProbe = (opts?: { games?: number; seeds?: number[] }) => matchupProbe(getWorld(), opts)
  w.__setMatchups = (on: boolean) => setMatchups(on)
}
