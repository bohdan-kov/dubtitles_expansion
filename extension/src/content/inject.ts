/**
 * Runs in the PAGE's MAIN world (declared with "world": "MAIN" in the manifest)
 * on Video.js-based sites that fetch their subtitle track lazily — i.e. only
 * once the user enables CC.
 *
 * We can't reach the Video.js player from a normal (isolated-world) content
 * script: `videoEl.player` and `window.videojs` are main-world globals/expandos.
 * So this script lives in the main world and forces the captions/subtitles text
 * track into `hidden` mode. That makes the platform request its `.vtt`
 * (intercepted by the service worker) WITHOUT rendering the original-language
 * text — our Ukrainian overlay is the only thing shown.
 *
 * Generic for any Video.js site; the manifest limits where it runs.
 */

/** Minimal slice of the Video.js API we rely on — the real types aren't loaded. */
interface VideoJsPlayer {
  textTracks(): ArrayLike<TextTrack>;
}

interface VideoJsGlobal {
  (el: HTMLVideoElement): VideoJsPlayer;
  getPlayer?: (el: HTMLVideoElement) => VideoJsPlayer;
}

declare global {
  interface Window {
    videojs?: VideoJsGlobal;
  }
  interface HTMLVideoElement {
    /** Video.js stores the player instance on the element. */
    player?: VideoJsPlayer;
  }
}

function findPlayer(): VideoJsPlayer | null {
  const videoEl = document.querySelector('video');
  if (!videoEl) return null;
  if (videoEl.player) return videoEl.player;
  try {
    const vjs = window.videojs;
    if (vjs) return vjs.getPlayer ? vjs.getPlayer(videoEl) : vjs(videoEl);
  } catch {
    /* player not initialised yet */
  }
  return null;
}

function enableHiddenCaptions(player: VideoJsPlayer): void {
  let tracks: ArrayLike<TextTrack>;
  try {
    tracks = player.textTracks();
  } catch {
    return;
  }
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const isCaption = track.kind === 'captions' || track.kind === 'subtitles';
    // Only flip tracks that are off ('disabled'); leave 'showing'/'hidden' as-is
    // so we never fight the user or re-trigger fetches.
    if (isCaption && track.mode === 'disabled') {
      track.mode = 'hidden';
    }
  }
}

// Poll: the player initialises lazily, and on SPA navigation a new lesson's
// track is added later. Cheap enough to run on a steady interval.
setInterval(() => {
  const player = findPlayer();
  if (player) enableHiddenCaptions(player);
}, 1000);

export {};
