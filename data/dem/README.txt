ldem-8ppd.png

Moon elevation for the profile plot, the status bar elevation, the relief shading and the elevation overlay.

Source: LOLA LDEM_16 (PDS product LRO-L-LOLA-4-GDR-V1.0, version V3.1, 5760 x 2880, 1895 m/pixel), Lunar Orbiter Laser Altimeter
team, NASA Goddard Space Flight Center / Lunar Reconnaissance Orbiter. NASA data are not copyrighted. Credit line:
"Elevation: LOLA, NASA / GSFC / LRO."

This copy: averaged 2 x 2 to 8 pixels per degree (about 3.8 km at the equator), 2880 x 1440, columns longitude -180 to 180 east,
rows latitude +90 to -90. Height above the 1737.4 km reference sphere, 10 m steps, stored as
(round(h / 10) + 1000) with the high byte in red and the low byte in green (blue is 255). Decode: h = ((R * 256 + G) - 1000) * 10 metres.

Made with project/tools/make_dem_png.py. It is coarse: features smaller than about 8 km are smoothed away and a profile across a
small crater will not show its rim.
