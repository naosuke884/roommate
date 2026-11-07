-- ランキングに出す名前。付けていない人は NULL で、「名無し」と出す。
-- 同じ名前の人は、表示に付ける ID の先頭 4 文字で見分けるので、重なってもよい
ALTER TABLE players ADD COLUMN name TEXT;
