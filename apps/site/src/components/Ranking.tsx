import { useEffect, useState } from 'react';

interface Entry {
  rank: number;
  name: string;
  score: number;
}

type State =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; day: string; entries: Entry[] };

interface Props {
  apiOrigin: string;
  game: string;
}

/** 今のコースの日付(UTC)のランキングを出す */
export default function Ranking({ apiOrigin, game }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const day = courseDay(new Date());
    const controller = new AbortController();
    fetch(`${apiOrigin}/games/${encodeURIComponent(game)}/rankings/${day}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ entries: Entry[] }>;
      })
      .then(({ entries }) => setState({ status: 'ready', day, entries }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error(error);
          setState({ status: 'error' });
        }
      });
    return () => controller.abort();
  }, [apiOrigin, game]);

  if (state.status === 'loading') return <p className="ranking-note">読み込み中…</p>;
  if (state.status === 'error') {
    return <p className="ranking-note">ランキングを読み込めませんでした。</p>;
  }
  if (state.entries.length === 0) {
    return <p className="ranking-note">{state.day} の記録はまだありません。</p>;
  }
  return (
    <ol className="ranking">
      {state.entries.map((entry) => (
        <li key={entry.rank}>
          <span className="ranking-rank">{entry.rank}</span>
          <span className="ranking-name">{entry.name}</span>
          <span className="ranking-score">{entry.score.toLocaleString('ja-JP')}</span>
        </li>
      ))}
    </ol>
  );
}

// ゲームのコースは UTC の日付で切り替わる
function courseDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
