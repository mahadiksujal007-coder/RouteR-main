"""
Antigravity AI — Configuration Loader
Loads environment variables with defaults for all system parameters.
"""

import os
from dotenv import load_dotenv

load_dotenv()


# ── Core Region
REGION = os.getenv("REGION", "Nashik, Maharashtra, India")
VEHICLE_CLASS_DEFAULT = os.getenv("VEHICLE_CLASS_DEFAULT", "default_bev")

# ── Cache
GRAPH_CACHE_DIR = os.getenv("GRAPH_CACHE_DIR", "cache/graphs/")
STATION_CACHE_DIR = os.getenv("STATION_CACHE_DIR", "cache/stations/")
STATION_CACHE_TTL = int(os.getenv("STATION_CACHE_TTL_SECONDS", "86400"))
MEMORY_CACHE_MAX_KEYS = int(os.getenv("MEMORY_CACHE_MAX_KEYS", "512"))

# ── External API Keys
GPXZ_API_KEY = os.getenv("GPXZ_API_KEY", "")
OCM_API_KEY = os.getenv("OCM_API_KEY", "")
API_NINJAS_KEY = os.getenv("API_NINJAS_KEY", "")

# ── Circuit Breakers
CB_OCM_FAIL_MAX = int(os.getenv("CB_OCM_FAIL_MAX", "3"))
CB_OCM_RESET_TIMEOUT_S = float(os.getenv("CB_OCM_RESET_TIMEOUT_S", "60"))
CB_ELEVATION_FAIL_MAX = int(os.getenv("CB_ELEVATION_FAIL_MAX", "2"))
CB_ELEVATION_RESET_TIMEOUT_S = float(os.getenv("CB_ELEVATION_RESET_TIMEOUT_S", "120"))

# ── Timeouts
TIMEOUT_ROUTING_S = float(os.getenv("TIMEOUT_ROUTING_S", "2.0"))
TIMEOUT_STATIONS_S = float(os.getenv("TIMEOUT_STATIONS_S", "8.0"))
TIMEOUT_TOTAL_REQUEST_S = float(os.getenv("TIMEOUT_TOTAL_REQUEST_S", "10.0"))

# ── Bulkheads
BULKHEAD_ROUTING_MAX = int(os.getenv("BULKHEAD_ROUTING_MAX", "20"))
BULKHEAD_OCM_MAX = int(os.getenv("BULKHEAD_OCM_MAX", "5"))
BULKHEAD_ELEVATION_MAX = int(os.getenv("BULKHEAD_ELEVATION_MAX", "2"))

# ── Charging Logic
SOC_MIN_RESERVE = float(os.getenv("SOC_MIN_RESERVE", "0.10"))
SOC_CHARGE_TARGET = float(os.getenv("SOC_CHARGE_TARGET", "0.80"))
SOC_TRIGGER_CHARGE = float(os.getenv("SOC_TRIGGER_CHARGE", "0.20"))
OCM_MIN_POWER_KW = float(os.getenv("OCM_MIN_POWER_KW", "7.0"))
CORRIDOR_RADIUS_KM = float(os.getenv("CORRIDOR_RADIUS_KM", "8.0"))

# ── Server
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8000"))
LOG_LEVEL = os.getenv("LOG_LEVEL", "info")

# ── RouteE Model Map
ROUTEE_MODEL_MAP = {
    "bolt_bev":    "2017_CHEVROLET_Bolt",
    "leaf_bev":    "2016_NISSAN_Leaf",
    "default_bev": "2017_CHEVROLET_Bolt",
}
