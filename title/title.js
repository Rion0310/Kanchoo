// ========================================
// MONSTER WAR
// タイトル画面 JavaScript
// ========================================


// ========================================
// キャラクターデータベース
// ========================================
//
// [重複解消]
// 以前はここに id/name/image だけの簡易版
// titleCharacterDatabase を独自に持っていたが、
// database/game-data.js の characterDatabase と
// 実質同じデータの劣化コピーになっており、
// キャラを追加・変更するたびに2箇所を直す必要がある
// 保守性の問題があった。
// title.html で ../database/game-data.js を
// title.js より先に読み込むようにし、
// window.MONSTER_WAR_DATA.characterDatabase を
// そのまま参照する形に統一した。

const titleCharacterDatabase =
    window.MONSTER_WAR_DATA
        ? window.MONSTER_WAR_DATA.characterDatabase
        : [];

if (!window.MONSTER_WAR_DATA) {

    console.error(
        "MONSTER_WAR_DATA が読み込まれていません。title.html で ../database/game-data.js を title.js より先に読み込んでください。"
    );

}


// ========================================
// 現在のパーティを取得
// ========================================

function getTitleParty() {

    // ====================================
    // 「出撃準備」で保存された
    // 完全なキャラクターデータを取得
    // ====================================

    const preparedParty =
        localStorage.getItem(
            "monsterWarPreparedParty"
        );


    if (preparedParty) {

        try {

            const members =
                JSON.parse(
                    preparedParty
                );


            if (
                Array.isArray(members)
            ) {

                return members;

            }

        }
        catch (error) {

            console.error(
                "保存されたパーティデータの読み込みに失敗しました。",
                error
            );

        }

    }


    // ====================================
    // 完全なデータがない場合
    // IDからキャラクターを復元
    // ====================================

    const savedParty =
        localStorage.getItem(
            window.MONSTER_WAR_CONSTANTS.STORAGE_KEYS.PARTY
        );


    if (!savedParty) {

        return [];

    }


    try {

        const partyIds =
            JSON.parse(
                savedParty
            );


        if (
            !Array.isArray(partyIds)
        ) {

            return [];

        }


        return partyIds
            .map(
                id => {

                    return titleCharacterDatabase.find(
                        character =>
                            character.id === id
                    );

                }
            )
            .filter(Boolean);

    }
    catch (error) {

        console.error(
            "保存されたパーティIDの読み込みに失敗しました。",
            error
        );

        return [];

    }

}


// ========================================
// 現在のパーティをタイトル画面に表示
// ========================================

function renderTitleParty() {

    const partyList =
        document.getElementById(
            "title-party-list"
        );


    if (!partyList) {

        return;

    }


    const party =
        getTitleParty();


    partyList.innerHTML = "";


    // ====================================
    // 6枠固定
    // ====================================

    for (
        let i = 0;
        i < 6;
        i++
    ) {

        const slot =
            document.createElement(
                "div"
            );


        slot.className =
            "title-party-slot";


        const character =
            party[i];


        // ==================================
        // キャラクターが存在する場合
        // ==================================

        if (character) {

            slot.innerHTML = `

                <div class="title-party-slot-number">
                    ${i + 1}
                </div>

                <div class="title-party-image">

                    <img
                        src="${character.image}"
                        alt="${character.name}"
                    >

                </div>

                <div class="title-party-name">
                    ${character.name}
                </div>

            `;

        }


        // ==================================
        // 空き枠
        // ==================================

        else {

            slot.classList.add(
                "empty"
            );


            slot.innerHTML = `

                <div class="title-party-slot-number">
                    ${i + 1}
                </div>

                <div class="title-party-empty">
                    EMPTY
                </div>

            `;

        }


        partyList.appendChild(
            slot
        );

    }

}


// ========================================
// 「対戦する」
// ========================================
//
// [BGM引き継ぎ]
// location.hrefへ直接代入する代わりに、
// ../shared/menu-bgm.js が用意するMenuBGM.navigateTo()を
// 経由することで、遷移前に再生位置を保存してから移動する。

function openBattle() {

    if (window.MenuBGM) {

        window.MenuBGM.navigateTo(
            "../room/room.html"
        );

    }
    else {

        window.location.href =
            "../room/room.html";

    }

}


// ========================================
// 「編成する」
// ========================================

function openParty() {

    if (window.MenuBGM) {

        window.MenuBGM.navigateTo(
            "../party/index.html"
        );

    }
    else {

        window.location.href =
            "../party/index.html";

    }

}


// ========================================
// メニューボタン設定
// ========================================

function setupMenuButtons() {

    const battleButton =
        document.getElementById(
            "battle-button"
        );


    const partyButton =
        document.getElementById(
            "party-button"
        );


    if (battleButton) {

        battleButton.addEventListener(
            "click",
            openBattle
        );

    }


    if (partyButton) {

        partyButton.addEventListener(
            "click",
            openParty
        );

    }

}


// ========================================
// 初期化
// ========================================
//
// [BGM]
// 以前はここでsetupBGM()を呼んでいたが、
// 再生・再開位置の引き継ぎも含めて
// ../shared/menu-bgm.js に一本化したため撤去した。
// title.htmlで<audio id="bgm">とmenu-bgm.jsを
// 読み込んでいれば自動的に動作する。

function initializeTitle() {

    renderTitleParty();

    setupMenuButtons();

}


// ========================================
// ページ読み込み完了
// ========================================

document.addEventListener(
    "DOMContentLoaded",
    initializeTitle
);