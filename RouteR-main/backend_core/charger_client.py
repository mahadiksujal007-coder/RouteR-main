"""
Antigravity AI — Charger Client Connector
DEPRECATED: Direct API Ninjas & OSMnx lookups are replaced by the deterministic OCM orchestrator.
This file now proxies requests to the `orchestrator.ocm_client` to maintain backward compatibility
with any older imports, while adopting the new StationRecord schemas.
"""

from orchestrator.ocm_client import retrieve_stations_for_route, StationRecord

async def fetch_stations_along_corridor(
    route_nodes: list[int],
    G,
    radius_km: float = 8.0,
    ev_profile: dict = None,
) -> list[StationRecord]:
    """
    Proxies to the new strict OCM orchestrator pipeline.
    """
    if ev_profile is None:
        # Default mock profile if not provided by legacy callers
        ev_profile = {
            "connector_types": ["CCS2", "Type2", "CHAdeMO", "Type1_J1772"],
            "max_charge_rate_kw": 150.0
        }
        
    return await retrieve_stations_for_route(
        route_nodes=route_nodes,
        G=G,
        ev_profile=ev_profile,
        radius_km=radius_km,
        country_code="IN"
    )

def fetch_charging_stations(*args, **kwargs):
    """
    DEPRECATED.
    The new orchestrator operates on corridors (route_nodes) rather than single points,
    as defined by the OCM Integration Directive.
    """
    raise NotImplementedError(
        "fetch_charging_stations is deprecated. "
        "Use orchestrator.ocm_client.retrieve_stations_for_route instead."
    )
