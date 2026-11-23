Add the supplied soundtrack file as `videoplayback.m4a` in this directory. The player reads it from `/audio/videoplayback.m4a`. Keep the filename stable or update `TRACK_SOURCE` in `src/components/PortfolioMusicPlayer.tsx`.

The player intentionally does not autoplay; a visitor must press Play. The audio is loaded lazily to avoid downloading the full track until someone starts listening.