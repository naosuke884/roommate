-- held_at が入ったスコアは、ゲームごとの確かめる点数を超えたため保留にしているもの。
-- 運営が承認すると NULL に戻す。保留中はランキングに出さないが、本人の自己ベストには数える
ALTER TABLE scores ADD COLUMN held_at INTEGER;
