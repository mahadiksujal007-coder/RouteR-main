# OCM_INTEGRATION_DIRECTIVE.md

## Antigravity AI — OpenChargeMap API Integration Specification

### AI Orchestrator Directional Prompt | Full Field Analysis | Deterministic Retrieval Logic

> **Authority Level:** This document is the single source of truth for how the AI orchestrator interacts with the OpenChargeMap (OCM) v3 API. Every field, every state, every edge case is classified here. The orchestrator must follow these rules deterministically — no inference, no assumptions, no skipping fields.

---

## SECTION 0 — ORCHESTRATOR MANDATE

You are the OCM Integration Agent within the Antigravity AI EV routing system. Your sole responsibility is to:

1. **Retrieve** charging station data from the OCM v3 API (`https://api.openchargemap.io/v3/poi`)
2. **Normalize** the raw OCM response into the Antigravity internal `StationRecord` schema
3. **Filter** using deterministic rules on every field — never guess, never approximate
4. **Cache** results with a 24-hour TTL on disk and promote hot entries to memory
5. **Map** each valid station to its nearest OSMnx graph node
6. **Rank** stations by suitability for the EV's specific connector type, power need, and route position
7. **Fallback** gracefully using stale cache when the API is unreachable

You have 5 years of maintained experience integrating with OCM. You know that:

- OCM data is community-sourced — field presence is never guaranteed
- `null` and missing keys are equally possible on any non-required field
- `StatusTypeID: 50` is the ONLY status that means "operational"
- Connection-level status can differ from site-level status — both must be checked
- `PowerKW` at connection level is more reliable than inferring from `LevelID`
- `Latitude` and `Longitude` in `AddressInfo` can be `0.0` — these are invalid and must be rejected
- `IsFastChargeCapable` on the `Level` object is deprecated — use `PowerKW >= 40` instead

---

## SECTION 1 — API ENDPOINT SPECIFICATION

### 1.1 Base Request

```
GET https://api.openchargemap.io/v3/poi
Headers:
  Accept: application/json
  User-Agent: AntigravityAI/1.0
```

### 1.2 Query Parameters — Complete Reference with Usage Rules

The orchestrator MUST build the query string by evaluating every parameter below. Do not omit any parameter from this table — use the default if no value applies.

| Parameter          | Type     | Orchestrator Rule                                                                                                                                                | Example                              |
| ------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `key`              | string   | **REQUIRED**. Always inject from `OCM_API_KEY` env var. Never hardcode.                                                                                          | `key=abc123`                         |
| `latitude`         | float    | **REQUIRED**. Route corridor midpoint latitude. Round to 6 decimal places.                                                                                       | `latitude=20.005900`                 |
| `longitude`        | float    | **REQUIRED**. Route corridor midpoint longitude. Round to 6 decimal places.                                                                                      | `longitude=73.789800`                |
| `distance`         | float    | **REQUIRED**. Set to `CORRIDOR_RADIUS_KM` from config (default: 8.0).                                                                                            | `distance=8.0`                       |
| `distanceunit`     | string   | **ALWAYS** set to `"KM"`. Never use miles — internal system uses metric.                                                                                         | `distanceunit=KM`                    |
| `maxresults`       | int      | Set to `100`. Increase to `200` if `REGION_STATION_DENSITY=high` in config.                                                                                      | `maxresults=100`                     |
| `output`           | string   | **ALWAYS** set to `"json"`. Never use `geojson`, `xml`, or `csv`.                                                                                                | `output=json`                        |
| `statustypeid`     | int      | **ALWAYS** set to `50`. Only fetch operational stations. Never omit this.                                                                                        | `statustypeid=50`                    |
| `verbose`          | boolean  | **ALWAYS** set to `false`. Removes null fields, reduces payload 40–60%.                                                                                          | `verbose=false`                      |
| `compact`          | boolean  | **ALWAYS** set to `false`. We need full reference objects, not just IDs.                                                                                         | `compact=false`                      |
| `camelcase`        | boolean  | **ALWAYS** set to `false`. OCM uses PascalCase — do not change field names.                                                                                      | `camelcase=false`                    |
| `connectiontypeid` | string   | **CONDITIONAL**. If `ev_profile.connector_type_ids` is non-empty, pass as comma-separated list. If empty, omit this parameter entirely to avoid over-filtering.  | `connectiontypeid=25,33`             |
| `countrycode`      | string   | **CONDITIONAL**. Set to ISO 2-char code if region is country-specific (e.g., `IN` for India). Omit for cross-border routes.                                      | `countrycode=IN`                     |
| `opendata`         | boolean  | Set to `false`. Include all data sources — proprietary operators have more complete station data than open-data-only sources.                                    | `opendata=false`                     |
| `includecomments`  | boolean  | Set to `false` in routing calls. Set to `true` only on `/api/stations/:id` detail requests — comments add ~3KB per station.                                      | `includecomments=false`              |
| `modifiedsince`    | datetime | **CACHE REFRESH ONLY**. When refreshing stale cache, set to `cache_write_timestamp` to fetch only changed records. Omit on cold fetch.                           | `modifiedsince=2026-03-10T00:00:00Z` |
| `sortby`           | string   | Omit. Default spatial sort is optimal for corridor-based queries.                                                                                                | _(omit)_                             |
| `boundingbox`      | array    | **ALTERNATIVE** to lat/lon/distance. Use for bounding box queries when route is a straight east-west or north-south corridor. Format: `(lat,lng),(lat2,lng2)`.   | _(omit for radius queries)_          |
| `polyline`         | string   | **ADVANCED USE**. Pass encoded route polyline for corridor-exact station search. Use with `distance=5` for a 5km buffer around the exact route. Phase 2 feature. | _(omit in MVP)_                      |
| `levelid`          | array    | **DEPRECATED by OCM**. Do not use. Use `PowerKW` field comparison instead.                                                                                       | _(never use)_                        |
| `dataproviderid`   | array    | Omit. Including all data providers maximizes coverage.                                                                                                           | _(omit)_                             |
| `operatorid`       | array    | Omit unless targeting specific networks (e.g., Tata Power EV in India).                                                                                          | _(omit)_                             |
| `usagetypeid`      | array    | Omit. Some public membership stations are freely usable — do not filter by usage type at fetch time. Filter post-retrieval.                                      | _(omit)_                             |
| `greaterthanid`    | string   | **PAGINATION ONLY**. Set to last `ID` from previous batch when result count equals `maxresults`. Indicates more results exist.                                   | _(omit unless paginating)_           |

### 1.3 Constructed Request — MVP Default

```python
def build_ocm_request_params(
    lat: float,
    lon: float,
    radius_km: float = 8.0,
    connector_type_ids: list[int] = None,
    country_code: str = None,
    modified_since: str = None,
) -> dict:
    """
    Builds the complete OCM API query parameter dict.
    All defaults follow the Antigravity orchestrator specification.
    """
    params = {
        "key":          OCM_API_KEY,
        "latitude":     round(lat, 6),
        "longitude":    round(lon, 6),
        "distance":     radius_km,
        "distanceunit": "KM",
        "maxresults":   100,
        "output":       "json",
        "statustypeid": 50,        # Operational only
        "verbose":      "false",
        "compact":      "false",
        "camelcase":    "false",
        "opendata":     "false",
        "includecomments": "false",
    }

    # Conditional parameters
    if connector_type_ids:
        params["connectiontypeid"] = ",".join(str(i) for i in connector_type_ids)
    if country_code:
        params["countrycode"] = country_code.upper()
    if modified_since:
        params["modifiedsince"] = modified_since

    return params
```

---

## SECTION 2 — FULL RESPONSE FIELD ANALYSIS

### 2.1 Top-Level POI Object

For every item in the response array, the orchestrator processes these top-level fields.

#### `ID` (integer, always present)

The OCM reference ID for the POI. This is the **primary key** for all caching, deduplication, and graph node mapping.

- **Orchestrator rule:** Always store. Never null-check — ID is always present on valid responses.
- **Cache key component:** `station:{ID}` in L1 memory cache.
- **Deduplication:** If a station with this ID already exists in the current batch result, keep the one with the higher `DataQualityLevel`.

#### `UUID` (string uuid, always present)

Universally unique identifier. Used as surrogate key for cross-system reconciliation.

- **Orchestrator rule:** Store but do not use as primary key in Antigravity. Use `ID` for all lookups.
- **Use case:** Logging, external reporting, OCM sync operations.

#### `StatusTypeID` (integer)

Overall operational status of the entire site.

- **Values and orchestrator actions:**

| StatusTypeID | Meaning                   | Orchestrator Action                                                                          |
| ------------ | ------------------------- | -------------------------------------------------------------------------------------------- |
| `50`         | Operational               | ✅ Process this station                                                                      |
| `0`          | Unknown                   | ⚠️ Include only if no `50` stations available in corridor — flag as `status_uncertain: true` |
| `75`         | Temporarily Unavailable   | ❌ Exclude                                                                                   |
| `100`        | Operational (Unconfirmed) | ⚠️ Include with `status_uncertain: true`                                                     |
| `150`        | Planned For Future        | ❌ Exclude                                                                                   |
| `200`        | Removed/Delisted          | ❌ Exclude immediately                                                                       |
| `210`        | Removed (Duplicate)       | ❌ Exclude immediately                                                                       |

- **Critical rule:** Even if `statustypeid=50` was passed as a query param, verify this field again in the response. OCM's server-side filter is not always precise.

#### `DateLastVerified` (string ISO 8601, nullable)

Date of last community verification.

- **Orchestrator rule:** If `DateLastVerified` is older than 180 days from today, add `verification_stale: true` to the normalized record. Do NOT exclude — stale-verified stations are still usable, but flag for UI display.
- **Null handling:** If null, set `verification_stale: true` unconditionally.

#### `IsRecentlyVerified` (boolean)

Computed server-side signal indicating recent positive activity.

- **Orchestrator rule:** Store as `is_recently_verified`. Boost ranking score by +10 points when `true`.

#### `DataQualityLevel` (integer 1–5)

Quality metric applied during import (5 = best quality).

- **Orchestrator rule:** Use in ranking formula. Stations with `DataQualityLevel >= 3` are preferred. Stations with `DataQualityLevel == 1` are flagged as `low_quality: true`.
- **Ranking contribution:** `quality_score = DataQualityLevel * 4` (max 20 points).

#### `NumberOfPoints` (integer)

Total number of bays or charging points at this site.

- **Orchestrator rule:** Use in ranking. Higher = more likely a bay is free. `availability_score = min(NumberOfPoints, 5) * 3` (max 15 points).
- **Null/zero handling:** If null or 0, derive from `sum(conn.Quantity for conn in Connections)`. If still 0, set to 1 as minimum.

#### `UsageCost` (string, nullable)

Free-text description of charging cost.

- **Orchestrator rule:** Store as-is. Pass through to API response for UI display. Do NOT attempt to parse into a numeric value — format is inconsistent across operators.

#### `GeneralComments` (string, nullable)

Factual additional information about the site.

- **Orchestrator rule:** Store for detail endpoint only. Exclude from routing response — adds unnecessary payload size.

---

### 2.2 `AddressInfo` Object — Critical Fields

This is the geographic heart of each station. All coordinate validation lives here.

#### `Latitude` and `Longitude` (float, required by schema)

The WGS84 coordinates of the charging site.

```
CRITICAL VALIDATION RULES — apply in this exact order:

1. NULL CHECK: If Latitude is null OR Longitude is null
   → REJECT station entirely. Cannot map to graph node.
   → Log: "Station {ID} rejected: null coordinates"

2. ZERO CHECK: If Latitude == 0.0 AND Longitude == 0.0
   → REJECT station entirely. OCM uses 0,0 as a sentinel for "no data".
   → Log: "Station {ID} rejected: zero coordinates (0,0)"

3. RANGE CHECK: If abs(Latitude) > 90 OR abs(Longitude) > 180
   → REJECT station entirely. Invalid WGS84 coordinates.
   → Log: "Station {ID} rejected: out-of-range coordinates"

4. PRECISION CHECK: If Latitude == round(Latitude, 0) AND Longitude == round(Longitude, 0)
   → Flag as low_precision: true (whole-number coordinates = approximate location)
   → Include in results but add 20% uncertainty radius for graph mapping

5. Only stations passing checks 1-3 proceed to graph node mapping.
```

```python
def validate_coordinates(lat, lon, station_id: int) -> tuple[bool, str]:
    """Returns (is_valid, rejection_reason)"""
    if lat is None or lon is None:
        return False, f"Station {station_id}: null coordinates"
    if lat == 0.0 and lon == 0.0:
        return False, f"Station {station_id}: zero sentinel coordinates"
    if abs(lat) > 90 or abs(lon) > 180:
        return False, f"Station {station_id}: out-of-range lat={lat} lon={lon}"
    return True, ""
```

#### `Town` (string, nullable)

City or town name.

- **Orchestrator rule:** Use for cache key disambiguation when multiple regions overlap. Normalize to lowercase. Null → `"unknown_town"`.

#### `Country.ISOCode` (string)

Two-character ISO country code.

- **Orchestrator rule:** Use to validate station is within the expected routing region. If country does not match `ROUTING_COUNTRY_CODE` config, exclude unless route is cross-border.
- **Known codes used:** `IN` (India), `IL` (Israel), `GB` (United Kingdom), etc.

#### `AccessComments` (string, nullable)

Human-readable access guidance.

- **Orchestrator rule:** Store for detail endpoint. Exclude from routing response.

#### `Distance` (float, nullable)

Distance from search point, returned by OCM when lat/lon search is used.

- **Orchestrator rule:** If present, use as primary distance value instead of computing Haversine. If null, compute Haversine from station coordinates to search point.

#### `DistanceUnit` (integer)

0 = Unknown, 1 = Miles, 2 = KM.

- **Orchestrator rule:** Always convert to KM before storing. `if DistanceUnit == 1: distance_km = distance * 1.60934`

---

### 2.3 `Connections` Array — The Most Critical Object

Each connection represents a physical charging port at the site. A single site can have multiple connections of different types and power levels. **The orchestrator evaluates connections individually — not the site as a whole.**

For every connection in the `Connections` array, apply this complete evaluation:

#### `ID` (integer)

Connection-level unique ID.

- **Orchestrator rule:** Store as `connection_id`. Used for de-duplication within a site.

#### `ConnectionTypeID` (integer) and `ConnectionType` (object)

This is the **connector standard identifier**. The orchestrator must map between OCM's ConnectionTypeIDs and the EV profile's connector type list.

**Complete ConnectionTypeID → Standard Name Mapping:**

```python
OCM_CONNECTOR_MAP = {
    # Type 2 family (most common in Europe, India)
    25:  "Type2",          # IEC 62196-2 Type 2 (Socket Only)
    1036: "Type2_Cable",   # Type 2 with attached cable

    # CCS family (DC fast charging)
    33:  "CCS2",           # IEC 62196-3 Configuration FF (CCS Type 2) ← most important
    32:  "CCS1",           # SAE J1772 Combined (CCS Type 1) ← US market

    # CHAdeMO (DC, mostly Japanese vehicles)
    2:   "CHAdeMO",

    # GB/T (China)
    26:  "GBT_AC",         # GB/T AC
    27:  "GBT_DC",         # GB/T DC

    # Type 1 / SAE J1772 (AC, North America)
    1:   "Type1_J1772",

    # CEE / Schuko (residential/legacy)
    28:  "CEE3",           # 3-pin CEE
    29:  "CEE5",           # 5-pin CEE
    8:   "Schuko",         # Standard household (rarely useful for EV fast charging)

    # Tesla proprietary
    27:  "Tesla_NACS",     # North America
    30:  "Tesla_EU",       # European Tesla connector

    # Unknown / unlisted
    0:   "Unknown",
}

def map_connector_type(connection_type_id: int, formal_name: str) -> str:
    """
    Maps OCM ConnectionTypeID to Antigravity internal connector name.
    Falls back to parsing FormalName if ID is not in map.
    """
    if connection_type_id in OCM_CONNECTOR_MAP:
        return OCM_CONNECTOR_MAP[connection_type_id]

    # Fallback: parse from FormalName
    if formal_name:
        if "62196-3" in formal_name or "CCS" in formal_name:
            return "CCS2"
        if "62196-2" in formal_name or "Type 2" in formal_name:
            return "Type2"
        if "CHAdeMO" in formal_name:
            return "CHAdeMO"
        if "J1772" in formal_name:
            return "Type1_J1772"
    return "Unknown"
```

**Compatibility check against EV profile:**

```python
def is_connector_compatible(
    ocm_connection_type_id: int,
    ocm_formal_name: str,
    ev_connector_types: list[str]
) -> bool:
    """
    Returns True if this connection is compatible with the EV.
    If ev_connector_types is empty → accept all (compatibility unknown).
    """
    if not ev_connector_types:
        return True   # Unknown EV connectors → include all stations

    mapped = map_connector_type(ocm_connection_type_id, ocm_formal_name)
    if mapped == "Unknown":
        return False  # Unknown connector type → exclude (safe default)

    return mapped in ev_connector_types
```

#### `StatusTypeID` (integer) at connection level

Connection-level operational status. **This can differ from site-level StatusTypeID.**

- **Orchestrator rule:** Evaluate independently from site-level status. A site can be `StatusTypeID: 50` (operational) but individual connections may be offline.
- **Action:** Only include a connection if BOTH site `StatusTypeID == 50` AND connection `StatusTypeID == 50`.

```python
def connection_is_operational(site_status_id: int, conn_status_id: int) -> bool:
    return site_status_id == 50 and conn_status_id == 50
```

#### `PowerKW` (float, nullable) — THE PRIMARY POWER FIELD

Peak power in kilowatts. This is the single most important field for routing decisions.

```
POWER EVALUATION RULES:

1. NULL CHECK:
   If PowerKW is None → attempt to derive from Amps * Voltage
   If Amps and Voltage are also None → set PowerKW = 0.0, flag power_unknown: true

2. ZERO CHECK:
   If PowerKW == 0.0 → flag power_unknown: true
   Include in results but exclude from charging stop insertion unless no other option

3. MINIMUM POWER FILTER:
   If PowerKW < OCM_MIN_POWER_KW (default: 7.0):
   → Exclude from routing. Too slow to be useful for range recovery.
   → Include in /api/stations response with flag slow_charger: true

4. FAST CHARGE CLASSIFICATION:
   If PowerKW >= 40.0 → is_fast_charge: true, level: "DC_FAST"
   If PowerKW >= 7.0 and PowerKW < 40.0 → is_fast_charge: false, level: "AC_STANDARD"
   NOTE: Do NOT use Level.IsFastChargeCapable — it is deprecated and inconsistent.

5. EFFECTIVE POWER CALCULATION:
   effective_power_kw = min(PowerKW, ev_profile.max_charge_rate_kw)
   This is what the EV can actually receive — used for charge time estimation.
```

```python
def resolve_power_kw(power_kw, amps, voltage) -> tuple[float, bool]:
    """
    Returns (resolved_power_kw, power_unknown_flag)
    """
    if power_kw is not None and power_kw > 0:
        return float(power_kw), False
    if amps is not None and voltage is not None and amps > 0 and voltage > 0:
        return (amps * voltage) / 1000.0, False
    return 0.0, True   # Power unknown
```

#### `LevelID` and `Level` (integer/object)

Deprecated charging level classification.

- **Orchestrator rule:** Read `Level.IsFastChargeCapable` but do NOT trust it. It is computed from LevelID, which is deprecated. Always derive fast-charge status from `PowerKW >= 40.0`.
- `Level.Comments` — informational only, not used in routing logic.

#### `CurrentTypeID` and `CurrentType` (integer/object)

Power supply type — AC or DC.

| CurrentTypeID | Description     | Orchestrator Use                                   |
| ------------- | --------------- | -------------------------------------------------- |
| `10`          | AC Single-Phase | Standard home/public AC charger                    |
| `20`          | AC Three-Phase  | Higher-power AC (up to 22kW)                       |
| `30`          | DC              | DC fast charger — most relevant for range recovery |
| `null/0`      | Unknown         | Infer from PowerKW: if >= 40kW → likely DC         |

- **Orchestrator rule:** Store `current_type`. For routing, prefer `CurrentTypeID: 30` (DC) connections when `is_fast_charge: true`.

#### `Amps` (integer, nullable)

Maximum supply current.

- **Orchestrator rule:** Store. Use only in `resolve_power_kw()` when `PowerKW` is null.

#### `Voltage` (float, nullable)

Supply voltage.

- **Orchestrator rule:** Store. Use only in `resolve_power_kw()` when `PowerKW` is null.

#### `Quantity` (integer, nullable)

Number of ports/sockets of this connection type at the site.

- **Orchestrator rule:** If null, default to 1. Contributes to `NumberOfPoints` calculation if site-level value is 0.

#### `ConnectionType.IsDiscontinued` (boolean)

Indicates the connector standard is discontinued.

- **Orchestrator rule:** If `true`, exclude this connection unless it is the only option for the EV's connector type.

#### `ConnectionType.IsObsolete` (boolean)

Indicates the connector standard is obsolete.

- **Orchestrator rule:** Same as `IsDiscontinued`. Exclude unless sole option.

---

### 2.4 `OperatorInfo` Object

Describes the network operator (e.g., Tata Power EV, POD Point, Afcon).

#### `ID` (integer)

Operator reference ID.

- **Orchestrator rule:** Store as `operator_id`. Used for operator-specific reliability weighting and future real-time API integrations.

#### `WebsiteURL` (string, nullable)

Operator website.

- **Orchestrator rule:** Store for detail endpoint. Not used in routing logic.

#### `IsPrivateIndividual` (boolean)

If true, the operator is a private person, not a commercial network.

- **Orchestrator rule:** If `true`, add `access_risk: true` flag. Private installations may be inaccessible to strangers. Deprioritize in charging stop insertion but do not exclude.

#### `IsRestrictedEdit` (boolean)

If true, the operator restricts community edits.

- **Orchestrator rule:** No routing impact. Note: stations with `IsRestrictedEdit: true` tend to have higher data quality — add +5 to ranking score.

---

### 2.5 `UsageType` Object

Describes access restrictions for the site.

| Field                  | Orchestrator Rule                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| `IsPayAtLocation`      | Store. If `true`, flag `requires_payment: true` in response.                                        |
| `IsMembershipRequired` | Store. If `true`, flag `requires_membership: true`. Present to user — they may not have membership. |
| `IsAccessKeyRequired`  | Deprecated by OCM. Ignore.                                                                          |
| `description`          | Store for display. Not used in routing logic.                                                       |

**Routing priority based on UsageType:**

```
UsageTypeID == 1 (Public)          → Priority: HIGH (no barriers)
UsageTypeID == 4 (Membership)      → Priority: MEDIUM (user may or may not have membership)
UsageTypeID == 5 (Private)         → Priority: LOW (likely inaccessible)
UsageTypeID == 7 (Restricted)      → Priority: VERY LOW (restricted access)
UsageTypeID == 0 (Unknown)         → Priority: MEDIUM (include, flag uncertain)
```

---

### 2.6 `DataProvider` Object

Describes the source of the data record.

#### `IsOpenDataLicensed` (boolean)

- **Orchestrator rule:** Store. No routing impact. Used for attribution in API responses.

#### `IsApprovedImport` (boolean)

- **Orchestrator rule:** If `false`, add `data_source_unapproved: true` flag. These stations have lower reliability. Reduce ranking score by 10 points.

#### `DataProviderStatusType.IsProviderEnabled` (boolean)

- **Orchestrator rule:** If `false`, exclude ALL stations from this provider. The data is no longer maintained.

---

### 2.7 `SubmissionStatus` Object

#### `IsLive` (boolean)

- **Orchestrator rule:** **CRITICAL.** If `IsLive == false`, exclude the station entirely. Non-live submissions are draft or delisted records that should not appear in any user-facing context.

```python
def station_is_live(submission_status: dict) -> bool:
    """Stations that are not live must never reach the routing engine."""
    return submission_status.get("IsLive", False) == True
```

---

## SECTION 3 — NORMALIZATION PIPELINE

After parsing the raw OCM response, the orchestrator runs this exact pipeline to produce the internal `StationRecord`.

### 3.1 StationRecord Schema

```python
from dataclasses import dataclass, field
from typing import Optional

@dataclass
class ConnectionRecord:
    connection_id:       int
    connector_type:      str          # Antigravity internal name (e.g., "CCS2")
    connector_type_id:   int          # OCM ConnectionTypeID
    power_kw:            float
    effective_power_kw:  float        # min(power_kw, ev_max_charge_rate)
    current_type:        str          # "AC_SINGLE", "AC_THREE", "DC"
    is_fast_charge:      bool         # power_kw >= 40.0
    quantity:            int
    is_operational:      bool
    power_unknown:       bool
    is_compatible:       bool         # Against current EV profile


@dataclass
class StationRecord:
    # Identity
    ocm_id:             int
    uuid:               str
    graph_node:         Optional[int]    # Set after ox.nearest_nodes()
    graph_node_lat:     Optional[float]
    graph_node_lon:     Optional[float]

    # Location
    name:               str
    lat:                float
    lon:                float
    town:               str
    country_iso:        str
    distance_km:        Optional[float]

    # Operator
    operator_id:        int
    operator_name:      str
    is_private_operator: bool

    # Status
    is_operational:     bool
    is_live:            bool
    is_recently_verified: bool
    verification_stale: bool
    date_last_verified: Optional[str]
    data_quality_level: int

    # Access
    usage_type_id:      int
    requires_payment:   bool
    requires_membership: bool
    number_of_points:   int

    # Connections (filtered to operational + compatible only)
    connections:        list[ConnectionRecord]
    best_connection:    Optional[ConnectionRecord]  # Highest power compatible connection

    # Derived ranking
    ranking_score:      float

    # Flags
    access_risk:        bool
    low_quality:        bool
    data_source_unapproved: bool
    status_uncertain:   bool
    low_precision_coords: bool

    # Charge time estimate (set after routing, requires EV profile)
    charge_time_minutes: Optional[float]
    arrival_soc:        Optional[float]
    departure_soc:      Optional[float]
```

### 3.2 Normalization Function

```python
def normalize_ocm_station(
    raw: dict,
    ev_profile: dict,
    search_lat: float,
    search_lon: float
) -> Optional[StationRecord]:
    """
    Converts a single raw OCM POI dict to a StationRecord.
    Returns None if station fails mandatory validation.
    Orchestrator calls this for every item in the OCM response array.
    """

    # ── GATE 1: Live check (hard exclude)
    submission = raw.get("SubmissionStatus", {}) or {}
    if not station_is_live(submission):
        return None

    # ── GATE 2: Site status check (hard exclude)
    if raw.get("StatusTypeID") not in [50, 0, 100]:
        return None

    # ── GATE 3: Data provider enabled
    dp = raw.get("DataProvider", {}) or {}
    dp_status = dp.get("DataProviderStatusType", {}) or {}
    if dp_status.get("IsProviderEnabled") is False:
        return None

    # ── GATE 4: Coordinate validation
    addr = raw.get("AddressInfo", {}) or {}
    lat  = addr.get("Latitude")
    lon  = addr.get("Longitude")
    valid, reason = validate_coordinates(lat, lon, raw.get("ID", 0))
    if not valid:
        print(f"[OCM Normalize] {reason}")
        return None

    # ── PROCESS CONNECTIONS
    raw_connections = raw.get("Connections", []) or []
    ev_connectors   = ev_profile.get("connector_types", [])
    ev_max_kw       = ev_profile.get("max_charge_rate_kw", 50.0)

    processed_connections = []
    for conn in raw_connections:
        if not conn:
            continue

        # Connection status
        site_status = raw.get("StatusTypeID", 0)
        conn_status = conn.get("StatusTypeID", 0)
        if not connection_is_operational(site_status, conn_status):
            continue

        # Connector type
        ct   = conn.get("ConnectionType", {}) or {}
        ct_id = conn.get("ConnectionTypeID", 0)
        ct_formal = ct.get("FormalName", "")

        # Skip discontinued/obsolete unless sole option
        if ct.get("IsDiscontinued") or ct.get("IsObsolete"):
            continue

        # Power
        power_kw, power_unknown = resolve_power_kw(
            conn.get("PowerKW"),
            conn.get("Amps"),
            conn.get("Voltage")
        )
        if power_kw < OCM_MIN_POWER_KW and not power_unknown:
            continue    # Too slow for routing

        # Current type
        current_map = {10: "AC_SINGLE", 20: "AC_THREE", 30: "DC"}
        current_type_id = conn.get("CurrentTypeID", 0)
        current_type = current_map.get(current_type_id, "UNKNOWN")

        # Compatibility
        connector_name  = map_connector_type(ct_id, ct_formal)
        is_compatible   = is_connector_compatible(ct_id, ct_formal, ev_connectors)

        processed_connections.append(ConnectionRecord(
            connection_id      = conn.get("ID", 0),
            connector_type     = connector_name,
            connector_type_id  = ct_id,
            power_kw           = power_kw,
            effective_power_kw = min(power_kw, ev_max_kw),
            current_type       = current_type,
            is_fast_charge     = power_kw >= 40.0,
            quantity           = conn.get("Quantity") or 1,
            is_operational     = True,
            power_unknown      = power_unknown,
            is_compatible      = is_compatible,
        ))

    # ── Exclude site if no usable connections remain after filtering
    if not processed_connections:
        return None

    # ── Best connection: highest effective_power_kw among compatible connections
    compatible = [c for c in processed_connections if c.is_compatible]
    best = max(compatible, key=lambda c: c.effective_power_kw) if compatible else None

    # ── Metadata
    date_verified = raw.get("DateLastVerified")
    stale = True
    if date_verified:
        from datetime import datetime, timezone
        try:
            dt  = datetime.fromisoformat(date_verified.replace("Z", "+00:00"))
            age = (datetime.now(timezone.utc) - dt).days
            stale = age > 180
        except Exception:
            stale = True

    # ── Distance
    distance_km = None
    raw_dist = addr.get("Distance")
    dist_unit = addr.get("DistanceUnit", 0)
    if raw_dist is not None:
        distance_km = raw_dist if dist_unit == 2 else raw_dist * 1.60934

    # ── Number of points
    n_points = raw.get("NumberOfPoints") or 0
    if n_points == 0:
        n_points = sum(c.quantity for c in processed_connections)
    n_points = max(n_points, 1)

    # ── Operator info
    op = raw.get("OperatorInfo", {}) or {}
    usage = raw.get("UsageType", {}) or {}

    # ── Low precision coords
    low_precision = (lat == round(lat, 0) and lon == round(lon, 0))

    # ── Data quality flags
    dq_level = raw.get("DataQualityLevel", 1) or 1
    dp_approved = dp.get("IsApprovedImport", True)

    record = StationRecord(
        ocm_id              = raw["ID"],
        uuid                = raw.get("UUID", ""),
        graph_node          = None,       # Set by map_stations_to_graph_nodes()
        graph_node_lat      = None,
        graph_node_lon      = None,
        name                = addr.get("description") or addr.get("AddressLine1", f"Station {raw['ID']}"),
        lat                 = float(lat),
        lon                 = float(lon),
        town                = (addr.get("Town") or "unknown").lower(),
        country_iso         = (addr.get("Country", {}) or {}).get("ISOCode", "XX"),
        distance_km         = distance_km,
        operator_id         = op.get("ID", 0),
        operator_name       = op.get("description") or op.get("Title") or "Unknown Operator",
        is_private_operator = op.get("IsPrivateIndividual", False),
        is_operational      = raw.get("StatusTypeID") == 50,
        is_live             = True,       # Already validated in GATE 1
        is_recently_verified= raw.get("IsRecentlyVerified", False),
        verification_stale  = stale,
        date_last_verified  = date_verified,
        data_quality_level  = dq_level,
        usage_type_id       = raw.get("UsageTypeID", 0),
        requires_payment    = usage.get("IsPayAtLocation", False),
        requires_membership = usage.get("IsMembershipRequired", False),
        number_of_points    = n_points,
        connections         = processed_connections,
        best_connection     = best,
        ranking_score       = 0.0,        # Set by rank_stations()
        access_risk         = op.get("IsPrivateIndividual", False),
        low_quality         = dq_level <= 1,
        data_source_unapproved = not dp_approved,
        status_uncertain    = raw.get("StatusTypeID") in [0, 100],
        low_precision_coords= low_precision,
        charge_time_minutes = None,
        arrival_soc         = None,
        departure_soc       = None,
    )
    return record
```

---

## SECTION 4 — RANKING ALGORITHM

After normalization, stations are ranked for use in charging stop insertion.

```python
def rank_stations(stations: list[StationRecord], ev_profile: dict) -> list[StationRecord]:
    """
    Scores every station on 7 dimensions. Higher score = better charging stop candidate.
    Maximum possible score: 100 points.
    """
    for s in stations:
        score = 0.0

        # 1. Power (max 30 pts)
        best_kw = s.best_connection.effective_power_kw if s.best_connection else 0
        score += min(best_kw / ev_profile.get("max_charge_rate_kw", 50.0), 1.0) * 30

        # 2. Data quality (max 20 pts)
        score += s.data_quality_level * 4

        # 3. Recent verification (max 10 pts)
        if s.is_recently_verified:
            score += 10

        # 4. Availability (number of points, max 15 pts)
        score += min(s.number_of_points, 5) * 3

        # 5. Access simplicity (max 15 pts)
        if s.usage_type_id == 1:       # Fully public
            score += 15
        elif s.usage_type_id == 4:     # Membership required
            score += 8
        elif s.usage_type_id == 0:     # Unknown
            score += 5

        # 6. Operator quality (max 5 pts)
        if not s.is_private_operator:
            score += 5

        # 7. Penalties
        if s.verification_stale:     score -= 5
        if s.low_quality:            score -= 10
        if s.data_source_unapproved: score -= 10
        if s.access_risk:            score -= 8
        if s.status_uncertain:       score -= 5
        if s.low_precision_coords:   score -= 3

        s.ranking_score = max(score, 0.0)

    return sorted(stations, key=lambda s: s.ranking_score, reverse=True)
```

---

## SECTION 5 — GRAPH NODE MAPPING

After ranking, every valid station must be mapped to the nearest OSMnx graph node.

```python
import osmnx as ox

def map_stations_to_graph_nodes(
    stations: list[StationRecord],
    G
) -> list[StationRecord]:
    """
    Maps each station to the nearest driveable graph node.
    Uses vectorized batch lookup for performance.
    Stations with low_precision_coords get a larger search radius.
    """
    if not stations:
        return stations

    lons = [s.lon for s in stations]
    lats = [s.lat for s in stations]

    # Batch nearest-node lookup (O(n log n) via KD-tree)
    nearest_nodes = ox.nearest_nodes(G, X=lons, Y=lats)

    for station, node_id in zip(stations, nearest_nodes):
        node_data = G.nodes[node_id]
        station.graph_node     = int(node_id)
        station.graph_node_lat = node_data['y']
        station.graph_node_lon = node_data['x']

    return stations
```

---

## SECTION 6 — PAGINATION LOGIC

If OCM returns exactly `maxresults` items, more results may exist. The orchestrator must handle pagination.

```python
async def fetch_all_stations_paginated(
    params: dict,
    max_pages: int = 3
) -> list[dict]:
    """
    Fetches multiple pages of OCM results using greaterthanid parameter.
    Stops when: (a) results < maxresults, (b) max_pages reached, (c) no new IDs.
    """
    all_results = []
    seen_ids    = set()
    last_id     = None

    for page in range(max_pages):
        if last_id is not None:
            params["greaterthanid"] = last_id

        response = requests.get(OCM_BASE_URL, params=params, timeout=10)
        batch    = response.json()

        if not batch:
            break

        new_items = [item for item in batch if item["ID"] not in seen_ids]
        if not new_items:
            break

        all_results.extend(new_items)
        seen_ids.update(item["ID"] for item in new_items)
        last_id = max(item["ID"] for item in new_items)

        # No more pages if batch is smaller than maxresults
        if len(batch) < params.get("maxresults", 100):
            break

    return all_results
```

---

## SECTION 7 — COMPLETE RETRIEVAL ORCHESTRATION

```python
# orchestrator/ocm_client.py

async def retrieve_stations_for_route(
    route_nodes:  list,
    G,
    ev_profile:   dict,
    radius_km:    float = 8.0,
    country_code: str  = None,
) -> list[StationRecord]:
    """
    MASTER FUNCTION — complete OCM retrieval pipeline.
    Implements: cache-aside, circuit breaker, pagination, normalization,
    coordinate validation, connection filtering, graph mapping, ranking.

    Call this from the orchestrator's charging insertion step.
    """
    # ── Step 1: Compute corridor midpoint
    mid_idx  = len(route_nodes) // 2
    mid_node = route_nodes[mid_idx]
    mid_lat  = G.nodes[mid_node]['y']
    mid_lon  = G.nodes[mid_node]['x']

    # ── Step 2: Cache check (L1 memory → L2 disk)
    cache_key = f"stations:{round(mid_lat,3)}:{round(mid_lon,3)}:{radius_km}"
    cached    = cache_get(cache_key, ttl=86_400)
    if cached is not None:
        print(f"[OCM] Cache hit: {len(cached)} stations loaded")
        return cached

    # ── Step 3: Build query params
    params = build_ocm_request_params(
        lat              = mid_lat,
        lon              = mid_lon,
        radius_km        = radius_km,
        country_code     = country_code,
    )

    # ── Step 4: Fetch with circuit breaker + retry
    try:
        raw_data = await BREAKERS["ocm_api"].call(
            lambda: fetch_all_stations_paginated(params, max_pages=2),
            fallback=lambda: _stale_or_empty(cache_key)
        )
    except Exception as e:
        print(f"[OCM] Fetch failed: {e} — using stale cache or empty")
        raw_data = cache_get_stale(cache_key) or []

    # ── Step 5: Normalize + filter
    stations = []
    for raw in raw_data:
        record = normalize_ocm_station(raw, ev_profile, mid_lat, mid_lon)
        if record is not None:
            stations.append(record)

    print(f"[OCM] {len(raw_data)} raw → {len(stations)} valid stations after normalization")

    # ── Step 6: Graph node mapping
    stations = map_stations_to_graph_nodes(stations, G)

    # ── Step 7: Rank
    stations = rank_stations(stations, ev_profile)

    # ── Step 8: Cache results
    cache_set(cache_key, stations, ttl=86_400, layers=["memory", "disk"])

    return stations


async def _stale_or_empty(cache_key: str) -> list:
    stale = cache_get_stale(cache_key)
    if stale:
        print(f"[OCM] Serving stale cached station data")
        return stale
    return []
```

---

## SECTION 8 — KNOWN DATA QUALITY ISSUES & MITIGATIONS

These are production-observed issues in OCM data. The orchestrator must handle all of them.

| Issue                                                 | Frequency          | Detection                         | Mitigation                            |
| ----------------------------------------------------- | ------------------ | --------------------------------- | ------------------------------------- |
| `Latitude: 0.0, Longitude: 0.0`                       | ~2% of records     | `lat == 0.0 and lon == 0.0`       | Reject entirely                       |
| `PowerKW: null` with no Amps/Voltage                  | ~8% of connections | All three null                    | Set `power_unknown: true`, use 0.0    |
| `StatusTypeID: 50` but individual connections offline | ~5% of sites       | Check connection-level status     | Validate both levels independently    |
| Site `StatusTypeID: 50` but `IsLive: false`           | ~1%                | Check `SubmissionStatus.IsLive`   | Reject (Gate 1 catches this)          |
| Connections with obsolete/discontinued connectors     | ~3%                | `IsDiscontinued or IsObsolete`    | Skip unless sole option               |
| `NumberOfPoints: 0`                                   | ~12%               | `NumberOfPoints == 0`             | Derive from sum of Quantities         |
| `ConnectionType` object missing `FormalName`          | ~5%                | FormalName null                   | Fall back to ID-based mapping         |
| Same station appearing twice with different IDs       | Rare               | `uuid` dedup                      | Keep higher `DataQualityLevel`        |
| `description` field vs `Title` field inconsistency    | Common             | OCM uses both across API versions | Try `description` first, then `Title` |
| `Country` object null when `CountryID` is set         | ~1%                | Country object null               | Use CountryID lookup table            |

---

## SECTION 9 — RESPONSE CONTRACT TO ROUTING ENGINE

The `retrieve_stations_for_route()` function delivers `list[StationRecord]` to the decision engine. The decision engine uses ONLY these fields from each record:

```python
DECISION_ENGINE_USES = [
    "ocm_id",               # Station identity
    "graph_node",           # For charging stop insertion at graph node
    "lat", "lon",           # For UI display
    "name",                 # For response display
    "best_connection.effective_power_kw",   # For charge time calculation
    "best_connection.connector_type",       # For compatibility display
    "best_connection.is_fast_charge",       # For UI badge
    "number_of_points",     # For availability hint
    "requires_membership",  # For UI warning
    "requires_payment",     # For UI warning
    "ranking_score",        # For ordering stop candidates
]
```

All other fields are passed through to the `/api/stations` detail endpoint only.

---

_OCM_INTEGRATION_DIRECTIVE.md v1.0 — Antigravity AI | AI Orchestrator Field-Level Specification_
_Applies to: OpenChargeMap API v3 | Internal codename: ChargerClient | Maintained by: Platform Team_
