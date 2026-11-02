#!/usr/bin/env python3
"""
Harvest OpenStreetMap EV charging stations (amenity=charging_station) for India.
Data (c) OpenStreetMap contributors, ODbL -- credit them and review ODbL terms
if you redistribute a derived database.

  python scrape_osm_india.py                    # tiled Overpass harvest, resumable
  python scrape_osm_india.py --refresh          # ignore cached tiles, re-download
  python scrape_osm_india.py --input x.json     # parse a saved Overpass JSON instead

Safeguards: raw tile responses are cached in --raw-dir (resume + audit); Overpass
"remark" runtime errors (silent partial results) count as failures; failed tiles are
split and retried; coordinates are validated; a coverage summary is printed; exit
code is 2 if any tile failed.
"""
import argparse, csv, datetime, json, os, re, sys, time, urllib.parse, urllib.request
from collections import Counter

MIRRORS = ["https://overpass-api.de/api/interpreter",
           "https://overpass.kumi.systems/api/interpreter",
           "https://overpass.private.coffee/api/interpreter"]
HEADERS = {"Accept": "*/*", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"}
S, W, N, E = 6.0, 68.0, 37.5, 97.5            # India bounding box
TILE = 4.0
TEMPLATE = """[out:json][timeout:180][bbox:{s},{w},{n},{e}];
area["ISO3166-1"="IN"]->.in;
nwr["amenity"="charging_station"](area.in);
out center tags meta;"""
FIELDS = ["osm_id", "name", "lat", "lon", "power_kw", "connector_type", "current_type",
          "num_points", "operator", "brand", "network", "ref", "city", "state", "postcode",
          "fee", "opening_hours", "osm_last_edit", "collected_at", "source"]
DC_SOCKETS = {"chademo", "type2_combo", "ccs", "gb_t_dc", "tesla_supercharger", "nacs"}
WARN = Counter()


def post(query, tries=6):
    body = urllib.parse.urlencode({"data": query}).encode()
    for i in range(tries):
        url = MIRRORS[i % len(MIRRORS)]
        try:
            req = urllib.request.Request(url, data=body, headers=HEADERS, method="POST")
            with urllib.request.urlopen(req, timeout=240) as r:
                data = json.loads(r.read().decode("utf-8"))
            remark = data.get("remark", "")
            if "error" in remark.lower() or "timed out" in remark.lower() or "out of memory" in remark.lower():
                raise RuntimeError(f"Overpass partial result: {remark[:90]}")   # NOT a success
            return data
        except Exception as e:
            wait = min(60, 5 * (i + 1))
            print(f"    {url.split('/')[2]}: {e}; retry in {wait}s", file=sys.stderr)
            time.sleep(wait)
    return None


def fetch_tile(s, w, n, e, raw_dir, refresh, depth=0):
    path = os.path.join(raw_dir, f"tile_{s:g}_{w:g}_{n:g}_{e:g}.json")
    if os.path.exists(path) and not refresh:
        return json.load(open(path, encoding="utf-8"))["elements"]
    data = post(TEMPLATE.format(s=s, w=w, n=n, e=e))
    if data is not None:
        json.dump(data, open(path, "w", encoding="utf-8"))
        return data["elements"]
    if depth < 2 and (n - s) > 1:                      # split a failing tile into 4 and retry
        ms, mw = (s + n) / 2, (w + e) / 2
        subs = [fetch_tile(a, b, c, d, raw_dir, refresh, depth + 1)
                for a, b, c, d in [(s, w, ms, mw), (s, mw, ms, e), (ms, w, n, mw), (ms, mw, n, e)]]
        return None if any(x is None for x in subs) else [el for x in subs for el in x]
    return None


def harvest(raw_dir, refresh):
    os.makedirs(raw_dir, exist_ok=True)
    found, failed, per_tile = {}, [], {}
    lats = [S + i * TILE for i in range(int((N - S) / TILE) + 1)]
    lons = [W + i * TILE for i in range(int((E - W) / TILE) + 1)]
    for s in lats:
        for w in lons:
            n, e = min(s + TILE, N), min(w + TILE, E)
            els = fetch_tile(s, w, n, e, raw_dir, refresh)
            if els is None:
                failed.append((s, w)); print(f"tile {s:g},{w:g}: FAILED"); continue
            for el in els:
                found[(el["type"], el["id"])] = el
            per_tile[(s, w)] = len(els)
            print(f"tile {s:g},{w:g}: {len(els)} (unique total {len(found)})")
            time.sleep(1.5)
    return list(found.values()), failed, per_tile


def to_kw(v):
    """'50 kW', '50kW', '7,4 kW', '22;50', '22000 W', '50' -> max kW (None if unparseable)."""
    best = None
    for part in re.split(r"[;/]", str(v)):
        m = re.search(r"(\d+(?:[.,]\d+)?)\s*(mw|kw|w)?", part.strip().lower())
        if not m:
            continue
        x = float(m.group(1).replace(",", "."))
        unit = m.group(2)
        if unit == "w" or (unit is None and x >= 1000):   # watts -> kW (fixes old x1000 bug)
            x /= 1000
        elif unit == "mw":
            x *= 1000
        best = x if best is None else max(best, x)
    if best is None:
        WARN["unparsed_power"] += 1
    return best


def parse(el, collected_at):
    t = el.get("tags", {})
    lat = el.get("lat") if el.get("lat") is not None else (el.get("center") or {}).get("lat")
    lon = el.get("lon") if el.get("lon") is not None else (el.get("center") or {}).get("lon")
    if lat is None or lon is None:
        return None, "missing_coords"
    if not (6 <= lat <= 37.7 and 67.5 <= lon <= 97.6):
        return None, "outside_india_bbox"
    sockets, powers, count = [], [], 0
    for k, v in t.items():
        m = re.fullmatch(r"socket:([a-z0-9_]+)", k)
        if m:
            sockets.append(m.group(1))
            if str(v).isdigit(): count += int(v)
            elif v not in ("yes", "no"): WARN["odd_socket_count"] += 1
        if re.fullmatch(r"socket:[a-z0-9_]+:output", k) or k in ("charging_station:output", "maxpower"):
            p = to_kw(v)
            if p is not None: powers.append(p)
    best = max(powers) if powers else None
    if best is not None:
        cur = "DC Fast" if best >= 40 else "AC"
    elif any(s in DC_SOCKETS for s in sockets):
        cur = "DC Fast"
    else:
        cur = ""
    cap = t.get("capacity", "")
    return {"osm_id": f"{el['type'][0]}{el['id']}", "name": t.get("name") or "",
            "lat": round(lat, 6), "lon": round(lon, 6),
            "power_kw": round(best, 2) if best is not None else "",
            "connector_type": "; ".join(sorted(set(sockets))), "current_type": cur,
            "num_points": cap if str(cap).isdigit() else (count or ""),
            "operator": t.get("operator", ""), "brand": t.get("brand", ""),
            "network": t.get("network", ""), "ref": t.get("ref", ""),
            "city": t.get("addr:city", ""), "state": t.get("addr:state", ""),
            "postcode": t.get("addr:postcode", ""), "fee": t.get("fee", ""),
            "opening_hours": t.get("opening_hours", ""),
            "osm_last_edit": el.get("timestamp", ""), "collected_at": collected_at,
            "source": "osm"}, None


def summary(rows, failed, per_tile, min_expected):
    n = len(rows)
    print("\n=== SUMMARY ===")
    print(f"stations: {n}")
    for f in ("name", "operator", "power_kw", "connector_type", "num_points", "city", "state"):
        have = sum(1 for r in rows if r[f] != "")
        print(f"  {f:15s} filled {have:6d} ({100 * have / max(n, 1):5.1f}%)")
    top = sorted(per_tile.items(), key=lambda x: -x[1])[:5]
    print("  busiest tiles:", ", ".join(f"{k}:{v}" for k, v in top))
    if WARN: print("  parse warnings:", dict(WARN))
    if failed: print(f"  !! {len(failed)} tiles FAILED: {failed} -- re-run to resume")
    if n < min_expected:
        print(f"  !! only {n} stations (< --min-expected {min_expected}); likely INCOMPLETE. "
              f"Check failed tiles / server remarks before trusting this.")
    print("  Credit: (c) OpenStreetMap contributors (ODbL).")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input"); ap.add_argument("--out", default="stations_osm_india.csv")
    ap.add_argument("--raw-dir", default="raw_osm"); ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--contact", default=os.environ.get("OVERPASS_CONTACT", ""),
                    help="your real email or project URL; sent in the User-Agent (required for live harvest)")
    ap.add_argument("--tile", type=float, default=None, help="tile size in degrees (default 4, or 2 with --bbox)")
    ap.add_argument("--bbox", help="S,W,N,E to harvest only a region, e.g. Maharashtra: 15.6,72.6,22.1,80.9")
    ap.add_argument("--min-expected", type=int, default=1000,
                    help="warn if fewer stations than this (heuristic, tune to your expectations)")
    a = ap.parse_args()
    global TILE
    if not a.input:
        if not a.contact or "example.com" in a.contact or "@" not in a.contact and "http" not in a.contact:
            sys.exit('Overpass blocks anonymous clients (HTTP 406). Run with your real contact, e.g.\n'
                     '  python scrape_osm_india.py --contact you@gmail.com --bbox ...')
        HEADERS["User-Agent"] = f"RouteR-EV-harvest/1.0 (contact: {a.contact})"
    TILE = a.tile or (2.0 if a.bbox else 4.0)
    if a.bbox:
        global S, W, N, E
        S, W, N, E = [float(x) for x in a.bbox.split(",")]
    failed, per_tile = [], {}
    if a.input:
        elements = json.load(open(a.input, encoding="utf-8")).get("elements", [])
    else:
        elements, failed, per_tile = harvest(a.raw_dir, a.refresh)
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    rows, rejects = [], []
    for el in elements:
        r, why = parse(el, now)
        if r: rows.append(r)
        else: rejects.append({"osm_id": f"{el['type'][0]}{el['id']}", "reason": why})
    with open(a.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS); w.writeheader(); w.writerows(rows)
    if rejects:
        rp = a.out.replace(".csv", "_rejects.csv")
        with open(rp, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["osm_id", "reason"]); w.writeheader(); w.writerows(rejects)
        print(f"{len(rejects)} records rejected -> {rp}")
    print(f"Exported {len(rows)} stations -> {a.out}")
    summary(rows, failed, per_tile, a.min_expected)
    sys.exit(2 if failed else 0)

if __name__ == "__main__":
    main()
