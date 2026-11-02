"""
Antigravity AI — Graceful Degradation
Constructs partial responses when services fail — never returns 500.
"""


def build_degraded_response(failure_context: dict) -> dict:
    """
    Build the best possible partial response when services degrade.
    Never returns a 500 — always returns 200 with degradation metadata.
    """
    response = {
        "feasible": False,
        "degraded": True,
        "degradations": [],
        "error": failure_context.get("error"),
    }

    if failure_context.get("station_data_unavailable"):
        response["degradations"].append({
            "service": "charger_client",
            "message": "Charging station data temporarily unavailable. Route shown without stops.",
            "severity": "warning",
        })

    if failure_context.get("grade_data_unavailable"):
        response["degradations"].append({
            "service": "elevation",
            "message": "Road grade data unavailable. Energy predictions assume flat terrain.",
            "severity": "info",
        })

    if failure_context.get("route_computed") and not failure_context.get("stations_needed"):
        response["feasible"] = True
        response["degraded"] = len(response["degradations"]) > 0

    return response
