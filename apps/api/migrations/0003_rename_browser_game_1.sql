-- ゲームの slug を browser-game-1 から grapnl に変えた。今までのスコアを新しい slug へ移す
UPDATE scores SET game = 'grapnl' WHERE game = 'browser-game-1';
