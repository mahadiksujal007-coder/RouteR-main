"""
Antigravity AI — Pydantic Models
Request/response schemas for the FastAPI REST API.
"""

from pydantic import BaseModel, Field
from typing import Optional


class LatLon(BaseModel):
    lat: float = Field(..., description="Latitude (WGS84)")
    lon: float = Field(..., description="Longitude (WGS84)")


class EVProfile(BaseModel):
    battery_capacity_kwh: float = Field(40.0, gt=0, description="Rated battery capacity in kWh")
    soc_current: float = Field(0.80, ge=0, le=1, description="Current state of charge (0–1)")
    soh: float = Field(1.0, ge=0, le=1, description="State of health (0–1)")
    soc_min_reserve: float = Field(0.10, ge=0, le=0.5, description="Minimum SOC reserve")
    mass_kg: float = Field(1800, gt=0, description="Vehicle mass in kg")
    efficiency_kwh_km: float = Field(0.18, gt=0, description="Base consumption kWh/km")
    regen_efficiency: float = Field(0.70, ge=0, le=1, description="Regen braking efficiency")
    max_charge_rate_kw: float = Field(50.0, gt=0, description="Max onboard charger rate kW")
    connector_types: list[str] = Field(default=["CCS2"], description="Supported connector types")
    vehicle_class: Optional[str] = Field("default_bev", description="RouteE model key")


class RouteRequest(BaseModel):
    origin: LatLon
    destination: LatLon
    ev_profile: EVProfile = Field(default_factory=EVProfile)


class StationsRequest(BaseModel):
    lat: float
    lon: float
    radius_km: float = Field(10.0, gt=0, le=50)
