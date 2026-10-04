#!/usr/bin/env python3
"""
Mine real college football play-by-play into a CFB calibration table.

Input : sportsdataverse / cfbfastR CFB parquet (ESPN), cached in .cache/
Output: public/data/calibration_cfb.json

FBS only (the file has no conference column, so FCS opponents are excluded by team
name). Fully vectorized with pyarrow compute — runs in a couple of seconds.
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "data", "calibration_cfb.json")
CACHE = os.path.join(ROOT, ".cache")
os.makedirs(CACHE, exist_ok=True)
SEASONS = ("2023", "2024")
BASE = "https://raw.githubusercontent.com/sportsdataverse/cfbfastR-cfb-data/main/cfb/pbp/parquet/play_by_play_{y}.parquet"

try:
    import pyarrow as pa
    import pyarrow.parquet as pq
    import pyarrow.compute as pc
except ImportError:
    print("pyarrow is required:  python3 -m pip install --user pyarrow")
    sys.exit(1)

FCS = [
    "State", "Southern", "Western", "Eastern", "Northern", "A&M", "A & M", "Corpus",
    "Grambling", "Jackson St", "Prairie View", "Alcorn", "Bethune", "Florida A", "Norfolk",
    "Howard", "Delaware St", "Morgan St", "Tennessee St", "Texas Southern", "Alabama A",
    "Alabama St", "Arkansas-Pine", "Miss Valley", "Savannah", "N.C. A&T", "NC A&T",
    "Wofford", "Furman", "Chattanooga", "Mercer", "Citadel", "VMI", "Samford", "ETSU",
    "Western Carolina", "Gardner-Webb", "Campbell", "Charleston So", "Elon", "William",
    "Richmond", "Villanova", "Maine", "New Hampshire", "Rhode Island", "Stony Brook",
    "Towson", "Albany", "Monmouth", "Hampton", "Bryant", "Duquesne", "Dayton", "Drake",
    "Butler", "Valparaiso", "Stetson", "Davidson", "Morehead", "Presbyterian", "Bucknell",
    "Colgate", "Holy Cross", "Lafayette", "Lehigh", "Fordham", "Georgetown", "Brown",
    "Columbia", "Cornell", "Dartmouth", "Harvard", "Penn", "Princeton", "Yale",
    "Sacramento", "Cal Poly", "UC Davis", "Idaho St", "Weber", "Portland St", "Montana",
    "Northern Ariz", "Northern Colo", "E. Washington", "Eastern Wash", "Southern Utah",
    "Nicholls", "McNeese", "Lamar", "Incarnate", "SE Louisiana", "Southeastern",
    "Northwestern St", "Houston Christian", "Abilene", "Tarleton", "SFA", "Stephen F",
    "Central Arkansas", "Austin Peay", "UT Martin", "Murray St", "Eastern Kentucky",
    "E. Kentucky", "Tennessee Tech", "SEMO", "SE Missouri", "Lindenwood", "Western Ill",
    "Southern Ill", "Illinois St", "Indiana St", "Youngstown", "North Dakota", "South Dakota",
]
FCS = [k.lower() for k in FCS]

BUCKETS = ["-6-", "-1to-5", "0", "1-3", "1-4", "4-6", "5-9", "7-9", "10-14", "15-24", "25-49", "50+"]


def cache_path(name):
    return os.path.join(CACHE, f"cfb_pbp_{name}.parquet")


def ensure(name):
    p = cache_path(name)
    if os.path.exists(p):
        return p
    import urllib.request
    print(f"downloading CFB play-by-play {name} (~50 MB)…")
    req = urllib.request.Request(BASE.format(y=name), headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=300) as r, open(p, "wb") as fh:
        while True:
            c = r.read(1 << 20)
            if not c:
                break
            fh.write(c)
    return p


def bucket_label(ys, kind):
    """Vectorized bucket id (index into BUCKETS)."""
    neg6 = pc.less_equal(ys, -6)
    neg5 = pc.and_(pc.less(ys, 0), pc.greater(ys, -6))
    zero = pc.equal(ys, 0)
    if kind == "run":
        b13 = pc.and_(pc.greater_equal(ys, 1), pc.less_equal(ys, 3))
        b46 = pc.and_(pc.greater_equal(ys, 4), pc.less_equal(ys, 6))
        b79 = pc.and_(pc.greater_equal(ys, 7), pc.less_equal(ys, 9))
        small = None
    else:
        b13 = None; b46 = None; b79 = None
        b14 = pc.and_(pc.greater_equal(ys, 1), pc.less_equal(ys, 4))
        b59 = pc.and_(pc.greater_equal(ys, 5), pc.less_equal(ys, 9))
    b1014 = pc.and_(pc.greater_equal(ys, 10), pc.less_equal(ys, 14))
    b1524 = pc.and_(pc.greater_equal(ys, 15), pc.less_equal(ys, 24))
    b2549 = pc.and_(pc.greater_equal(ys, 25), pc.less_equal(ys, 49))
    b50 = pc.greater_equal(ys, 50)
    out = pa.array([""] * len(ys))
    idx = {"-6-": neg6, "-1to-5": neg5, "0": zero}
    if kind == "run":
        idx.update({"1-3": b13, "4-6": b46, "7-9": b79})
    else:
        idx.update({"1-4": b14, "5-9": b59})
    idx.update({"10-14": b1014, "15-24": b1524, "25-49": b2549, "50+": b50})
    return idx


def main():
    import collections
    run_dist = collections.Counter()
    pass_dist = collections.Counter()
    s = collections.Counter()
    by_down = {d: [0, 0] for d in (1, 2, 3, 4)}
    rz = collections.Counter()
    gl = collections.Counter()
    third_att = third_conv = 0

    for season in SEASONS:
        path = ensure(season)
        print("reading", os.path.basename(path))
        cols = [x.name for x in pq.ParquetFile(path).schema_arrow]
        keep = [c for c in ("rush", "pass", "sack", "pass_attempt", "touchdown", "yds_rushed",
                            "statYardage", "start.down", "start.yardsToEndzone", "pos_team",
                            "text", "isPenalty") if c in cols]
        t = pq.read_table(path, columns=keep)
        nrows = t.num_rows

        # FCS filter: possession-team name contains an FCS fragment.
        pos = t["pos_team"].to_pylist()
        fcs = pa.array([any(k in (p or "").lower() for k in FCS) for p in pos])

        rush = t["rush"]
        pas = t["pass"]
        sack = t["sack"]
        attempt = t["pass_attempt"]
        td = t["touchdown"]
        pen = t["isPenalty"]
        down = t["start.down"]
        yte = t["start.yardsToEndzone"]
        yrush = t["yds_rushed"]
        sy = t["statYardage"]
        txt = t["text"]

        base = pc.and_(pc.invert(pc.fill_null(fcs, pa.scalar(False))), pa.scalar(True))
        is_play = pc.and_(base, pc.invert(pc.fill_null(pen, pa.scalar(False))))

        s["penalty"] += pc.sum(pc.and_(base, pc.fill_null(pen, pa.scalar(False)))).as_py() or 0

        # totals
        s["plays"] += int(pc.sum(pc.cast(is_play, pa.int64())).as_py() or 0)
        s["td"] += int(pc.sum(pc.cast(pc.and_(is_play, pc.fill_null(td, pa.scalar(False))), pa.int64())).as_py() or 0)

        # --- runs ---
        run_mask = pc.and_(is_play, pc.fill_null(rush, pa.scalar(False)))
        run_y = pc.if_else(pc.is_null(yrush), pa.scalar(0), yrush)
        s["rush"] += int(pc.sum(pc.cast(run_mask, pa.int64())).as_py() or 0)
        rl = bucket_label(run_y, "run")
        for label, cond in rl.items():
            cnt = pc.sum(pc.cast(pc.and_(run_mask, pc.fill_null(cond, pa.scalar(False))), pa.int64())).as_py() or 0
            run_dist[label] += int(cnt)
        # runs by down + red zone / goal line
        for dn in (1, 2, 3, 4):
            m = pc.and_(run_mask, pc.equal(pc.fill_null(down, pa.scalar(0)), pa.scalar(dn)))
            by_down[dn][0] += int(pc.sum(pc.cast(m, pa.int64())).as_py() or 0)
        rz_run = pc.and_(run_mask, pc.less_equal(pc.fill_null(yte, pa.scalar(99)), pa.scalar(20)))
        rz["rush"] += int(pc.sum(pc.cast(rz_run, pa.int64())).as_py() or 0)
        rz["plays"] += int(pc.sum(pc.cast(rz_run, pa.int64())).as_py() or 0)
        rz["td"] += int(pc.sum(pc.cast(pc.and_(rz_run, pc.fill_null(td, pa.scalar(False))), pa.int64())).as_py() or 0)
        gl_run = pc.and_(run_mask, pc.less_equal(pc.fill_null(yte, pa.scalar(99)), pa.scalar(5)))
        gl["rush"] += int(pc.sum(pc.cast(gl_run, pa.int64())).as_py() or 0)
        gl["plays"] += int(pc.sum(pc.cast(gl_run, pa.int64())).as_py() or 0)
        gl["td"] += int(pc.sum(pc.cast(pc.and_(gl_run, pc.fill_null(td, pa.scalar(False))), pa.int64())).as_py() or 0)

        # --- passes (incl. sacks in the attempt pool) ---
        pass_mask = pc.and_(is_play, pc.fill_null(pas, pa.scalar(False)))
        sack_mask = pc.and_(pass_mask, pc.fill_null(sack, pa.scalar(False)))
        att_mask = pc.and_(pass_mask, pc.fill_null(attempt, pa.scalar(False)))
        s["pass"] += int(pc.sum(pc.cast(pass_mask, pa.int64())).as_py() or 0)
        s["sack"] += int(pc.sum(pc.cast(sack_mask, pa.int64())).as_py() or 0)
        for dn in (1, 2, 3, 4):
            m = pc.and_(pass_mask, pc.equal(pc.fill_null(down, pa.scalar(0)), pa.scalar(dn)))
            by_down[dn][1] += int(pc.sum(pc.cast(m, pa.int64())).as_py() or 0)
        # completion = attempt, not sack, text lacks 'incomplete'/'intercept'
        txt_l = pc.utf8_lower(pc.fill_null(txt, pa.scalar("")))
        incomplete = pc.match_substring(txt_l, "incomplete")
        intercepted = pc.match_substring(txt_l, "intercept")
        comp_mask = pc.and_(att_mask, pc.invert(incomplete))
        comp_mask = pc.and_(comp_mask, pc.invert(intercepted))
        int_mask = pc.and_(att_mask, intercepted)
        s["complete"] += int(pc.sum(pc.cast(comp_mask, pa.int64())).as_py() or 0)
        s["incomplete"] += int(pc.sum(pc.cast(pc.and_(att_mask, incomplete), pa.int64())).as_py() or 0)
        s["int"] += int(pc.sum(pc.cast(int_mask, pa.int64())).as_py() or 0)

        comp_y = pc.if_else(pc.is_null(sy), pa.scalar(0), sy)
        pl = bucket_label(comp_y, "pass")
        for label, cond in pl.items():
            cnt = pc.sum(pc.cast(pc.and_(comp_mask, pc.fill_null(cond, pa.scalar(False))), pa.int64())).as_py() or 0
            pass_dist[label] += int(cnt)
        rz_pass = pc.and_(pass_mask, pc.less_equal(pc.fill_null(yte, pa.scalar(99)), pa.scalar(20)))
        rz["pass"] += int(pc.sum(pc.cast(rz_pass, pa.int64())).as_py() or 0)
        rz["plays"] += int(pc.sum(pc.cast(rz_pass, pa.int64())).as_py() or 0)
        rz["td"] += int(pc.sum(pc.cast(pc.and_(rz_pass, pc.fill_null(td, pa.scalar(False))), pa.int64())).as_py() or 0)
        gl_pass = pc.and_(pass_mask, pc.less_equal(pc.fill_null(yte, pa.scalar(99)), pa.scalar(5)))
        gl["pass"] += int(pc.sum(pc.cast(gl_pass, pa.int64())).as_py() or 0)
        gl["plays"] += int(pc.sum(pc.cast(gl_pass, pa.int64())).as_py() or 0)
        gl["td"] += int(pc.sum(pc.cast(pc.and_(gl_pass, pc.fill_null(td, pa.scalar(False))), pa.int64())).as_py() or 0)

        print(f"  {season}: {nrows} rows scanned")

    def dist(dd, total):
        return {k: round(dd.get(k, 0) / total, 4) for k in BUCKETS}

    def cdf(dd):
        out = {}; c = 0.0
        for k in BUCKETS:
            c += dd.get(k, 0)
            out[k] = round(c, 4)
        return out

    run_tot = sum(run_dist.values()) or 1
    pass_tot = sum(pass_dist.values()) or 1
    run_d = dist(run_dist, run_tot)
    pass_d = dist(pass_dist, pass_tot)
    att = s["complete"] + s["incomplete"] + s["int"]
    dp = att + s["sack"]
    comp = s["complete"] / max(1, att)
    sack_rate = s["sack"] / max(1, dp)
    int_rate = s["int"] / max(1, att)
    out = {
        "source": "sportsdataverse / ESPN CFB play-by-play 2023-2024 (FBS)",
        "totals": {
            "plays": s["plays"], "rush": s["rush"], "pass": s["pass"],
            "complete": s["complete"], "incomplete": s["incomplete"], "sack": s["sack"],
            "int": s["int"], "td": s["td"], "penalty": s["penalty"],
            "comp_rate": round(comp, 4),
            "sack_per_dropback": round(sack_rate, 4),
            "int_per_att": round(int_rate, 4),
        },
        "runDist": run_d, "runCdf": cdf(run_d),
        "passDist": pass_d, "passCdf": cdf(pass_d),
        "byDown": by_down,
        "redZone": dict(rz), "goalLine": dict(gl),
    }
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=1)
    print("wrote", OUT)
    print(json.dumps(out["totals"], indent=1))
    print("byDown", by_down)
    print("runDist", run_d)
    print("passDist", pass_d)


if __name__ == "__main__":
    main()
