"""
Antigravity AI — Cache Manager
Three-layer caching: L1 (memory LRU) + L2 (disk JSON) with unified interface.
"""

import os
import json
import time
import hashlib
from collections import OrderedDict
from typing import Any, Optional
from config import MEMORY_CACHE_MAX_KEYS, STATION_CACHE_DIR


class MemoryCache:
    """
    LRU in-process memory cache.
    Used for: enriched graph, route results, SOC traces.
    Thread-safe via GIL for read-heavy workloads.
    """
    def __init__(self, max_size: int = 256):
        self._store: OrderedDict = OrderedDict()
        self._max = max_size

    def get(self, key: str) -> Optional[tuple]:
        """Returns (value, age_seconds) or None on miss."""
        if key not in self._store:
            return None
        value, stored_at, ttl = self._store[key]
        age = time.time() - stored_at
        if ttl and age > ttl:
            del self._store[key]
            return None
        self._store.move_to_end(key)
        return value, age

    def set(self, key: str, value: Any, ttl: Optional[int] = None):
        if key in self._store:
            self._store.move_to_end(key)
        self._store[key] = (value, time.time(), ttl)
        if len(self._store) > self._max:
            self._store.popitem(last=False)

    def invalidate(self, prefix: str):
        """Invalidate all keys matching a prefix."""
        keys = [k for k in self._store if k.startswith(prefix)]
        for k in keys:
            del self._store[k]


class DiskCache:
    """
    JSON file-based disk cache.
    Used for: OpenChargeMap station data (large, 24h TTL).
    """
    def __init__(self, cache_dir: str = "cache/"):
        os.makedirs(cache_dir, exist_ok=True)
        self._dir = cache_dir

    def _path(self, key: str) -> str:
        safe = hashlib.md5(key.encode()).hexdigest()
        return os.path.join(self._dir, f"{safe}.json")

    def get(self, key: str, ttl: int = 86_400) -> Optional[Any]:
        path = self._path(key)
        if not os.path.exists(path):
            return None
        age = time.time() - os.path.getmtime(path)
        if age > ttl:
            return None
        with open(path) as f:
            return json.load(f)

    def set(self, key: str, value: Any):
        with open(self._path(key), "w") as f:
            json.dump(value, f)

    def get_stale(self, key: str) -> Optional[Any]:
        """Return data even if expired — fallback when API is down."""
        path = self._path(key)
        if not os.path.exists(path):
            return None
        with open(path) as f:
            return json.load(f)


# ── Singleton instances
_L1 = MemoryCache(max_size=MEMORY_CACHE_MAX_KEYS)
_L2 = DiskCache(cache_dir="cache/")


def cache_get(key: str, ttl: Optional[int] = None) -> Optional[Any]:
    """
    Unified two-layer read:
    1. Check L1 memory
    2. Check L2 disk (promote to L1 on hit)
    """
    result = _L1.get(key)
    if result:
        value, _ = result
        return value

    value = _L2.get(key, ttl=ttl or 86_400)
    if value is not None:
        _L1.set(key, value, ttl=ttl)
        return value
    return None


def cache_set(key: str, value: Any, ttl: Optional[int] = None, layers: list = None):
    """Write to specified cache layers."""
    if layers is None:
        layers = ["memory"]
    if "memory" in layers:
        _L1.set(key, value, ttl=ttl)
    if "disk" in layers:
        _L2.set(key, value)


def cache_get_stale(key: str) -> Optional[Any]:
    """Get stale disk cache — used only in fallback scenarios."""
    return _L2.get_stale(key)
