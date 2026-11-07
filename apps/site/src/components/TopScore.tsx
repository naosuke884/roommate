import { useRanking } from './useRanking.ts';

interface Props {
  apiOrigin: string;
  game: string;
}

/** 今のコースの 1 位のスコア。ゲーム一覧のカードに出す */
export default function TopScore({ apiOrigin, game }: Props) {
  const state = useRanking(apiOrigin, game);

  if (state.status === 'loading') return <span className="top-score">今日の 1 位 …</span>;
  if (state.status === 'error') return <span className="top-score">今日の 1 位 -</span>;
  const top = state.entries[0];
  if (!top) return <span className="top-score">今日の記録はまだありません</span>;
  return (
    <span className="top-score">
      今日の 1 位 <b>{top.score.toLocaleString('ja-JP')}</b>
    </span>
  );
}
