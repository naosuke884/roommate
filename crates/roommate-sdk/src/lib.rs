//! roommate のゲームから、匿名 ID・スコア・自己ベストを使う。
//!
//! ブラウザでは `roommate-sdk.js` が macroquad の JS ローダーのプラグインとして用意する関数を呼ぶ。
//! `roommate-sdk.js` は `mq_js_bundle.js` の後、`load()` の前に読み込む。
//!
//! ```html
//! <script src="roommate-sdk.js" data-game="browser-game-1"></script>
//! ```
//!
//! ネイティブ実行(開発用)では通信せず、自己ベストは起動している間だけ覚える。

#[cfg(target_arch = "wasm32")]
mod imp {
    use super::{Ranking, RankingEntry, RankingStatus};
    #[link(wasm_import_module = "env")]
    extern "C" {
        fn roommate_is_ready() -> f64;
        fn roommate_best_score() -> f64;
        fn roommate_submit_score(score: f64, duration_ms: f64);
        fn roommate_request_ranking();
        fn roommate_ranking_status() -> f64;
        fn roommate_ranking_len() -> f64;
        fn roommate_ranking_my_rank() -> f64;
        fn roommate_ranking_rank(i: f64) -> f64;
        fn roommate_ranking_score(i: f64) -> f64;
        fn roommate_ranking_name(i: f64, ptr: *mut u8, cap: f64) -> f64;
    }

    pub fn is_ready() -> bool {
        unsafe { roommate_is_ready() != 0.0 }
    }

    pub fn best_score() -> Option<u32> {
        let best = unsafe { roommate_best_score() };
        (best >= 0.0).then_some(best as u32)
    }

    pub fn submit_score(score: u32, duration_ms: u32) {
        unsafe { roommate_submit_score(score as f64, duration_ms as f64) }
    }

    pub fn request_ranking() {
        unsafe { roommate_request_ranking() }
    }

    pub fn ranking() -> RankingStatus {
        match unsafe { roommate_ranking_status() } as u32 {
            1 => RankingStatus::Loading,
            2 => RankingStatus::Ready(read_ranking()),
            3 => RankingStatus::Failed,
            _ => RankingStatus::NotRequested,
        }
    }

    fn read_ranking() -> Ranking {
        let len = unsafe { roommate_ranking_len() } as usize;
        let entries = (0..len)
            .map(|i| RankingEntry {
                rank: unsafe { roommate_ranking_rank(i as f64) } as u32,
                name: read_name(i),
                score: unsafe { roommate_ranking_score(i as f64) } as u32,
            })
            .collect();
        let my_rank = unsafe { roommate_ranking_my_rank() };
        Ranking {
            entries,
            my_rank: (my_rank >= 1.0).then_some(my_rank as u32),
        }
    }

    // JS は cap バイトまで書き、名前の全体のバイト数を返す。足りなければ大きくして読み直す
    fn read_name(i: usize) -> String {
        let mut buf = vec![0u8; 64];
        let len =
            unsafe { roommate_ranking_name(i as f64, buf.as_mut_ptr(), buf.len() as f64) } as usize;
        if len > buf.len() {
            buf.resize(len, 0);
            unsafe { roommate_ranking_name(i as f64, buf.as_mut_ptr(), buf.len() as f64) };
        }
        buf.truncate(len);
        String::from_utf8_lossy(&buf).into_owned()
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod imp {
    use super::{Ranking, RankingStatus};
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

    // 0 は「まだ無い」。スコア 0 は自己ベストとして覚えなくてよい
    static BEST: AtomicU32 = AtomicU32::new(0);

    pub fn is_ready() -> bool {
        false
    }

    pub fn best_score() -> Option<u32> {
        match BEST.load(Ordering::Relaxed) {
            0 => None,
            best => Some(best),
        }
    }

    pub fn submit_score(score: u32, _duration_ms: u32) {
        BEST.fetch_max(score, Ordering::Relaxed);
    }

    static RANKING_REQUESTED: AtomicBool = AtomicBool::new(false);

    pub fn request_ranking() {
        RANKING_REQUESTED.store(true, Ordering::Relaxed);
    }

    // 通信しないので、頼まれたらすぐ空のランキングを返す
    pub fn ranking() -> RankingStatus {
        if RANKING_REQUESTED.load(Ordering::Relaxed) {
            RankingStatus::Ready(Ranking::default())
        } else {
            RankingStatus::NotRequested
        }
    }
}

/// ランキングの 1 行
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RankingEntry {
    pub rank: u32,
    /// 「名無し#1a2b」のような表示名
    pub name: String,
    pub score: u32,
}

/// 今のコースの日付のランキング
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Ranking {
    /// 上位から最大 50 件
    pub entries: Vec<RankingEntry>,
    /// 自分のその日の順位。50 位より下でも入る。その日のスコアが無ければ `None`
    pub my_rank: Option<u32>,
}

/// [`request_ranking`] で頼んだランキングの状態
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RankingStatus {
    NotRequested,
    Loading,
    Ready(Ranking),
    Failed,
}

/// 匿名 ID の準備ができたか。できる前に送ったスコアは、準備ができてから送られる
pub fn is_ready() -> bool {
    imp::is_ready()
}

/// 全期間の自己ベスト。サーバーと端末に残っている分の大きいほう。まだ無ければ `None`
pub fn best_score() -> Option<u32> {
    imp::best_score()
}

/// スコアとプレイ時間(ミリ秒)を送る。結果は待たずに戻り、自己ベストはすぐ更新される
pub fn submit_score(score: u32, duration_ms: u32) {
    imp::submit_score(score, duration_ms)
}

/// 今のコースの日付のランキングと自分の順位を読み始める。結果は [`ranking`] で見る。
/// 送ったばかりのスコアも順位に入る。ゲームオーバーの画面を出すときなどに 1 回呼ぶ
pub fn request_ranking() {
    imp::request_ranking()
}

/// 頼んだランキングの状態。`Ready` になるまで毎フレーム呼んでよいが、
/// 呼ぶたびに一覧を組み立てるので、`Ready` になったら手元に持っておく
pub fn ranking() -> RankingStatus {
    imp::ranking()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ネイティブでは送ったスコアの最大を自己ベストとして覚える() {
        assert_eq!(best_score(), None);
        submit_score(120, 60_000);
        submit_score(80, 60_000);
        assert_eq!(best_score(), Some(120));
        assert!(!is_ready());
    }

    #[test]
    fn ネイティブではランキングを頼むと空の一覧を返す() {
        assert_eq!(ranking(), RankingStatus::NotRequested);
        request_ranking();
        assert_eq!(ranking(), RankingStatus::Ready(Ranking::default()));
    }
}
