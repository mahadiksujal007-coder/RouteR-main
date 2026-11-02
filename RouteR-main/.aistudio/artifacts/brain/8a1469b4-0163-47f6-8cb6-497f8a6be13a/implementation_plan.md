# Implementation Plan: EV Route Thrashing Mitigation & Corridor Storyline

## 1. Problem Diagnosis & Storyline (Root Cause Analysis)

### The Observed Problem (User Screenshot Analysis)
In the provided map screenshot (`/public/assets/aistudio/image_90f61b36.png`), a vehicle traveling from Sangli towards Pune/Satara stops at **6 charging stations (#1, #2, #3, #4, #5, #6)** all within a ~8 km radius inside Sangli and Budhgaon before exiting towards the highway. 

### Why Did This Happen?
1. **Immediate Step Evaluation Without Forward Driving**: After selecting station #1, the simulation evaluated the next hop from station #1's coordinates immediately, rather than driving forward along the corridor until the battery was actually depleted.
2. **Greedy Proximity Bias in Candidate Scoring**:
   - Stations 2 km away incur almost zero detour overhead `((2 + 239) - 240 = 1 km)`.
   - Stations 2 km away arrive with very high battery SOC (`reserveHealth` is maximum).
   - High power ratings (120kW–150kW) give these micro-hops top scores.
   - As a result, micro-stops in the same urban neighborhood outscored stations located 50–80 km ahead along the actual corridor.
3. **Lack of Cluster Suppression & Minimum Leg Distance**:
   - There was no spatial cluster suppression (e.g. "do not stop again within 40 km of a previous stop unless stranded").
   - There was no forward corridor projection: once charged, an EV can drive 120–200 km before needing another plug.

---

## 2. Solution Architecture

### A. Valhalla-Style Forward Projection & Anti-Thrashing Algorithm (`server.ts`)
1. **Consolidated High-Power Replenishment**:
   - When a stop is required (e.g., initial low battery feeder or corridor midpoint), charge the vehicle to the optimal practical fast-charge limit (75%–85% SOC or sufficient to reach destination + safety buffer).
2. **Forward Driving Simulation Along Highway Corridor**:
   - From the current station, project vehicle movement **forward along the direct route corridor** toward the destination.
   - Continue driving until the projected SOC reaches `minReserve + buffer` (the "critical replenishment window", typically after 100–180 km of driving).
   - Only when reaching this critical window do we query candidate charging stations ahead on the corridor.
3. **Spatial Cluster Suppression & Minimum Leg Buffer**:
   - Enforce a strict minimum inter-station driving threshold: **`MIN_LEG_DISTANCE_KM = 40 km`** and **`MIN_LEG_ENERGY_DELTA = 25% SOC`**.
   - Stations located within 25 km of an already-scheduled stop or backward along the path are strictly suppressed.
4. **Feeder Stop Logic for Low Initial Battery**:
   - If starting at 10%–20% SOC, route to **exactly one** high-speed feeder station in the city, charge to 80%, and immediately exit onto the highway corridor, completely eliminating hops #2 through #6.

### B. Interactive Storyline & Route Diagnosis Modal/Drawer (`src/App.tsx`)
1. **"Route Diagnosis & Storyline" Feature**:
   - A dedicated diagnostic panel explaining the 6-station thrashing bug with the exact storyline:
     - *Chapter 1: The Greedy Hop Trap* (Micro-stops around Budhgaon/Sangli).
     - *Chapter 2: The Mitigation Engine* (Forward-projection corridor simulation + cluster suppression).
     - *Chapter 3: The Optimized Route* (1 consolidated stop, saving 110 minutes of unnecessary detour and hookup time).
2. **Before vs. After Interactive Comparison**:
   - Toggle to inspect the "Unmitigated Greedy Route" (6 hops) vs. "Consolidated Corridor Route" (1–2 hops).
   - Visual metrics diff: Total travel time, number of charging detours, average leg distance, and battery health impact.
3. **Scenario Preset**:
   - Add a 1-click test button: `"Sangli Low-SOC Corridor (Anti-Thrashing Benchmark)"` to immediately demonstrate the resolved routing behavior.

---

## 3. Implementation Steps

1. **Backend Routing Overhaul (`server.ts`)**:
   - Refactor `/api/route` simulation loop to use **forward corridor projection**:
     - Advance simulated position along the route polyline until battery SOC drops into the replenishment threshold `(minReserve + arrivalBufferSoc)`.
     - Filter candidate stations with a spatial cluster blackout (minimum 40 km leg distance from previous stop).
     - Ensure single consolidated stop replenishment to 80% (or required to finish).
   - Add diagnostic metadata to `/api/route` response (`mitigation_applied: true`, `hops_suppressed_count: 5`, `detour_saved_km: 28.4`, `time_saved_min: 112`).
2. **Frontend Diagnostic & Storyline Component (`src/components/StorylineModal.tsx` & `src/App.tsx`)**:
   - Build a clean, high-fidelity Storyline & Route Diagnosis drawer/modal matching Tailwind styling.
   - Add Before vs After comparison view and interactive map layer toggle.
   - Connect the benchmark scenario preset to verify Sangli corridor instantly.
3. **Verification**:
   - Run automated curl tests on Sangli → Pune corridor with 14% SOC and 40% SOC.
   - Verify stops drop from 6 redundant stops to 1 optimal stop.
   - Run `compile_applet` and verify zero build/lint errors.
