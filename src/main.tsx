import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { simTest, getWorld, staffProbe, hiringProbe, cohesionProbe, draftProbe, draftFlowProbe, seasonProbe, tradeProbe, balanceProbe, marketProbe, deadMoneyProbe, askGmProbe, rookieProbe, careerSmoke, leaguePbpProbe, adviceProbe, scoutBiasProbe, characterProbe, rhythmProbe, dominanceProbe, aiManagerProbe, planMatrix, statShape, seasonRealism, gameDayEquivalence, ratingSpread, clockProbe, decisionProbe, waiverProbe, faFlowProbe, skillProbe, masteryProbe, hofProbe, gmDeskProbe, ovrDistribution, penaltyProbe, staminaProbe, useGame } from './store/gameStore'
import { leagueWorkerDebug } from './game/engine/leagueSim'
import { simulatePlayByPlay } from './game/engine/playsim'
import { animProbe } from './game/engine/animProbe'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__simTest = simTest
  ;(window as unknown as Record<string, unknown>).__staffProbe = staffProbe
  ;(window as unknown as Record<string, unknown>).__hiringProbe = hiringProbe
  ;(window as unknown as Record<string, unknown>).__cohesionProbe = cohesionProbe
  ;(window as unknown as Record<string, unknown>).__masteryProbe = masteryProbe
  ;(window as unknown as Record<string, unknown>).__draftProbe = draftProbe
  ;(window as unknown as Record<string, unknown>).__draftFlowProbe = draftFlowProbe
  ;(window as unknown as Record<string, unknown>).__seasonProbe = seasonProbe
  ;(window as unknown as Record<string, unknown>).__tradeProbe = tradeProbe
  ;(window as unknown as Record<string, unknown>).__balanceProbe = balanceProbe
  ;(window as unknown as Record<string, unknown>).__marketProbe = marketProbe
  ;(window as unknown as Record<string, unknown>).__deadMoneyProbe = deadMoneyProbe
  ;(window as unknown as Record<string, unknown>).__askGmProbe = askGmProbe
  ;(window as unknown as Record<string, unknown>).__gmDeskProbe = gmDeskProbe
  ;(window as unknown as Record<string, unknown>).__rookieProbe = rookieProbe
  ;(window as unknown as Record<string, unknown>).__ovrDistribution = ovrDistribution
  ;(window as unknown as Record<string, unknown>).__careerSmoke = careerSmoke
  ;(window as unknown as Record<string, unknown>).__leaguePbpProbe = leaguePbpProbe
  ;(window as unknown as Record<string, unknown>).__adviceProbe = adviceProbe
  ;(window as unknown as Record<string, unknown>).__scoutBiasProbe = scoutBiasProbe
  ;(window as unknown as Record<string, unknown>).__characterProbe = characterProbe
  ;(window as unknown as Record<string, unknown>).__rhythmProbe = rhythmProbe
  ;(window as unknown as Record<string, unknown>).__dominanceProbe = dominanceProbe
  ;(window as unknown as Record<string, unknown>).__planMatrix = planMatrix
  ;(window as unknown as Record<string, unknown>).__statShape = statShape
  ;(window as unknown as Record<string, unknown>).__seasonRealism = seasonRealism
  ;(window as unknown as Record<string, unknown>).__ratingSpread = ratingSpread
  ;(window as unknown as Record<string, unknown>).__gameDayEquivalence = gameDayEquivalence
  ;(window as unknown as Record<string, unknown>).__clockProbe = clockProbe
  ;(window as unknown as Record<string, unknown>).__decisionProbe = decisionProbe
  ;(window as unknown as Record<string, unknown>).__aiManagerProbe = aiManagerProbe
  ;(window as unknown as Record<string, unknown>).__waiverProbe = waiverProbe
  ;(window as unknown as Record<string, unknown>).__faFlowProbe = faFlowProbe
  ;(window as unknown as Record<string, unknown>).__skillProbe = skillProbe
  ;(window as unknown as Record<string, unknown>).__hofProbe = hofProbe
  ;(window as unknown as Record<string, unknown>).__penaltyProbe = penaltyProbe
  ;(window as unknown as Record<string, unknown>).__staminaProbe = staminaProbe
  ;(window as unknown as Record<string, unknown>).__leagueWorkerDebug = leagueWorkerDebug
  ;(window as unknown as Record<string, unknown>).__game = useGame
  ;(window as unknown as Record<string, unknown>).__world = getWorld
  ;(window as unknown as Record<string, unknown>).__simOne = (homeId = 'BUF', awayId = 'MIA') =>
    simulatePlayByPlay(getWorld(), homeId, awayId, 12345)
  ;(window as unknown as Record<string, unknown>).__animProbe = (games = 2) => animProbe(getWorld(), games)
}
