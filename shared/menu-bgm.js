// ========================================
// MONSTER WAR
// メニュー画面 共通BGM
// （タイトル/ルーム/パーティ間で再生が
//   途切れて聞こえないようにするための仕組み）
// ========================================
//
// [仕組み]
// このサイトはページ遷移のたびにブラウザがページを
// 丸ごと読み込み直す、いわゆる複数ページ構成(MPA)です。
// そのため技術的に「完全に途切れなく」音楽を鳴らし続ける
// ことはできませんが、次のページへ移る直前に再生位置(秒数)を
// sessionStorageへ保存しておき、次のページで同じ位置から
// 再生を再開することで、ほぼ切れ目なく聴こえるようにします。
// (真のシームレス再生にはSPA化＝画面遷移の作り直しが必要なため、
//  今回は簡易的なこの方式を採用しています。)
//
// [対象ページ]
// title.html / room.html / party/index.html のように、
// <audio id="bgm"> を持ち、このスクリプトを読み込んだページ同士。
// battle.html は専用のBGM(CanChokeInst.mp3)を別に持つため、
// このスクリプトを読み込みません。読み込ませないことで、
// BATTLEに入ると同時にメニュー曲は自然に止まります。

(() => {
    "use strict";

    const POSITION_KEY = "monsterWarMenuBgmPosition";

    function setup() {
        const bgm = document.getElementById("bgm");

        if (!bgm) {
            return;
        }

        bgm.volume = 0.5;

        // ====================================
        // 直前のメニュー画面での再生位置を復元
        // ====================================

        const savedPosition = sessionStorage.getItem(POSITION_KEY);

        if (savedPosition !== null) {
            const resumeTime = parseFloat(savedPosition);

            const applyResumeTime = () => {
                if (Number.isFinite(resumeTime) && resumeTime > 0) {
                    try {
                        bgm.currentTime = resumeTime;
                    } catch (error) {
                        // 読み込み直後は例外が出ることがあるため無視する
                    }
                }
            };

            if (bgm.readyState >= 1) {
                applyResumeTime();
            } else {
                bgm.addEventListener("loadedmetadata", applyResumeTime, { once: true });
            }
        }

        // ====================================
        // 再生開始（自動再生ブロック対策込み）
        // ====================================

        function tryPlay() {
            bgm.play().catch(() => {
                console.log("自動再生がブロックされました。画面をクリックしてください。");
            });
        }

        window.addEventListener("load", tryPlay);

        document.addEventListener(
            "click",
            () => {
                if (bgm.paused) {
                    tryPlay();
                }
            },
            { once: true }
        );

        // ====================================
        // ページを離れる際に再生位置を保存
        // （戻る/閉じる/リロードなど、navigateToを
        //  経由しない離脱もカバーするための保険）
        // ====================================

        const savePosition = () => {
            try {
                sessionStorage.setItem(POSITION_KEY, String(bgm.currentTime));
            } catch (error) {
                // sessionStorageが使えない環境では諦める
            }
        };

        window.addEventListener("pagehide", savePosition);
        window.addEventListener("beforeunload", savePosition);
    }

    document.addEventListener("DOMContentLoaded", setup);

    // ========================================
    // メニュー間の画面遷移用ヘルパー
    // ========================================
    //
    // location.hrefへ直接代入する代わりにこれを呼ぶと、
    // 再生位置を保存してから遷移する。
    // battle.htmlのようにこの仕組みに参加しないページへ
    // 遷移する場合に呼んでも、保存された位置は単に
    // 使われないだけなので害はない。

    window.MenuBGM = {
        navigateTo(url) {
            const bgm = document.getElementById("bgm");

            if (bgm) {
                try {
                    sessionStorage.setItem(POSITION_KEY, String(bgm.currentTime));
                } catch (error) {
                    // 無視
                }
            }

            window.location.href = url;
        }
    };
})();