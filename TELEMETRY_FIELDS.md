# Telemetry fields available in the DuckDB export

Inspected directly from a sample session file (`SHOW TABLES`, `DESCRIBE`, `channelsList`,
`eventsList`, `metadata`). Every channel below is a **table** in the `.duckdb` file, not a
column — see `CLAUDE.md` for the regular-vs-irregular time model. This doc is just a map of
what's available so we can decide what's worth building next; it doesn't change the
allow-list itself (`$RegularChannels`/`$IrregularChannels` in `server.ps1`).

## Currently wired up in the UI

| Channel | Kind | Freq | Unit | Where it's used |
|---|---|---|---|---|
| `Ground Speed` | regular | 100Hz | km/h | Speed chart |
| `Throttle Pos` | regular | 50Hz | % | Throttle chart |
| `Brake Pos` | regular | 50Hz | % | Brake chart |
| `Steering Pos` | regular | 100Hz | % | Steering chart |
| `GPS Latitude`/`GPS Longitude` | regular | 10Hz | deg | Track map |
| `G Force Lat`/`G Force Long` | regular | 10Hz | G | Grip circle |
| `Gear` | irregular | — | — | Gear chart |
| `Lap` | irregular | — | — | Lap boundaries |
| `Lap Time` | irregular | — | s | Session picker fastest-lap, lap dropdown durations |
| `GPS Time` | regular | 100Hz | s | `t0` anchor for rowid→time conversion |

Metadata keys (`metadata` table, `key`/`value` rows) already shown in the header bar:
`TrackName`, `CarName`, `SessionType`, `DriverName`, `WeatherConditions`. Also present but
unused: `Version`, `SteamID`, `RecordingTime`, `SessionTime`, `TrackLayout`, `CarClass`,
`CarSetup` (this last one is excluded from the metadata query already — it's presumably a
large blob of the car's setup sheet).

## Regular channels (fixed-frequency, single `value` column) — not yet used

| Channel | Freq | Unit | Notes / possible use |
|---|---|---|---|
| `Ambient Temperature` | 1Hz | °C | Session conditions readout |
| `Track Temperature` | 1Hz | °C | Session conditions readout |
| `Wind Speed` / `Wind Heading` | 1Hz | m/s / deg | Session conditions readout |
| `Engine RPM` | 100Hz | RPM | Rev-band/shift-point chart, alongside Gear |
| `Engine Oil Temp` / `Engine Water Temp` | 7Hz | °C | Endurance-stint temperature trend |
| `Clutch Pos` / `Clutch Pos Unfiltered` | 50Hz | % | Clutch input chart (launch/downshift analysis) |
| `Clutch RPM` | 100Hz | RPM | Paired with Engine RPM for clutch slip |
| `Brake Pos Unfiltered` / `Throttle Pos Unfiltered` | 50Hz | % | Raw vs. filtered input comparison |
| `Brakes Force` | 50Hz | % | Actual brake force applied (vs. pedal `Brake Pos`) |
| `Brakes Temp` / `Brakes Air Temp` | 50Hz | °C | Brake temp chart — cold/overheating brakes are a real setup concern |
| `Brake Thickness` | 10Hz | % | Pad/disc wear over a long stint |
| `Steering Pos Unfiltered` | 100Hz | % | Raw vs. filtered steering comparison |
| `Steering Shaft Torque` | 100Hz | Nm | Force-feedback / steering load trace |
| `FFB Output` | 100Hz | % | Force-feedback output level |
| `Turbo Boost Pressure` | 100Hz | Pa | Turbo cars only — boost trace |
| `Fuel Level` | 20Hz | L | Fuel-consumption-per-lap analysis, stint planning |
| `Virtual Energy` | 20Hz | % | Hybrid/energy-limited class equivalent of fuel |
| `SoC` | 20Hz | % | Battery state of charge (hybrid cars) |
| `Regen Rate` | 100Hz | kW | Hybrid energy recovery trace |
| `GPS Speed` | 10Hz | m/s | Redundant with `Ground Speed`, different source/units |
| `Lap Dist` | 10Hz | m | Distance-based x-axis instead of time — listed as a "future idea" already |
| `Total Dist` | 10Hz | m | Cumulative session distance (odometer) |
| `Path Lateral` | 10Hz | m | Position across track width — could shade the map by racing line offset |
| `Track Edge` | 10Hz | m | Distance to track edge — off-track/track-limits detection |
| `G Force Vert` | 10Hz | G | Third axis for grip circle, or a vertical-load proxy over kerbs |
| `Susp Pos` | 100Hz | m | Per-wheel (`value1..value4`) — suspension travel, see below |
| `RideHeights` | 100Hz | m | Per-wheel ride height |
| `FrontRideHeight` / `RearRideHeight` | 100Hz | m | Axle-level ride height (simpler than per-wheel) |
| `Front3rdDeflection` / `Rear3rdDeflection` | 100Hz | m | 3rd-element/heave damper travel |
| `Wheel Speed` | 100Hz | m/s | Per-wheel (`value1..value4`) — compare to `Ground Speed` for wheel slip/lockup detection |
| `Tyres Wear` | 10Hz | % | Per-wheel (`value1..value4`) tyre wear over a run |
| `TyresPressure` | 10Hz | kPa | Per-wheel tyre pressure |
| `TyresCarcassTemp` / `TyresRimTemp` / `TyresRubberTemp` | 5-50Hz | °C | Per-wheel tyre temps (bulk/rim/surface-rubber) |
| `TyresTempCentre` / `TyresTempLeft` / `TyresTempRight` | 100Hz | °C | Per-wheel, temp across the tyre's tread width — classic "tyre temp bar" display |
| `SurfaceTypes` | 5Hz | — | Per-wheel, likely an enum (tarmac/kerb/grass/gravel) — could flag kerb usage on the map |
| `OverheatingState` | 2Hz | — | Enum flag, probably ties to brake/tyre overheating |
| `TC` | 100Hz | — | Traction control activation |
| `Time Behind Next` | 2Hz | s | Only meaningful in a race with other cars on track |

## Irregular (event, `ts`+`value`) channels — not yet used

| Channel | Notes / possible use |
|---|---|
| `ABS` / `ABSLevel` | ABS activation flag + intervention level — brake trace overlay |
| `TC` / `TCCut` / `TCLevel` / `TCSlipAngle` | Traction control activation + level + slip angle that triggered it |
| `Brake Bias Rear` | Current brake bias setting (changes mid-session on some cars) |
| `Brake Migration` | Automatic bias migration some cars have |
| `Current Sector` / `Current Sector1` / `Current Sector2` | Live sector timing |
| `Last Sector1` / `Last Sector2` | Previous lap's sector times |
| `Best Sector1` / `Best Sector2` | Session-best sector times |
| `Best LapTime` / `Current LapTime` | Redundant with `Lap Time` but recorded differently — worth comparing before using |
| `Sector1 Flag` / `Sector2 Flag` / `Sector3 Flag` | Sector flag state (yellow/green/etc per sector) |
| `Yellow Flag State` | Track-wide flag state |
| `In Pits` | Pit lane flag — could grey out laps/exclude from "fastest lap" the way out-laps already are, or mark pit stops on the map |
| `Finish Status` | Race finish state (DNF/finished/etc.) |
| `LastImpactMagnitude` | Crash/contact severity — could flag laps with an impact |
| `WheelsDetached` | Per-wheel (`value1..value4`) flag — wheel came off |
| `AntiStall Activated` / `LaunchControlActive` / `Speed Limiter` | Driver-aid activation flags, useful for a "start/pit-lane" analysis |
| `FrontFlapActivated` / `RearFlapActivated` / `RearFlapLegalStatus` | DRS-equivalent flap state (LMDh/Hypercar aero) |
| `FuelMixtureMap` | Which fuel map the driver had selected |
| `Engine Max RPM` | Rev limiter setting (mostly constant per car) |
| `Headlights State` | Cosmetic, low value |
| `CloudDarkness` / `Minimum Path Wetness` / `OffpathWetness` | Weather/track wetness — relevant for wet-session analysis |
| `TyresCompound` | Per-wheel (`value1..value4`) compound index — which tyre compound is fitted |

## Per-wheel channels

These tables have **`value1`..`value4`** columns instead of a single `value` (still one row
per sample/event — `ts` only present if the channel is also irregular, e.g. `TyresCompound`).
Wheel index convention (1/2/3/4 = FL/FR/RL/RR) matches the typical sim-racing layout but
**hasn't been independently verified against another channel** — confirm with a
known-asymmetric scenario (e.g. braking into a long right-hander should show more load on
the left wheels) before labeling a UI with FL/FR/RL/RR:

- `Susp Pos`, `RideHeights`, `Wheel Speed`, `Tyres Wear`, `TyresPressure`,
  `TyresCarcassTemp`, `TyresRimTemp`, `TyresRubberTemp`, `TyresTempCentre`, `TyresTempLeft`,
  `TyresTempRight`, `SurfaceTypes`, `WheelsDetached`, `TyresCompound`

This answers the open question in `CLAUDE.md`'s "Future ideas" section — the per-wheel
schema is now known, so a tyre-temp/pressure/wear dashboard is buildable without further
`DESCRIBE` spelunking. Still no direct **tyre load** channel; `Susp Pos` remains the closest
indirect proxy.

## Feature ideas ranked by how much new data plumbing they need

**Cheap — data already flowing through `/api/channel`-style queries, just new charts:**
- Engine RPM / gear-shift chart (rev band vs. gear, shows over/under-revving)
- Brake temps chart (`Brakes Temp`, `Brakes Air Temp`)
- Tyre pressure/temp per-wheel dashboard (bar chart or 4-corner car diagram)
- Fuel/energy-per-lap trend (`Fuel Level` or `Virtual Energy`, sampled at each lap boundary)
- Track/ambient temperature + weather readout in the session header

**Medium — need small server-side additions (new allow-listed channels, maybe a new small
endpoint), no new data model concepts:**
- Sector time table (current/last/best × 3 sectors) — already on the "Future ideas" list
- Distance-based x-axis toggle using `Lap Dist` — already on the list
- Lap-over-lap overlay/comparison (multiple laps' Speed/Throttle/Brake on one chart) —
  already on the list, becomes much more useful once combined with distance-based x-axis so
  laps of different pace line up correctly
- "Off track" shading on the map using `Track Edge` / `Path Lateral`
- Driver-aid activity markers (ABS/TC intervention, pit lane) overlaid on the time charts

**More involved — need per-wheel or multi-series handling not currently in the frontend:**
- 4-corner suspension/ride-height/tyre-temp visualization (needs a small new chart type,
  not just another line on the existing time-series charts)
- Kerb-usage detection via `SurfaceTypes` per wheel, shown on the track map
