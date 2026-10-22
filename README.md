# Observer's Moon Atlas (OMA)

A free, open-source, web-based Moon atlas in the spirit of Virtual Moon Atlas. An interactive lunar globe
lit by the real Sun for any date and time, with libration, phase and terminator, a searchable list of named
features, an ephemeris tab, notes, distance measuring, and telescope, camera and eyepiece field frames.

**Open it:** `index.html` (https://thg4web.github.io/oma/index.html once GitHub Pages is on).
**Run locally:** `python3 -m http.server 8080` from this folder, then open http://localhost:8080/.

**Status:** early development. Not every Virtual Moon Atlas function is built yet. Lighting is a Sun on a
sphere, so crater walls do not cast shadows.

**Credits**
- Imagery: LRO WAC mosaic, LROC / ASU / NASA (public data). Tiles prepared from the texture slices distributed
  with Virtual Moon Atlas, with thanks to Christian Legrand and Patrick Chevalley (https://www.ap-i.net).
- Feature names, positions, sizes and name origins: IAU / USGS Gazetteer of Planetary Nomenclature.
- Geology overlay: USGS Unified Geologic Map of the Moon, Fortezzo, Spudis and Harrel (2020), CC0.
- Ephemeris: astronomy-engine by Don Cross (MIT, in `vendor/`). Selenographic Sun and libration after Meeus,
  Astronomical Algorithms, ch. 53.

**License:** GPL-3.0-or-later, see `LICENSE` and `NOTICE`.
