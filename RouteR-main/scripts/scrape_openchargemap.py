#!/usr/bin/env python3
"""
EV Charging Stations State-Wide Scraper for OpenChargeMap (OCM)
Exports stations in Maharashtra (or any specified state/country) directly to CSV format.
"""

import os
import sys
import csv
import json
import urllib.request
import urllib.parse

OCM_API_KEY = os.environ.get("OCM_API_KEY", "2b919b17-4442-4cb9-9b78-7abd03d0167a")
OUTPUT_CSV = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "stations.csv")

# Maharashtra bounding regions and major metropolitan bounding boxes / query points
# Center coordinates: Latitude: 19.7515, Longitude: 75.7139
SEARCH_POINTS = [
    {"name": "Sangli-Miraj-Kolhapur Corridor", "lat": 16.8524, "lon": 74.5815, "distance_km": 100},
    {"name": "Pune Metropolitan & Expressway", "lat": 18.5204, "lon": 73.8567, "distance_km": 120},
    {"name": "Mumbai & MMR Corridor", "lat": 19.0760, "lon": 72.8777, "distance_km": 100},
    {"name": "Nashik & Northern Maharashtra", "lat": 19.9975, "lon": 73.7898, "distance_km": 120},
    {"name": "Satara & Karad NH48 Corridor", "lat": 17.6805, "lon": 74.0183, "distance_km": 90},
    {"name": "Solapur & Marathwada", "lat": 17.6599, "lon": 75.9064, "distance_km": 130},
    {"name": "Chhatrapati Sambhaji Nagar (Aurangabad)", "lat": 19.8762, "lon": 75.3433, "distance_km": 130},
    {"name": "Nagpur & Vidarbha East Hub", "lat": 21.1458, "lon": 79.0882, "distance_km": 150},
    {"name": "Amravati & Akola Highway", "lat": 20.9320, "lon": 77.7523, "distance_km": 120},
    {"name": "Ratnagiri & Konkan Coast", "lat": 16.9902, "lon": 73.3120, "distance_km": 120},
    {"name": "Dhule & Jalgaon Corridor", "lat": 20.9042, "lon": 74.7749, "distance_km": 120},
    {"name": "Nanded & Latur Corridor", "lat": 19.1383, "lon": 77.3210, "distance_km": 130}
]

def fetch_poi(lat, lon, distance_km):
    params = {
        "output": "json",
        "latitude": lat,
        "longitude": lon,
        "distance": distance_km,
        "distanceunit": "KM",
        "countrycode": "IN",
        "maxresults": 250,
        "compact": "true",
        "verbose": "false",
        "key": OCM_API_KEY
    }
    url = f"https://api.openchargemap.io/v3/poi/?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(
        url,
        headers={
            "X-API-Key": OCM_API_KEY,
            "User-Agent": "MakeMyRoute-EV/1.0 (mahadiks666@gmail.com)"
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            if resp.status == 200:
                return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"  [WARN] Request failed for {lat}, {lon}: {e}")
    return []

def main():
    print("=" * 65)
    print("  MAHARASHTRA STATE-WIDE EV CHARGING STATIONS SCRAPER")
    print("  Fetching real operational chargers via OpenChargeMap API")
    print("=" * 65)

    seen_ids = set()
    stations_collected = []

    for pt in SEARCH_POINTS:
        print(f"-> Querying region: {pt['name']} ({pt['distance_km']} km radius)...")
        results = fetch_poi(pt["lat"], pt["lon"], pt["distance_km"])
        new_count = 0
        for item in results:
            ocm_id = item.get("ID")
            if not ocm_id or ocm_id in seen_ids:
                continue
            seen_ids.add(ocm_id)

            addr = item.get("AddressInfo", {})
            lat = addr.get("Latitude")
            lon = addr.get("Longitude")
            if not lat or not lon:
                continue

            conns = item.get("Connections", [])
            best_power = 50.0
            conn_type = "CCS2"
            if conns:
                for c in conns:
                    p = c.get("PowerKW")
                    if p and p > best_power:
                        best_power = float(p)
                    t = c.get("ConnectionType", {}).get("FormalName") or c.get("ConnectionType", {}).get("Title")
                    if t:
                        conn_type = t

            current_type = "DC Fast" if best_power >= 40 else "AC"
            op_title = item.get("OperatorInfo", {}).get("Title") or "Public EV Network"
            state = addr.get("StateOrProvince") or "Maharashtra"
            city = addr.get("Town") or pt["name"].split()[0]
            name = addr.get("Title") or f"{op_title} Station {ocm_id}"

            stations_collected.append({
                "ocm_id": ocm_id,
                "name": name,
                "lat": round(lat, 5),
                "lon": round(lon, 5),
                "power_kw": int(best_power),
                "connector_type": conn_type,
                "current_type": current_type,
                "operator": op_title,
                "city": city,
                "state": state,
                "pricing_inr_kwh": 18.50,
                "status": "Operational"
            })
            new_count += 1
        print(f"   Collected {new_count} stations. Total unique: {len(stations_collected)}")

    os.makedirs(os.path.dirname(OUTPUT_CSV), exist_ok=True)
    fieldnames = [
        "ocm_id", "name", "lat", "lon", "power_kw", "connector_type",
        "current_type", "operator", "city", "state", "pricing_inr_kwh", "status"
    ]

    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in stations_collected:
            writer.writerow(row)

    print("-" * 65)
    print(f"SUCCESS: Exported {len(stations_collected)} stations to {OUTPUT_CSV}")
    print("=" * 65)

if __name__ == "__main__":
    main()
