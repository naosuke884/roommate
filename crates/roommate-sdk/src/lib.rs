//! roommate のゲームから、匿名 ID・名前・スコア・自己ベストを使い、自分のデータを消す。
//!
//! ブラウザでは `roommate-sdk.js` が macroquad の JS ローダーのプラグインとして用意する関数を呼ぶ。
//! `roommate-sdk.js` は `mq_js_bundle.js` の後、`load()` の前に読み込む。
//!
//! ```html
//! <script src="roommate-sdk.js" data-game="grapnl"></script>
//! ```
//!
//! 名前をまだ付けていない人には、`roommate-sdk.js` が最初に一度だけ名前の入力欄を出す。
//! あとから変えられるよう、ゲームの「名前を変える」ボタンなどから [`open_name_dialog`] を呼ぶ。
//!
//! ネイティブ実行(開発用)では通信せず、自己ベストは起動している間だけ覚える。

#[cfg(target_arch = "wasm32")]
mod imp {
    use super::{DeleteStatus, Ranking, RankingEntry, RankingStatus};
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
        fn roommate_request_delete();
        fn roommate_delete_status() -> f64;
        fn roommate_open_name_dialog();
        fn roommate_name_dialog_open() -> f64;
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

    pub fn request_delete() {
        unsafe { roommate_request_delete() }
    }

    pub fn delete_status() -> DeleteStatus {
        match unsafe { roommate_delete_status() } as u32 {
            1 => DeleteStatus::Deleting,
            2 => DeleteStatus::Done,
            3 => DeleteStatus::Failed,
            _ => DeleteStatus::NotRequested,
        }
    }

    pub fn open_name_dialog() {
        unsafe { roommate_open_name_dialog() }
    }

    pub fn is_name_dialog_open() -> bool {
        unsafe { roommate_name_dialog_open() != 0.0 }
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod imp {
    use super::{DeleteStatus, Ranking, RankingStatus};
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
        if !DELETED.load(Ordering::Relaxed) {
            BEST.fetch_max(score, Ordering::Relaxed);
        }
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

    static DELETED: AtomicBool = AtomicBool::new(false);

    // 通信しないので、頼まれたらすぐ自己ベストを忘れて消し終える
    pub fn request_delete() {
        DELETED.store(true, Ordering::Relaxed);
        BEST.store(0, Ordering::Relaxed);
    }

    pub fn delete_status() -> DeleteStatus {
        if DELETED.load(Ordering::Relaxed) {
            DeleteStatus::Done
        } else {
            DeleteStatus::NotRequested
        }
    }

    // 入力欄はブラウザにしか無いので、何もしない
    pub fn open_name_dialog() {}

    pub fn is_name_dialog_open() -> bool {
        false
    }
}

/// ランキングの 1 行
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RankingEntry {
    pub rank: u32,
    /// 「あおい#1a2b」のような表示名。名前の無い人は「名無し#1a2b」
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

/// [`request_delete`] で頼んだ、自分のデータを消す要求の状態
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeleteStatus {
    NotRequested,
    Deleting,
    Done,
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

/// 自分の匿名 ID と、全ゲームのスコアを消し始める。結果は [`delete_status`] で見る。
/// ID はゲームをまたいで共通なので、ほかのゲームのスコアと自己ベストも消える。
/// 消し終えたあとは、ページを開き直すまで ID を持たず、送ったスコアも保存しない
pub fn request_delete() {
    imp::request_delete()
}

/// 頼んだ、自分のデータを消す要求の状態。`Failed` ならデータは残っていて、頼み直せる
pub fn delete_status() -> DeleteStatus {
    imp::delete_status()
}

/// ランキングに出す名前を変える入力欄を開く。ゲームの「名前を変える」ボタンなどから呼ぶ。
/// 開いている間はキー入力が入力欄へ行くので、[`is_name_dialog_open`] を見てゲームを止める
pub fn open_name_dialog() {
    imp::open_name_dialog()
}

/// 名前の入力欄を開いているか。最初に自動で開いたときも含む
pub fn is_name_dialog_open() -> bool {
    imp::is_name_dialog_open()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ネイティブでは送ったスコアの最大を自己ベストとして覚え_消すと忘れる() {
        assert_eq!(best_score(), None);
        submit_score(120, 60_000);
        submit_score(80, 60_000);
        assert_eq!(best_score(), Some(120));
        assert!(!is_ready());

        // 静的な状態を共有するので、消したあとの確かめも同じテストで続けて行う
        assert_eq!(delete_status(), DeleteStatus::NotRequested);
        request_delete();
        assert_eq!(delete_status(), DeleteStatus::Done);
        assert_eq!(best_score(), None);
        submit_score(50, 60_000);
        assert_eq!(best_score(), None);
    }

    #[test]
    fn ネイティブではランキングを頼むと空の一覧を返す() {
        assert_eq!(ranking(), RankingStatus::NotRequested);
        request_ranking();
        assert_eq!(ranking(), RankingStatus::Ready(Ranking::default()));
    }
}
