(() => {
// ========================================
// 共通ゲームデータ
// ========================================

if (!window.MONSTER_WAR_DATA) {
    throw new Error(
        "MONSTER_WAR_DATA が読み込まれていません。party/index.html で ../database/game-data.js を script.js より先に読み込んでください。"
    );
}

const {
    characterDatabase,
    skillDatabase,
    characterSkillsDatabase
} = window.MONSTER_WAR_DATA;


// ========================================
// 技取得・キャラクターの技取得
// ========================================
//
// [重複解消] getSkill / getCharacterSkills は
// database/game-data.js に共通実装があるため、
// ここでは再定義しません。

// ========================================
// パーティ状態
// ========================================

let party = [];

let selectedCharacterId = null;


// ========================================
// 保存されているパーティを読み込む
// ========================================

function loadSavedParty() {

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
            .filter(id => {

                return characterDatabase.some(
                    character =>
                        character.id === id
                );

            })
            .slice(0, window.MONSTER_WAR_CONSTANTS.PARTY_MAX_SIZE);

    }
    catch (error) {

        console.error(
            "保存されたパーティの読み込みに失敗しました。",
            error
        );

        return [];

    }

}


// ========================================
// DOM取得
// ========================================

const characterBox =
    document.getElementById(
        "character-box"
    );

const partyList =
    document.getElementById(
        "party-list"
    );

const partyCount =
    document.getElementById(
        "party-count"
    );

const boxCount =
    document.getElementById(
        "box-count"
    );

const detailIcon =
    document.getElementById(
        "detail-icon"
    );

const detailName =
    document.getElementById(
        "detail-name"
    );

const detailHp =
    document.getElementById(
        "detail-hp"
    );

const detailAttack =
    document.getElementById(
        "detail-attack"
    );

const detailDefense =
    document.getElementById(
        "detail-defense"
    );

const detailMove =
    document.getElementById(
        "detail-move"
    );

const detailStats =
    document.querySelector(
        ".detail-stats"
    );

// ========================================
// 合計値表示用
// ========================================

let detailTotal =
    document.getElementById(
        "detail-total"
    );

if (detailStats) {

    detailStats.style.display = "grid";
    detailStats.style.gridTemplateColumns =
        "repeat(5, minmax(0, 1fr))";
    detailStats.style.gap = "8px";
    detailStats.style.width = "100%";

}

if (!detailTotal && detailStats) {

    detailTotal =
        document.createElement(
            "div"
        );

    detailTotal.className =
        "stat";

    detailTotal.id =
        "detail-total";

    detailTotal.innerHTML = `
        <span>
            合計
        </span>
        <strong>
            -
        </strong>
    `;

    detailStats.appendChild(
        detailTotal
    );
}

const detailDescription =
    document.getElementById(
        "detail-description"
    );

const detailSkills =
    document.getElementById(
        "detail-skills"
    );

const addButton =
    document.getElementById(
        "add-button"
    );

const removeButton =
    document.getElementById(
        "remove-button"
    );

const clearButton =
    document.getElementById(
        "clear-button"
    );

const confirmButton =
    document.getElementById(
        "confirm-button"
    );


// ========================================
// キャラクター取得
// ========================================

function getCharacter(id) {

    return characterDatabase.find(
        character =>
            character.id === id
    );

}


// ========================================
// ボックス描画
// ========================================

function renderCharacterBox() {

    characterBox.innerHTML = "";

    characterDatabase.forEach(
        character => {

            const card =
                document.createElement(
                    "div"
                );

            card.className =
                "character-card";

            card.dataset.id =
                character.id;


            // ========================================
            // パーティに入っているか
            // ========================================

            const inParty =
                party.includes(
                    character.id
                );

            if (inParty) {

                card.classList.add(
                    "in-party"
                );

            }


            // ========================================
            // 選択中か
            // ========================================

            if (
                selectedCharacterId ===
                character.id
            ) {

                card.classList.add(
                    "selected"
                );

            }


            // ========================================
            // カードHTML
            // ========================================

            card.innerHTML = `

                <div class="character-card-icon">

                    <img
                        src="${character.image}"
                        alt="${character.name}"
                    >

                </div>

                <div class="character-card-name">

                    ${character.name}

                </div>

                ${
                    inParty
                        ? `
                            <div class="party-badge">
                                PARTY
                            </div>
                        `
                        : ""
                }

            `;


            // ========================================
            // クリック
            // ========================================

            card.addEventListener(
                "click",
                () => {

                    selectCharacter(
                        character.id
                    );

                }
            );


            characterBox.appendChild(
                card
            );

        }
    );


    // ========================================
    // キャラクター数
    // ========================================

    boxCount.textContent =
        `${characterDatabase.length}体`;

}


// ========================================
// パーティ描画
// ========================================

function renderParty() {

    partyList.innerHTML = "";


    // ========================================
    // 常に6枠表示
    // ========================================

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
            "party-slot";

        const characterId =
            party[i];


        // ========================================
        // キャラクターが入っている
        // ========================================

        if (characterId) {

            const character =
                getCharacter(
                    characterId
                );

            if (!character) {
                continue;
            }

            slot.innerHTML = `

                <div class="slot-number">

                    ${i + 1}

                </div>

                <div class="party-character-icon">

                    <img
                        src="${character.image}"
                        alt="${character.name}"
                    >

                </div>

                <div class="party-character-name">

                    ${character.name}

                </div>

            `;


            // ========================================
            // パーティ枠クリック
            // ========================================

            slot.addEventListener(
                "click",
                () => {

                    selectCharacter(
                        character.id
                    );

                }
            );

        }


        // ========================================
        // 空き枠
        // ========================================

        else {

            slot.classList.add(
                "empty"
            );

            slot.innerHTML = `

                <div class="slot-number">

                    ${i + 1}

                </div>

                <div>

                    EMPTY

                </div>

            `;

        }


        partyList.appendChild(
            slot
        );

    }


    // ========================================
    // パーティ人数
    // ========================================

    partyCount.textContent =
        `${party.length} / 6`;

}


// ========================================
// キャラクター選択
// ========================================

function selectCharacter(id) {

    const character =
        getCharacter(
            id
        );

    if (!character) {
        return;
    }

    selectedCharacterId =
        id;

    renderCharacterBox();

    renderCharacterDetail();

    updateButtons();

}


// ========================================
// 詳細表示
// ========================================

function renderCharacterDetail() {

    const character =
        getCharacter(
            selectedCharacterId
        );


    // ========================================
    // 未選択
    // ========================================

    if (!character) {

        detailIcon.innerHTML =
            "―";

        detailName.textContent =
            "キャラクター未選択";

        detailHp.textContent =
            "-";

        detailAttack.textContent =
            "-";

        detailDefense.textContent =
            "-";

        detailMove.textContent =
            "-";

        if (detailTotal) {
            const totalValue =
                detailTotal.querySelector(
                    "strong"
                );

            if (totalValue) {
                totalValue.textContent =
                    "-";
            }
        }

        detailDescription.textContent =
            "キャラクターを選択してください。";

        if (detailSkills) {

            detailSkills.innerHTML =
                "";

        }

        return;

    }


    // ========================================
    // 画像
    // ========================================

    detailIcon.innerHTML = `

        <img
            src="${character.image}"
            alt="${character.name}"
        >

    `;


    // ========================================
    // 名前
    // ========================================

    detailName.textContent =
        character.name;


    // ========================================
    // ステータス
    // ========================================

    detailHp.textContent =
        character.hp;

    detailAttack.textContent =
        character.attack;

    detailDefense.textContent =
        character.defense;

    detailMove.textContent =
        character.move;

    // ========================================
    // 合計値
    // ========================================

    const total =
        Number.isFinite(
            Number(character.total)
        )
            ? Number(character.total)
            : Number(character.hp || 0) +
              Number(character.attack || 0) +
              Number(character.defense || 0);

    if (detailTotal) {
        const totalValue =
            detailTotal.querySelector(
                "strong"
            );

        if (totalValue) {
            totalValue.textContent =
                total;
        }
    }


    // ========================================
    // 説明
    // ========================================

    detailDescription.textContent =
        character.description;


    // ========================================
    // 技一覧
    // ========================================

    if (detailSkills) {

        const skills =
            getCharacterSkills(
                character.id
            );

        if (
            skills.length === 0
        ) {

            detailSkills.innerHTML =
                "<div class=\"skill-empty\">技を持っていません。</div>";

        }

        else {

            detailSkills.innerHTML =
                skills
                    .map(
                        skill => `

                            <div class="skill-item">

                                <div class="skill-name">

                                    ${skill.name}

                                </div>

                                <div class="skill-info">

                                    <span>
                                        ${skill.type}
                                    </span>

                                    <span>
                                        威力 ${skill.power}
                                    </span>

                                </div>

                                <div class="skill-description">

                                    ${skill.description}

                                </div>

                            </div>

                        `
                    )
                    .join("");

        }

    }

}


// ========================================
// ボタン状態更新
// ========================================

function updateButtons() {

    const character =
        getCharacter(
            selectedCharacterId
        );


    // ========================================
    // 未選択
    // ========================================

    if (!character) {

        addButton.disabled =
            true;

        removeButton.disabled =
            true;

        confirmButton.disabled =
            party.length === 0;

        return;

    }


    // ========================================
    // パーティにいるか
    // ========================================

    const inParty =
        party.includes(
            character.id
        );


    // ========================================
    // 追加ボタン
    // ========================================

    addButton.disabled =
        inParty ||
        party.length >= 6;


    // ========================================
    // 削除ボタン
    // ========================================

    removeButton.disabled =
        !inParty;


    // ========================================
    // 出撃決定
    // ========================================

    confirmButton.disabled =
        party.length === 0;

}


// ========================================
// パーティへ追加
// ========================================

function addToParty() {

    const character =
        getCharacter(
            selectedCharacterId
        );

    if (!character) {
        return;
    }


    // ========================================
    // すでに入っている
    // ========================================

    if (
        party.includes(
            character.id
        )
    ) {

        return;

    }


    // ========================================
    // 6体満員
    // ========================================

    if (
        party.length >= 6
    ) {

        return;

    }


    // ========================================
    // 追加
    // ========================================

    party.push(
        character.id
    );

    renderParty();

    renderCharacterBox();

    renderCharacterDetail();

    updateButtons();

}


// ========================================
// パーティから削除
// ========================================

function removeFromParty() {

    const character =
        getCharacter(
            selectedCharacterId
        );

    if (!character) {
        return;
    }

    const index =
        party.indexOf(
            character.id
        );


    // ========================================
    // パーティにいない
    // ========================================

    if (index === -1) {
        return;
    }


    // ========================================
    // 削除
    // ========================================

    party.splice(
        index,
        1
    );

    renderParty();

    renderCharacterBox();

    renderCharacterDetail();

    updateButtons();

}


// ========================================
// パーティリセット
// ========================================

function clearParty() {

    party = [];

    renderParty();

    renderCharacterBox();

    renderCharacterDetail();

    updateButtons();

}


// ========================================
// 出撃決定
// ========================================

// ここで初めて現在のパーティを保存する。
// タイトル画面に戻ったあと、
// 「編成する」を押すとこのパーティが復元される。

function confirmParty() {

    // ========================================
    // パーティが空なら何もしない
    // ========================================

    if (
        party.length === 0
    ) {

        return;

    }


    // ========================================
    // パーティのキャラクター情報を取得
    // ========================================

    const members =
        party
            .map(
                id => getCharacter(id)
            )
            .filter(Boolean);


    // ========================================
    // パーティIDを保存
    // ========================================

    localStorage.setItem(
        window.MONSTER_WAR_CONSTANTS.STORAGE_KEYS.PARTY,
        JSON.stringify(
            party
        )
    );


    // ========================================
    // キャラクター情報そのものも保存
    // ========================================

    localStorage.setItem(
        "monsterWarPreparedParty",
        JSON.stringify(
            members
        )
    );


    // ========================================
    // コンソール確認
    // ========================================

    console.log(
        "出撃パーティ:",
        members
    );


    // ========================================
    // タイトル画面へ戻る
    // ========================================

    window.location.href =
        "../title/title.html";

}


// ========================================
// イベント
// ========================================

if (addButton) {

    addButton.addEventListener(
        "click",
        addToParty
    );

}

if (removeButton) {

    removeButton.addEventListener(
        "click",
        removeFromParty
    );

}

if (clearButton) {

    clearButton.addEventListener(
        "click",
        clearParty
    );

}

if (confirmButton) {

    confirmButton.addEventListener(
        "click",
        confirmParty
    );

}


// ========================================
// 初期化
// ========================================

function initialize() {

    // ========================================
    // 保存されているパーティを復元
    // ========================================

    party =
        loadSavedParty();


    // ========================================
    // 前回パーティがある場合
    // 最初のキャラクターを選択
    // ========================================

    if (
        party.length > 0
    ) {

        selectedCharacterId =
            party[0];

    }


    // ========================================
    // 画面描画
    // ========================================

    renderCharacterBox();

    renderParty();

    renderCharacterDetail();

    updateButtons();

}


// ========================================
// 起動
// ========================================

initialize();


// ========================================
// BGM
// ========================================

const bgm =
    document.getElementById(
        "bgm"
    );


// ========================================
// BGMがHTMLに存在する場合のみ実行
// ========================================

if (bgm) {

    bgm.volume = 0.5;


    // ========================================
    // ページを開いた直後に再生を試す
    // ========================================

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


    // ========================================
    // 画面を最初にクリックした瞬間に再生
    // ========================================

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
})();
