// ========================================
// MONSTER WAR
// タイトル画面 JavaScript
// ========================================


// ========================================
// キャラクターデータベース
// ========================================

const titleCharacterDatabase = [

    {
        id: 1,
        name: "デスリオン",
        image: "../images/deathrion.png"
    },

    {
        id: 2,
        name: "清武",
        image: "../images/kiyotake.png"
    },

    {
        id: 3,
        name: "桃子",
        image: "../images/momoko.png"
    },

    {
        id: 4,
        name: "りおん",
        image: "../images/rion.png"
    },

    {
        id: 5,
        name: "武",
        image: "../images/takeshi.png"
    },

    {
        id: 6,
        name: "VOLCANO MAN",
        image: "../images/volcano.png"
    },

    {
        id: 7,
        name: "割り箸工場のおじさん",
        image: "../images/wariko.png"
    },

    {
        id: 8,
        name: "ゆうな",
        image: "../images/yuuna.png"
    },

    {
        id: 9,
        name: "そらと",
        image: "../images/sorato.jpg"
    },

    {
        id: 10,
        name: "しおん",
        image: "../images/shion.png"
    },

    {
        id: 11,
        name: "フヂムラメイ",
        image: "../images/mei.png"
    },

    {
        id: 12,
        name: "hasuo",
        image: "../images/hasuo.png"
    },

    {
        id: 13,
        name: "きよし",
        image: "../images/kiyoshi.png"
    },

    {
        id: 14,
        name: "大木克幸",
        image: "../images/katsuyuki.png"
    },

    {
        id: 15,
        name: "某ミニマリスト",
        image: "../images/tanuto.png"
    }

];


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
            "monsterWarParty"
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

function openBattle() {

    window.location.href =
        "../room/room.html";

}


// ========================================
// 「編成する」
// ========================================

function openParty() {

    window.location.href =
        "../build/index.html";

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
// BGM
// ========================================

function setupBGM() {

    const bgm =
        document.getElementById(
            "bgm"
        );


    // ====================================
    // BGMがHTMLに存在しない場合
    // ====================================

    if (!bgm) {

        return;

    }


    bgm.volume = 0.5;


    // ====================================
    // ページ読み込み時に再生
    // ====================================

    window.addEventListener(
        "load",
        () => {

            bgm.play().catch(
                () => {

                    console.log(
                        "自動再生がブロックされました。画面をクリックしてください。"
                    );

                }
            );

        }
    );


    // ====================================
    // クリックで再生
    // ====================================

    document.addEventListener(
        "click",
        () => {

            if (
                bgm.paused
            ) {

                bgm.play().catch(
                    () => {}
                );

            }

        },
        {
            once: true
        }
    );

}


// ========================================
// 初期化
// ========================================

function initializeTitle() {

    renderTitleParty();

    setupMenuButtons();

    setupBGM();

}


// ========================================
// ページ読み込み完了
// ========================================

document.addEventListener(
    "DOMContentLoaded",
    initializeTitle
);