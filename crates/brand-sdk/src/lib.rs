//! roommate のゲームから、匿名 ID・スコア・自己ベストを使う。
//!
//! ブラウザでは `brand-sdk.js` が macroquad の JS ローダーのプラグインとして用意する関数を呼ぶ。
//! `brand-sdk.js` は `mq_js_bundle.js` の後、`load()` の前に読み込む。
//!
//! ```html
//! <script src="brand-sdk.js" data-game="browser-game-1"></script>
//! ```
//!
//! ネイティブ実行(開発用)では通信せず、自己ベストは起動している間だけ覚える。

#[cfg(target_arch = "wasm32")]
mod imp {
    #[link(wasm_import_module = "env")]
    extern "C" {
        fn roommate_is_ready() -> f64;
        fn roommate_best_score() -> f64;
        fn roommate_submit_score(score: f64, duration_ms: f64);
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
}

#[cfg(not(target_arch = "wasm32"))]
mod imp {
    use std::sync::atomic::{AtomicU32, Ordering};

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
}
