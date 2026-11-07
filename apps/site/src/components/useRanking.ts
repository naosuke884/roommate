import { useEffect, useState } from 'react';

export interface Entry {
  rank: number;
  name: string;
  score: number;
}

export type RankingState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; day: string; entries: Entry[] };

/** 今のコースの日付(UTC)のランキングを読む */
export function useRanking(apiOrigin: string, game: string): RankingState {
  const [state, setState] = useState<RankingState>({ status: 'loading' });

  useEffect(() => {
    let controller = new AbortController();

    const load = (cache: RequestCache) => {
      const day = courseDay(new Date());
      const { signal } = controller;
      fetch(`${apiOrigin}/games/${encodeURIComponent(game)}/rankings/${day}`, { signal, cache })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<{ entries: Entry[] }>;
        })
        .then(({ entries }) => setState({ status: 'ready', day, entries }))
        .catch((error: unknown) => {
          if (!signal.aborted) {
            console.error(error);
            setState({ status: 'error' });
          }
        });
    };

    // ゲームから戻るボタンで戻ると、ページは bfcache から遊ぶ前のまま復元される。
    // 遊んだスコアが載るように、ブラウザのキャッシュを使わずに読み直す
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      controller.abort();
      controller = new AbortController();
      load('no-cache');
    };

    load('default');
    window.addEventListener('pageshow', onPageShow);
    return () => {
      controller.abort();
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [apiOrigin, game]);

  return state;
}

// ゲームのコースは UTC の日付で切り替わる
function courseDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
