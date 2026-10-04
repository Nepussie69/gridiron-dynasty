import type { Team } from '../types'

// Real NFL franchises with real brand colors. Used for team theming and the league
// browser. Rosters are generated in mockData.ts and replaced by the real pipeline in Phase 2.

type Raw = [abbr: string, city: string, name: string, conf: string, div: string, primary: string, secondary: string, stadium: string, prestige: number]

const RAW: Raw[] = [
  // AFC East
  ['BUF', 'Buffalo', 'Bills', 'AFC', 'East', '#00338D', '#C60C30', 'Highmark Stadium', 78],
  ['MIA', 'Miami', 'Dolphins', 'AFC', 'East', '#008E97', '#FC4C02', 'Hard Rock Stadium', 70],
  ['NE', 'New England', 'Patriots', 'AFC', 'East', '#002244', '#C60C30', 'Gillette Stadium', 74],
  ['NYJ', 'New York', 'Jets', 'AFC', 'East', '#125740', '#0a1626', 'MetLife Stadium', 60],
  // AFC North
  ['BAL', 'Baltimore', 'Ravens', 'AFC', 'North', '#241773', '#9E7C0C', 'M&T Bank Stadium', 84],
  ['CIN', 'Cincinnati', 'Bengals', 'AFC', 'North', '#FB4F14', '#0a1626', 'Paycor Stadium', 72],
  ['CLE', 'Cleveland', 'Browns', 'AFC', 'North', '#311D00', '#FF3C00', 'Huntington Bank Field', 58],
  ['PIT', 'Pittsburgh', 'Steelers', 'AFC', 'North', '#FFB612', '#101820', 'Acrisure Stadium', 86],
  // AFC South
  ['HOU', 'Houston', 'Texans', 'AFC', 'South', '#03202F', '#A71930', 'NRG Stadium', 74],
  ['IND', 'Indianapolis', 'Colts', 'AFC', 'South', '#002C5F', '#A2AAAD', 'Lucas Oil Stadium', 66],
  ['JAX', 'Jacksonville', 'Jaguars', 'AFC', 'South', '#006778', '#D7A22A', 'EverBank Stadium', 62],
  ['TEN', 'Tennessee', 'Titans', 'AFC', 'South', '#0C2340', '#4B92DB', 'Nissan Stadium', 64],
  // AFC West
  ['DEN', 'Denver', 'Broncos', 'AFC', 'West', '#FB4F14', '#002244', 'Empower Field', 70],
  ['KC', 'Kansas City', 'Chiefs', 'AFC', 'West', '#E31837', '#FFB81C', 'Arrowhead Stadium', 94],
  ['LV', 'Las Vegas', 'Raiders', 'AFC', 'West', '#0a1626', '#A5ACAF', 'Allegiant Stadium', 68],
  ['LAC', 'Los Angeles', 'Chargers', 'AFC', 'West', '#0080C6', '#FFC20E', 'SoFi Stadium', 72],
  // NFC East
  ['DAL', 'Dallas', 'Cowboys', 'NFC', 'East', '#003594', '#869397', 'AT&T Stadium', 92],
  ['NYG', 'New York', 'Giants', 'NFC', 'East', '#0B2265', '#A71930', 'MetLife Stadium', 68],
  ['PHI', 'Philadelphia', 'Eagles', 'NFC', 'East', '#004C54', '#A5ACAF', 'Lincoln Financial Field', 84],
  ['WAS', 'Washington', 'Commanders', 'NFC', 'East', '#5A1414', '#FFB612', 'Northwest Stadium', 66],
  // NFC North
  ['CHI', 'Chicago', 'Bears', 'NFC', 'North', '#0B162A', '#C83803', 'Soldier Field', 72],
  ['DET', 'Detroit', 'Lions', 'NFC', 'North', '#0076B6', '#B0B7BC', 'Ford Field', 78],
  ['GB', 'Green Bay', 'Packers', 'NFC', 'North', '#203731', '#FFB612', 'Lambeau Field', 88],
  ['MIN', 'Minnesota', 'Vikings', 'NFC', 'North', '#4F2683', '#FFC62F', 'U.S. Bank Stadium', 72],
  // NFC South
  ['ATL', 'Atlanta', 'Falcons', 'NFC', 'South', '#A71930', '#0a1626', 'Mercedes-Benz Stadium', 64],
  ['CAR', 'Carolina', 'Panthers', 'NFC', 'South', '#0085CA', '#101820', 'Bank of America Stadium', 56],
  ['NO', 'New Orleans', 'Saints', 'NFC', 'South', '#101820', '#D3BC8D', 'Caesars Superdome', 68],
  ['TB', 'Tampa Bay', 'Buccaneers', 'NFC', 'South', '#D50A0A', '#34302B', 'Raymond James Stadium', 72],
  // NFC West
  ['ARI', 'Arizona', 'Cardinals', 'NFC', 'West', '#97233F', '#0a1626', 'State Farm Stadium', 60],
  ['LA', 'Los Angeles', 'Rams', 'NFC', 'West', '#003594', '#FFA300', 'SoFi Stadium', 80],
  ['SF', 'San Francisco', '49ers', 'NFC', 'West', '#AA0000', '#B3995D', "Levi's Stadium", 88],
  ['SEA', 'Seattle', 'Seahawks', 'NFC', 'West', '#002244', '#69BE28', 'Lumen Field', 74],
]

export const NFL_TEAMS: Team[] = RAW.map(
  ([abbr, city, name, conference, division, primary, secondary, stadium, prestige]) => ({
    id: abbr,
    abbr,
    city,
    name,
    tier: 'NFL' as const,
    conference,
    division,
    primary,
    secondary,
    stadium,
    prestige,
  }),
)

export const NFL_DIVISIONS: Record<string, string[]> = NFL_TEAMS.reduce(
  (acc, t) => {
    const key = `${t.conference} ${t.division}`
    ;(acc[key] ??= []).push(t.id)
    return acc
  },
  {} as Record<string, string[]>,
)
