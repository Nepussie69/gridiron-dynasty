import { useEffect } from 'react'
import './App.css'
import { AppShell } from './components/AppShell'
import { PlayerProfile } from './components/PlayerProfile'
import { SeasonModal } from './components/SeasonModal'
import { MatchView } from './components/MatchView'
import { useGame } from './store/gameStore'
import { CareerHub } from './screens/CareerHub'
import { Career } from './screens/Career'
import { History } from './screens/History'
import { Dashboard } from './screens/Dashboard'
import { Ledger } from './screens/Ledger'
import { Roster } from './screens/Roster'
import { DepthChart } from './screens/DepthChart'
import { GamePlanScreen } from './screens/GamePlanScreen'
import { Staff } from './screens/Staff'
import { Scouting } from './screens/Scouting'
import { Draft } from './screens/Draft'
import { FreeAgency } from './screens/FreeAgency'
import { Trades } from './screens/Trades'
import { Cap } from './screens/Cap'
import { Schedule } from './screens/Schedule'
import { Standings } from './screens/Standings'
import { FindPlayer } from './screens/FindPlayer'
import { StatsHub } from './screens/StatsHub'
import { Awards } from './screens/Awards'
import { League } from './screens/League'
import { Inbox } from './screens/Inbox'

export default function App() {
  const career = useGame((s) => s.career)
  const screen = useGame((s) => s.screen)
  const ready = useGame((s) => s.ready)
  const hydrate = useGame((s) => s.hydrate)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  if (!ready) {
    return (
      <div className="grid h-screen w-screen place-items-center bg-canvas">
        <div className="text-center">
          <div className="font-display text-4xl font-700 uppercase tracking-wide">
            Gridiron <span className="text-brand">Dynasty</span>
          </div>
          <div className="label mt-2">Loading universe…</div>
        </div>
      </div>
    )
  }

  if (!career) return <CareerHub />

  return (
    <>
      <AppShell>
        {screen === 'career' && <Career />}
        {screen === 'history' && <History />}
        {screen === 'dashboard' && <Dashboard />}
        {screen === 'ledger' && <Ledger />}
        {screen === 'roster' && <Roster />}
        {screen === 'depth' && <DepthChart />}
        {screen === 'gameplan' && <GamePlanScreen />}
        {screen === 'staff' && <Staff />}
        {screen === 'scouting' && <Scouting />}
        {screen === 'draft' && <Draft />}
        {screen === 'freeagency' && <FreeAgency />}
        {screen === 'trades' && <Trades />}
        {screen === 'cap' && <Cap />}
        {screen === 'schedule' && <Schedule />}
        {screen === 'standings' && <Standings />}
        {screen === 'players' && <FindPlayer />}
        {screen === 'stats' && <StatsHub />}
        {screen === 'awards' && <Awards />}
        {screen === 'league' && <League />}
        {screen === 'inbox' && <Inbox />}
      </AppShell>
      <PlayerProfile />
      <SeasonModal />
      <MatchView />
    </>
  )
}
