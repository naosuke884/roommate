import { useRanking } from './useRanking.ts';

interface Props {
  apiOrigin: string;
  game: string;
}

/** 今のコースの日付(UTC)のランキングを出す */
export default function Ranking({ apiOrigin, game }: Props) {
  const state = useRanking(apiOrigin, game);

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
