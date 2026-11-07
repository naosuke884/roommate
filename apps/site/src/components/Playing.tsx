import { usePlaying } from './usePlaying.ts';

interface Props {
  apiOrigin: string;
  game: string;
}

/** 今そのゲームを開いている人数。読めるまでは出さない */
export default function Playing({ apiOrigin, game }: Props) {
  const playing = usePlaying(apiOrigin, game);
  if (playing === null) return null;
  return (
    <p className="playing" data-active={playing > 0 || undefined}>
      {playing > 0 ? (
        <>
          いま <b>{playing.toLocaleString('ja-JP')}</b> 人が遊んでいます
        </>
      ) : (
        'いま遊んでいる人はいません'
      )}
    </p>
  );
}
