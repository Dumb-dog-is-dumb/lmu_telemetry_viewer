# Future ideas (not commitments — data exists, UI doesn't)

- Tyre channels exist (`TyresPressure`, `TyresCarcassTemp`, `TyresRimTemp`,
  `TyresRubberTemp`, `TyresTempCentre/Left/Right`, `Tyres Wear`) but their per-wheel schema
  hasn't been inspected — `DESCRIBE` them before building any UI.
- Brake temps (`Brakes Temp`, `Brakes Air Temp`) and `Brake Bias Rear` are available, unused.
- Lap-over-lap comparison/overlay — API already returns per-lap start/end ts, mostly
  frontend work.
- Sector times (`Current/Last/Best Sector1/2` tables exist) — not surfaced in UI yet.
- Distance-based x-axis alternative to time (`"Lap Dist"` channel, 10Hz) — useful for
  comparing corners across laps of different pace.
