"""
Antigravity AI — Orchestrator State Machine
Request lifecycle states for the route pipeline.
"""

from enum import Enum


class OrchestratorState(Enum):
    IDLE = "idle"
    PREFETCHING = "prefetching"
    ROUTING = "routing"
    STATS_COMPUTING = "stats_computing"
    FEASIBILITY_CHECK = "feasibility_check"
    SOC_TRACING = "soc_tracing"
    CHARGING_INSERTION = "charging_insertion"
    SEGMENTED_SOC_TRACING = "segmented_soc_tracing"
    RESPONDING = "responding"
    DEGRADED = "degraded"
    ERROR = "error"
