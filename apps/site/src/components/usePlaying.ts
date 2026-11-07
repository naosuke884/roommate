import { useEffect, useState } from 'react';

/** 読み直す間隔。API は 15 秒キャッシュするので、それより長くする */
export const PLAYING_REFRESH_MS = 30_000;

/** 今そのゲームを開いている人数。読めるまでと、読めなかったときは null */
export function usePlaying(apiOrigin: string, game: string): number | null {
  const [playing, setPlaying] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = () => {
      // タブが裏にある間は読まない。戻ってきたときに読み直す
      if (document.hidden) return;
      fetch(`${apiOrigin}/games/${encodeURIComponent(game)}/presence`, {
        signal: controller.signal,
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<{ playing: number }>;
        })
        .then(({ playing }) => setPlaying(playing))
        .catch((error: unknown) => {
          if (!controller.signal.aborted) console.error(error);
        });
    };

    load();
    const timer = setInterval(load, PLAYING_REFRESH_MS);
    // ゲームから戻るボタンで戻ったときと、タブに戻ってきたときも読み直す
    window.addEventListener('pageshow', load);
    document.addEventListener('visibilitychange', load);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('pageshow', load);
      document.removeEventListener('visibilitychange', load);
    };
  }, [apiOrigin, game]);

  return playing;
}
