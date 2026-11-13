// Livestream links for sessions, from editorial/livestreams.json.
// A session gets a link when a stream covers its room and its scheduled start;
// the timestamp is approximate (scheduled start minus the stream's start).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface Stream { day: string; room_id: string; video_id: string; started_at: string; duration_seconds: number }
export interface StreamLink { url: string; at: string }

export const livestreamLookup = (root: string) => {
  const p = join(root, "editorial/livestreams.json");
  const streams: Stream[] = existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as { streams: Stream[] }).streams : [];
  return (s: { room_id: string | null; starts_at: string }): StreamLink | null => {
    for (const st of streams) {
      if (st.room_id !== s.room_id) continue;
      const off = Math.floor((Date.parse(s.starts_at) - Date.parse(st.started_at)) / 1000);
      if (off < -1800 || off > st.duration_seconds) continue;
      const t = Math.max(0, off);
      const at = `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
      return { url: `https://www.youtube.com/watch?v=${st.video_id}&t=${t}s`, at };
    }
    return null;
  };
};
