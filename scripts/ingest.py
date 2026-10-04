#!/usr/bin/env python3
"""
Ingest exact player ratings for Gridiron Dynasty.

Sources:
  • Madden NFL 26  — full ratings CSV (overall + every attribute) from the
                     community Madden Ratings Hub dataset.
  • CFB 26         — EA Sports College Football 26 team rosters scraped from
                     TeamCrafters (overall + core attributes, class, measurables).

Output: public/data/madden26.json and public/data/cfb26.json

Run:  python3 scripts/ingest.py
"""
import csv, html as htmlmod, io, json, os, re, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "data")
os.makedirs(OUT, exist_ok=True)

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}

MADDEN_HUB = "https://madden-ratings-data.vercel.app"
MADDEN_ITER = "/data/madden-26/1-base/Madden_Ratings.csv"  # LAUNCH ratings
TC_INDEX = "https://www.teamcrafters.net/rosters/CFB26/v2-103025"
CFB27_INDEX = "https://www.teamcrafters.net/rosters/CFB27/10-02-26"

# ── Madden position mapping ──────────────────────────────────────────────────
POS_MAP = {
    "QB": "QB", "HB": "RB", "FB": "RB", "WR": "WR", "TE": "TE",
    "LT": "OT", "RT": "OT", "LG": "OG", "RG": "OG", "C": "C",
    "LE": "DE", "RE": "DE", "DT": "DT",
    "LOLB": "LB", "MLB": "LB", "ROLB": "LB", "WILL": "LB", "MIKE": "LB", "SAM": "LB",
    "REDG": "DE", "LEDG": "DE",
    "CB": "CB", "FS": "S", "SS": "S", "K": "K", "P": "P",
}

# Map Madden attribute column -> our short key
ATTR_MAP = {
    "SPEED": "SPD", "STRENGTH": "STR", "AGILITY": "AGI", "ACCELERATION": "ACC",
    "AWARENESS": "AWR", "JUMPING": "JMP", "STAMINA": "STA", "TOUGHNESS": "TGH",
    "CHANGEOFDIRECTION": "COD", "CARRYING": "CAR", "CATCHING": "CTH",
    "THROWPOWER": "THP", "THROWACCURACYSHORT": "SAC", "THROWACCURACYMID": "MAC",
    "THROWACCURACYDEEP": "DAC", "THROWONTHERUN": "TOR", "THROWUNDERPRESSURE": "TUP",
    "PLAYACTION": "PAC", "RUNBLOCK": "RBK", "PASSBLOCK": "PBK",
    "IMPACTBLOCKING": "IMP", "TACKLE": "TAK", "PURSUIT": "PUR",
    "PLAYRECOGNITION": "PRC", "MANCOVERAGE": "MCV", "ZONECOVERAGE": "ZCV",
    "PRESS": "PRS", "POWERMOVES": "PMV", "FINESSEMOVES": "FMV",
    "BLOCKSHEDDING": "BSH", "HITPOWER": "HPW", "KICKPOWER": "KPW",
    "KICKACCURACY": "KAC", "RELEASE": "RLS", "SPECTACULARCATCH": "SPC",
    "BREAKTACKLE": "BTK", "JUKEMOVE": "JKM", "SPINMOVE": "SPM",
    "STIFFARM": "SFA", "TRUCKING": "TRK", "BCVISION": "BCV",
}

def fetch(url, as_text=True):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        data = r.read()
    return data.decode("utf-8", "replace") if as_text else data

# ── Madden ───────────────────────────────────────────────────────────────────
def build_madden():
    print("Fetching Madden 26 ratings CSV…")
    text = fetch(MADDEN_HUB + MADDEN_ITER)
    reader = csv.DictReader(io.StringIO(text))
    players = []
    for row in reader:
        pos = POS_MAP.get((row.get("Position ID") or "").strip())
        if not pos:
            continue
        def num(col):
            v = (row.get(col) or "").strip()
            try:
                return int(float(v))
            except Exception:
                return None
        try:
            height = int(float(row.get("Height") or 0))
        except Exception:
            height = 0
        hrs = height // 12
        ins = height % 12
        attrs = {}
        for col, key in ATTR_MAP.items():
            v = num(col)
            if v is not None:
                attrs[key] = v
        players.append({
            "name": f"{row.get('First Name','').strip()} {row.get('Last Name','').strip()}".strip(),
            "pos": pos,
            "team": (row.get("Team") or "").strip(),
            "age": num("Age") or 24,
            "college": (row.get("College") or "").strip(),
            "height": f"{hrs}'{ins}\"",
            "weight": num("Weight") or 0,
            "ovr": num("Overall") or 60,
            "archetype": (row.get("Archetype") or "").split(" - ")[0].strip(),
            "attrs": attrs,
        })
    print(f"  {len(players)} NFL players")
    with open(os.path.join(OUT, "madden26.json"), "w") as f:
        json.dump({"source": "Madden NFL 26 (launch)", "players": players}, f, separators=(",", ":"))

# ── CFB 26 ───────────────────────────────────────────────────────────────────
def flight_text(html):
    chunks = re.findall(r'self\.__next_f\.push\(\[1,\s*"((?:[^"\\]|\\.)*)"\]\)', html)
    out = []
    for c in chunks:
        try:
            out.append(json.loads('"' + c + '"'))
        except Exception:
            out.append(c)
    return "".join(out)

def extract_players(flight):
    players = []
    for m in re.finditer(r'"players":\s*\[', flight):
        start = flight.find('[', m.start())
        depth = 0
        end = None
        for j in range(start, len(flight)):
            ch = flight[j]
            if ch == '[':
                depth += 1
            elif ch == ']':
                depth -= 1
                if depth == 0:
                    end = j + 1
                    break
        if end is None:
            continue
        try:
            arr = json.loads(flight[start:end])
        except Exception:
            continue
        if isinstance(arr, list):
            players.extend(arr)
    # de-dup by id
    seen, uniq = set(), []
    for p in players:
        if not isinstance(p, dict):
            continue
        pid = p.get("id")
        if pid in seen:
            continue
        seen.add(pid)
        uniq.append(p)
    return uniq

def norm_class(c):
    c = (c or "").lower()
    if "fresh" in c: return "FR"
    if "soph" in c: return "SO"
    if "junior" in c: return "JR"
    if "senior" in c: return "SR"
    return "JR"

def scrape_team(base, tid, sleep=0.0):
    """Scrape one TeamCrafters team page into a team dict."""
    html = fetch(f"{base}/{tid}")
    title = re.search(r"<title>([^<]*)</title>", html)
    school = htmlmod.unescape(title.group(1).split(" CFB 2")[0]).strip() if title else f"Team {tid}"
    flight = flight_text(html)
    players = []
    for p in extract_players(flight):
        pos = p.get("POS")
        if pos not in {"QB","RB","WR","TE","OT","OG","C","DE","DT","LB","CB","S","K","P"}:
            pos = {"HB":"RB","FB":"RB","LT":"OT","RT":"OT","LG":"OG","RG":"OG",
                   "LE":"DE","RE":"DE","LOLB":"LB","MLB":"LB","ROLB":"LB",
                   "FS":"S","SS":"S"}.get(pos)
            if not pos:
                continue
        attrs = {}
        for k in ("SPD","STR","AGI","ACC","COD","AWR","INJ","STA"):
            if isinstance(p.get(k), (int, float)):
                attrs[k] = int(p[k])
        players.append({
            "name": f"{p.get('firstName','')} {p.get('lastName','')}".strip(),
            "pos": pos,
            "cls": norm_class(p.get("class")),
            "ht": p.get("height") or 72,
            "wt": p.get("weight") or 200,
            "ovr": int(p.get("OVR") or 60),
            "dev": (p.get("devTrait") or "").title(),
            "attrs": attrs,
        })
    players.sort(key=lambda x: -x["ovr"])
    if sleep:
        time.sleep(sleep)
    return {"school": school, "teamId": str(tid), "conference": "", "players": players}

def build_cfb():
    print("Fetching CFB 26 team index…")
    idx = fetch(TC_INDEX)
    ids = sorted(set(re.findall(r'/rosters/CFB26/v2-103025/(\d+)', idx)))
    print(f"  {len(ids)} teams")
    teams = []
    for n, tid in enumerate(ids, 1):
        try:
            teams.append(scrape_team(TC_INDEX, tid, sleep=0.2))
        except Exception as e:
            print(f"  ! {tid}: {e}")
            continue
        if n % 20 == 0:
            print(f"  {n}/{len(ids)}…")
    # Supplement: programs that moved FCS→FBS and only appear in CFB 27.
    print("  supplementing 2026 FBS newcomers from CFB 27…")
    supp = {"76": "North Dakota State", "89": "Sacramento State"}
    for tid, name in supp.items():
        try:
            t = scrape_team(CFB27_INDEX, tid, sleep=0.2)
            t["school"] = name
            teams.append(t)
        except Exception as e:
            print(f"  ! supplement {tid}: {e}")
    total = sum(len(t["players"]) for t in teams)
    print(f"  {len(teams)} teams · {total} CFB players")
    with open(os.path.join(OUT, "cfb26.json"), "w") as f:
        json.dump({"source": "EA Sports College Football 26 (+ 27 newcomers)", "teams": teams}, f, separators=(",", ":"))

if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("all", "madden"):
        build_madden()
    if which in ("all", "cfb"):
        build_cfb()
    print("Done.")
