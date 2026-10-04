#!/usr/bin/env python3
"""
Mine real NFL play-by-play into calibration tables for the sim.

Input : nflverse play_by_play_2024.csv / play_by_play_2025.csv (~100 MB each)
Output: public/data/calibration.json

The sim then samples these empirical distributions instead of using invented
formulas, so yardage, explosive rate, turnover rate, and situational tendencies
match real football.
"""
import csv, json, os, sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "data", "calibration.json")
CACHE = os.path.join(ROOT, ".cache")
os.makedirs(CACHE, exist_ok=True)
SEASONS = ("2024", "2025")
PBP_URL = "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{y}.csv"


def pbp_path(y):
    return os.path.join(CACHE, f"pbp_{y}.csv")


def ensure_pbp():
    """Download nflverse play-by-play (cached in .cache/, ~100 MB each)."""
    import urllib.request
    for y in SEASONS:
        p = pbp_path(y)
        if os.path.exists(p):
            continue
        print(f"downloading {y} play-by-play (~100 MB)…")
        req = urllib.request.Request(PBP_URL.format(y=y), headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=300) as r, open(p, "wb") as fh:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                fh.write(chunk)


FILES = [pbp_path(y) for y in SEASONS]


def f(v):
    try:
        return float(v)
    except Exception:
        return None


def bucket_run(y):
    if y <= -6: return "-6-"
    if y < 0: return "-1to-5"
    if y == 0: return "0"
    if y <= 3: return "1-3"
    if y <= 6: return "4-6"
    if y <= 9: return "7-9"
    if y <= 14: return "10-14"
    if y <= 24: return "15-24"
    if y <= 49: return "25-49"
    return "50+"


def bucket_pass(y):
    if y <= -6: return "-6-"
    if y < 0: return "-1to-5"
    if y == 0: return "0"
    if y <= 4: return "1-4"
    if y <= 9: return "5-9"
    if y <= 14: return "10-14"
    if y <= 24: return "15-24"
    if y <= 49: return "25-49"
    return "50+"


def bucket_air(a):
    if a is None: return "unknown"
    if a < 0: return "behind"
    if a == 0: return "0-2"
    if a <= 5: return "3-5"
    if a <= 10: return "6-10"
    if a <= 15: return "11-15"
    if a <= 20: return "16-20"
    if a <= 30: return "21-30"
    return "31+"


def main():
    ensure_pbp()
    # distributions
    run_dist = defaultdict(int)
    pass_dist = defaultdict(int)
    pass_dist_air = defaultdict(lambda: defaultdict(int))
    run_bucket_tot = 0
    pass_bucket_tot = 0

    # situation tallies
    s = {
        "plays": 0, "rush": 0, "pass": 0, "sack": 0, "int": 0, "td": 0,
        "incomplete": 0, "complete": 0, "penalty": 0, "first_down": 0,
        "pen_def": 0, "pen_off": 0, "pen_def_yds": 0, "pen_off_yds": 0,
    }
    # by down (1-4): [rush, pass]
    by_down = {d: [0, 0] for d in (1, 2, 3, 4)}
    # 3rd down conversion
    third_att = 0
    third_conv = 0
    # red zone (yardline_100 <= 20)
    rz = {"rush": 0, "pass": 0, "td": 0, "plays": 0, "fg": 0}
    # goal line (yardline_100 <= 5)
    gl = {"rush": 0, "pass": 0, "td": 0, "plays": 0}
    # pass depth success
    air_comp = defaultdict(int)
    air_att = defaultdict(int)

    for path in FILES:
        if not os.path.exists(path):
            print("missing", path); continue
        print("reading", os.path.basename(path))
        with open(path, newline="", encoding="utf-8", errors="replace") as fh:
            r = csv.DictReader(fh)
            for row in r:
                pt = row.get("play_type")
                if pt not in ("run", "pass"):
                    # penalties are a separate play_type
                    if pt == "no_play" or row.get("penalty") == "1":
                        s["penalty"] += 1
                        yl = f(row.get("penalty_yards")) or 0
                        if (row.get("penalty_team") or "") == (row.get("posteam") or ""):
                            s["pen_off"] += 1; s["pen_off_yds"] += abs(yl)
                        else:
                            s["pen_def"] += 1; s["pen_def_yds"] += abs(yl)
                    continue

                y = f(row.get("yards_gained"))
                if y is None:
                    y = 0
                down = int(f(row.get("down")) or 0)
                yl100 = f(row.get("yardline_100"))
                td = row.get("touchdown") == "1"
                air = f(row.get("air_yards"))
                s["plays"] += 1
                if row.get("first_down") == "1" or row.get("first_down_rush") == "1" or row.get("first_down_pass") == "1":
                    s["first_down"] += 1

                if pt == "run" and row.get("rush_attempt") == "1":
                    s["rush"] += 1
                    run_dist[bucket_run(y)] += 1
                    run_bucket_tot += 1
                    if down in by_down: by_down[down][0] += 1
                    if td: s["td"] += 1
                    if yl100 is not None and yl100 <= 20: rz["rush"] += 1; rz["plays"] += 1
                    if yl100 is not None and yl100 <= 5: gl["rush"] += 1; gl["plays"] += 1
                    if yl100 is not None and yl100 <= 20 and td: rz["td"] += 1
                    if yl100 is not None and yl100 <= 5 and td: gl["td"] += 1
                elif pt == "pass":
                    if row.get("sack") == "1":
                        s["sack"] += 1
                        s["pass"] += 1
                        pass_dist[bucket_pass(y)] += 1
                        pass_bucket_tot += 1
                        if down in by_down: by_down[down][1] += 1
                        continue
                    if row.get("pass_attempt") == "1":
                        s["pass"] += 1
                        if down in by_down: by_down[down][1] += 1
                        b = bucket_air(air)
                        air_att[b] += 1
                        if row.get("complete_pass") == "1":
                            s["complete"] += 1
                            pass_dist[bucket_pass(y)] += 1
                            pass_bucket_tot += 1
                            air_comp[b] += 1
                            if yl100 is not None and yl100 <= 20: rz["pass"] += 1  # rz counted below
                        else:
                            s["incomplete"] += 1
                        if row.get("interception") == "1":
                            s["int"] += 1
                        if td: s["td"] += 1
                        if yl100 is not None and yl100 <= 20:
                            if row.get("complete_pass") != "1":
                                rz["pass"] += 1
                            rz["plays"] += 1
                            if td: rz["td"] += 1
                        if yl100 is not None and yl100 <= 5:
                            if row.get("complete_pass") != "1":
                                gl["pass"] += 1
                            gl["plays"] += 1
                            if td: gl["td"] += 1

                if down == 3 and pt in ("run", "pass"):
                    third_att += 1
                    if row.get("first_down") == "1" or row.get("first_down_rush") == "1" or row.get("first_down_pass") == "1":
                        third_conv += 1

    def dist(d, total):
        return {k: round(v / total, 4) for k, v in sorted(d.items())}

    def cdf(dist_dict):
        # cumulative distribution over ordered buckets
        order = ["-6-", "-1to-5", "0", "1-3", "1-4", "4-6", "5-9", "7-9", "10-14", "15-24", "25-49", "50+"]
        out = {}
        c = 0.0
        for k in order:
            if k in dist_dict:
                c += dist_dict[k]
                out[k] = round(c, 4)
        return out

    run_d = dist(run_dist, run_bucket_tot)
    pass_d = dist(pass_dist, pass_bucket_tot)
    comp_rate = s["complete"] / max(1, s["complete"] + s["incomplete"])
    sacks_per_dropback = s["sack"] / max(1, s["sack"] + s["complete"] + s["incomplete"])
    int_per_att = s["int"] / max(1, s["complete"] + s["incomplete"] + s["int"])

    air_c = {k: round(air_comp[k] / max(1, air_att[k]), 3) for k in air_att}

    out = {
        "source": "nflverse play-by-play 2024-2025",
        "totals": {**s, "comp_rate": round(comp_rate, 4),
                   "sack_per_dropback": round(sacks_per_dropback, 4),
                   "int_per_att": round(int_per_att, 4),
                   "third_down_pct": round(third_conv / max(1, third_att), 4)},
        "runDist": run_d,
        "runCdf": cdf(run_d),
        "passDist": pass_d,
        "passCdf": cdf(pass_d),
        "runBucketTotals": run_bucket_tot,
        "passBucketTotals": pass_bucket_tot,
        "byDown": by_down,
        "redZone": rz,
        "goalLine": gl,
        "compByAirDepth": air_c,
    }
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=1)
    print("wrote", OUT)
    print(json.dumps({k: out[k] for k in ("totals", "runDist", "passDist", "compByAirDepth")}, indent=1)[:1500])


if __name__ == "__main__":
    main()
