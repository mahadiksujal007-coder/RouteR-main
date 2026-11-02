"""
Antigravity AI — Battery Module (F-004)
Battery state modeling: SOC, SOH, usable energy, and SOC trace simulation.
"""

from dataclasses import dataclass, field
from typing import Optional
from config import SOC_MIN_RESERVE


@dataclass
class BatteryState:
    """
    Models the current battery state for an EV.

    Usable energy formula:
        usable = capacity × SOH × (SOC - reserve)
        where reserve = soc_min_reserve (default 10%)

    Example: 40 kWh battery, SOC 80%, SOH 95%, 10% reserve
        effective = 40 × 0.95 = 38 kWh
        available = 38 × 0.80 = 30.4 kWh
        reserve   = 38 × 0.10 =  3.8 kWh
        usable    = 30.4 − 3.8 = 26.6 kWh
    """
    capacity_kwh: float
    soc: float               # 0.0 – 1.0
    soh: float = 1.0         # 0.0 – 1.0 (1.0 = new battery)
    soc_reserve: float = field(default=SOC_MIN_RESERVE)

    @property
    def effective_capacity(self) -> float:
        """Actual capacity accounting for degradation."""
        return self.capacity_kwh * self.soh

    @property
    def usable_energy(self) -> float:
        """Energy available for the trip (kWh), accounting for SOH + reserve."""
        available = self.effective_capacity * self.soc
        reserve = self.effective_capacity * self.soc_reserve
        return max(available - reserve, 0.0)

    def is_feasible(self, route_energy_kwh: float) -> bool:
        """Check if battery can complete a route with given energy requirement."""
        return route_energy_kwh <= self.usable_energy

    def deficit_kwh(self, route_energy_kwh: float) -> float:
        """How much energy is the battery short by?"""
        return max(route_energy_kwh - self.usable_energy, 0.0)

    def arrival_soc(self, route_energy_kwh: float) -> float:
        """Estimated SOC at destination after consuming route_energy_kwh."""
        soc_consumed = route_energy_kwh / self.effective_capacity if self.effective_capacity > 0 else 1.0
        return max(self.soc - soc_consumed, 0.0)

    def to_dict(self) -> dict:
        return {
            "capacity_kwh": self.capacity_kwh,
            "soc": round(self.soc, 4),
            "soh": round(self.soh, 4),
            "soc_reserve": self.soc_reserve,
            "effective_capacity_kwh": round(self.effective_capacity, 2),
            "usable_energy_kwh": round(self.usable_energy, 2),
        }


def simulate_soc_trace(
    route_nodes: list,
    G,
    battery: BatteryState,
) -> tuple[list[dict], bool]:
    """
    Simulate SOC depletion along a route, node-by-node.

    Returns:
        (soc_trace, ran_out)
        soc_trace: list of {node, soc, cumulative_kwh}
        ran_out: True if SOC reached reserve before destination
    """
    eff_cap = battery.effective_capacity
    if eff_cap <= 0:
        return [], True

    current_soc = battery.soc
    cumulative_kwh = 0.0
    soc_trace = [{
        "node": int(route_nodes[0]),
        "soc": round(current_soc, 4),
        "cumulative_kwh": 0.0,
    }]

    ran_out = False

    for i in range(len(route_nodes) - 1):
        u = route_nodes[i]
        v = route_nodes[i + 1]

        # Get minimum energy edge (parallel edge resolution)
        try:
            edge_data = min(G[u][v].values(), key=lambda d: d.get("energy_kwh", float("inf")))
        except (KeyError, ValueError):
            edge_data = {"energy_kwh": 0}

        edge_energy = float(edge_data.get("energy_kwh", 0))
        cumulative_kwh += edge_energy
        current_soc = battery.soc - (cumulative_kwh / eff_cap)
        current_soc = max(min(current_soc, 1.0), 0.0)  # Clamp

        soc_trace.append({
            "node": int(v),
            "soc": round(current_soc, 4),
            "cumulative_kwh": round(cumulative_kwh, 4),
        })

        if current_soc <= battery.soc_reserve:
            ran_out = True
            break

    return soc_trace, ran_out


def estimate_charge_time(
    battery: BatteryState,
    station_power_kw: float,
    soc_from: float,
    soc_to: float,
    max_charge_rate_kw: float = 50.0,
) -> float:
    """
    Estimate charging time in minutes.

    charge_time = (energy_needed / effective_charge_rate) × 60
    where effective_rate = min(station_power, vehicle_max_charge_rate)
    """
    energy_needed = battery.effective_capacity * (soc_to - soc_from)
    effective_rate = min(station_power_kw, max_charge_rate_kw)

    if effective_rate <= 0:
        return 0.0

    charge_hours = energy_needed / effective_rate
    return round(charge_hours * 60, 1)
