const skillDatabase = [
    {
        id: 1,
        name: "カンチョー",
        type: "物理",
        power: 80,
        effect: "damage",
        description: "それぞれの流派でのカンチョーを繰り出す基本攻撃。",
        targeting: {
            type: "direction",
            range: 3,
            targetCount: "all",
            targetSide: "enemy"
        }
    },
    {
        id: 2,
        name: "デスカンチョー",
        type: "物理",
        power: 999,
        effect: "damage",
        accuracy: 50,         // 命中率50%
        description: "当たれば確実に相手を殺せるが、範囲が狭いうえに命中しにくい。試合中1回のみ使用可能。命中率50%。",
        targeting:{
                type: "direction",
                range: 1,
                targetCount: "single",
                targetSide: "enemy"
            }
    },
    {
        id: 3,
        name: "アライブカンチョー",
        type: "回復",
        power: 0,
        effect: "revive",
        description: "移動可能範囲内の死体を一人、HPMAXで蘇らせる。",
        targeting: {
            type: "move_range",
            targetCount: "single",
            targetSide: "dead_ally"
        }
    },
    {
        id: 4,
        name: "デッドカンチョー",
        type: "物理",
        power: 0,
        effect: "remove_dead",
        description: "付近の敵の死体を消し去る。以後、生き返らせることはできない。",
        targeting: {
            type: "move_range",
            targetCount: "single",
            targetSide: "dead_enemy"
        }
    },
    {
        id: 5,
        name: "銃チョー",
        type: "特殊",
        power: 100,
        effect: "damage_falloff_by_target_count",
        description: "広範囲の敵に攻撃。対象が多いほど威力が下がる。",
        targeting: {
            type: "move_range",
            targetCount: "all",
            targetSide: "enemy"
        }
    },
    {
        id: 6,
        name: "一刀入魂",
        type: "変化技",
        power: 0,
        effect: "double_power_next_turn",
        description: "次ターンに放つ技の威力が倍になる。",
        targeting: {
            type: "self",
            targetCount: "single",
            targetSide: "self"
        }//
    },
    {
        id: 7,
        name: "ヒールカンチョー",
        type: "変化技",
        power: 70,
        effect: "heal_single_ally",
        description: "対象を回復。",
        targeting: {
            type: "move_range",
            targetCount: "single",
            targetSide: "ally"
        }
    },
    {
        id: 8,
        name: "ドライブカンチョー",
        type: "変化技",
        power: 0,
        effect: "move_buff_all_allies",
        description: "そのターンの間、すべての味方の移動範囲を1上げる。",
        targeting: {
            type: "all_map",
            targetCount: "all",
            targetSide: "ally"
        }
    },
    {
        id: 9,
        name: "時差式カンチョー",
        type: "物理",
        power: 30,
        effect: "damage_plus_true_damage",
        description: "二連で攻撃する。守るやケツ絞めを貫通する。",
        targeting: {
            type: "direction",
            range: 2,
            targetCount: "all",
            targetSide: "enemy"
        }
    },
    {
        id: 10,
        name: "スクリューカンチョー",
        type: "物理",
        power: 60,
        effect: "damage_ignore_defense",
        description: "必ず定数のダメージを与える。",
        targeting: {
            type: "direction",
            range: 2,
            targetCount: "all",
            targetSide: "enemy"
        }
    },
    {
        id: 11,
        name: "ケツ絞め",
        type: "変化技",
        power: 0,
        effect: "guard_next_turn",
        description: "次ターンに受ける技の威力を半減する。",
        targeting: {
            type: "self",
            targetCount: "single",
            targetSide: "self"
        }
    },
    {
        id: 12,
        name: "リベレートカンチョー",
        type: "物理",
        power: 0,
        effect: "equalize_hp_damage",
        description: "相手と自分のHPの差分が威力になる。自分のほうが高い場合失敗する。",
        targeting: {
            type: "direction",
            range: 3,
            targetCount: "all",
            targetSide: "enemy"
        }
    },
    {
        id: 13,
        name: "貫・チョー",
        type: "物理",
        power: 70,
        effect: "damage_falloff_by_target_count",
        description: "前方一列に攻撃。対象が多いほど威力が下がる",
        targeting: {
            type: "direction",
            range: 100,
            targetCount: "all",
            targetSide: "enemy"
        }
    },
    {
        id: 14,
        name: "神風カンチョー",
        power: 999,
        effect: "kamikaze_damage",
        description: "自らを犠牲に、対象へ大ダメージを与える。",
        targeting: {
            type: "move_range",
            targetCount: "all",
            targetSide: "enemy"
        }
    },
    {
        id: 15,
        name: "ジェットカンチョー",
        power: 40,
        effect: "damage_scale_with_move_distance",
        description: "助走をつけた分だけ威力が上がる",
        targeting: {
            type: "direction",
            range: 2,
            targetCount: "all",
            targetSide: "enemy"
        }
    },
    {
        id: 16,
        name: "斬チョー",
        type: "物理",
        power: 70,
        effect: "damage",
        // [FX] 当たった相手のアイコンが真っ二つに割れてずれる演出(battle-fx.js の cleave)
        fx: "cleave",
        /*
         * [攻撃＋移動] 撃った方向へ3マス先に着地する。
         * 3マス先が空いていない方向には撃てない(required の既定は true)。
         * 使える type は battle.js の SKILL_MOVES を参照
         * (land_ahead / step_back / swap_with_target)。
         */
        move: { type: "land_ahead", distance: 3 },
        description: "一閃で相手を真っ二つにし、斬り抜けて3マス先に着地する。3マス先が空いていないと使えない。",
        targeting: {
            type: "direction",
            range: 2,
            targetCount: "all",
            targetSide: "enemy"
        }
    },

];


/*
 * [DB統合 / 保守性]
 * 以前はここに characterSkillsDatabase という
 * 「id → 技ID配列」の別オブジェクトを独立して持っており、
 * どのキャラクターの技構成かは
 *     1: [1, 2, 4, 5], // デスリオン
 * という末尾のコメントだけで人間が目視確認する形になっていた。
 *
 * これだと、
 *   ・characterDatabase側でキャラを追加/削除しても、
 *     characterSkillsDatabase側を直し忘れても気づけない
 *   ・コメントの名前とidがズレても誰も検知できない
 * という「同じキャラクターの情報が2箇所に分裂していて、
 * コメントでしか繋がっていない」状態だった。
 *
 * 技構成(skills)は、以後 characterDatabase の各キャラクター
 * オブジェクトに直接持たせる。characterSkillsDatabase自体は
 * このファイルの下の方で characterDatabase から自動生成しており、
 * window.MONSTER_WAR_DATA.characterSkillsDatabase の形は
 * 今までと完全に同じ（id → 技ID配列）ままなので、
 * これを直接参照している既存の画面（party/script.js等）は
 * 無修正で動くはず。
 */
const characterDatabase = [
    {
        id: 1,
        name: "デスリオン",
        image: "../images/deathrion.png",
        hp: 130,
        attack: 250,
        defense: 100,
        move: 4,
        description: "りおんが我が道往くためにデスカンチョーに堕ちた姿。",
        type: "attacker",
        skills: [1, 2, 4, 5],
        song: "../audio/death.mp3"
    },
    {
        id: 2,
        name: "清武",
        image: "../images/kiyotake.png",
        hp: 150,
        attack: 150,
        defense: 100,
        move: 4,
        description: "争いは好まない穏便派。回復担当。",
        type: "healer",
        skills: [1, 3, 7, 8],
        song: "../audio/kiyotake.mp3"
    },
    {
        id: 3,
        name: "桃子",
        image: "../images/momoko.png",
        hp: 130,
        attack: 150,
        defense: 100,
        move: 4,
        description: "弱っちい。なぜなら女だから。",
        type: "healer",
        skills: [1, 3, 7, 10],
        song: "../audio/momoko.mp3"
    },
    {
        id: 4,
        name: "りおん",
        image: "../images/rion.png",
        hp: 150,
        attack: 200,
        defense: 100,
        move: 5,
        description: "しおんの相棒。素早い。",
        type: "attacker",
        skills: [1, 5, 6, 13],
        song: "../audio/rion.mp3"
    },
    {
        id: 5,
        name: "武",
        image: "../images/takeshi.png",
        hp: 150,
        attack: 170,
        defense: 100,
        move: 4,
        description: "ひょうひょうとしていて様々こなせる。",
        type: "supporter",
        skills: [1, 5, 7, 8],
        song: "../audio/takeshi.mp3"
    },
    {
        id: 6,
        name: "VOLCANO MAN",
        image: "../images/volcano.png",
        hp: 170,
        attack: 100,
        defense: 180,
        move: 3,
        description: "己の御髪を火山にされたバーバーへの怒りで豹変。",
        type: "deffencer",
        skills: [1, 5, 6, 14]
    },
    {
        id: 7,
        name: "割り箸工場のおじさん",
        image: "../images/wariko.png",
        hp: 160,
        attack: 170,
        defense: 80,
        move: 4,
        description: "どんなに足の速い生物でも影から逃れられないように、彼からは誰も...。",
        type: "attacker",
        skills: [1, 5, 6, 13]
    },
    {
        id: 8,
        name: "ゆうな",
        image: "../images/yuuna.png",
        hp: 130,
        attack: 200,
        defense: 60,
        move: 5,
        description: "絶世の醜女",
        type: "attacker",
        skills: [1, 2, 9, 13],
        song: "../audio/yuuna.mp3"
    },
    {
        id: 9,
        name: "そらと",
        image: "../images/sorato.jpg",
        hp: 150,
        attack: 150,
        defense: 150,
        move: 3,
        description: "陰テリ系馬カス",
        type: "supporter",
        skills: [1, 7, 8, 13]
    },
    {
        id: 10,
        name: "しおん",
        image: "../images/shion.png",
        hp: 150,
        attack: 180,
        defense: 120,
        move: 6,
        description: "ニート。",
        type: "attacker",
        skills: [1, 6, 9, 15],
        song: "../audio/shion.mp3"
    },
    {
        id: 11,
        name: "フヂムラメイ",
        image: "../images/mei.png",
        hp: 150,
        attack: 190,
        defense: 100,
        move: 4,
        description: "素性の知れない流浪人。数少ない女性の強者。",
        type: "attacker",
        skills: [1, 5, 9, 11]
    },
    {
        id: 12,
        name: "hasuo",
        image: "../images/hasuo.png",
        hp: 200,
        attack: 150,
        defense: 150,
        move: 2,
        description: "電車の中で弁当を食い始める生粋の関西人。",
        type: "deffencer",
        skills: [1, 2, 5, 10],
        song: "../audio/hasuo.mp3"
    },
    {
        id: 13,
        name: "きよし",
        image: "../images/kiyoshi.png",
        hp: 160,
        attack: 170,
        defense: 150,
        move: 6,
        description: "還暦間近のジジイ。",
        type: "attacker",
        skills: [1, 9, 11, 12],
        song: "../audio/kiyoshi.mp3"
    },
    {
        id: 14,
        name: "大木克幸",
        image: "../images/katsuyuki.png",
        hp: 180,
        attack: 80,
        defense: 180,
        move: 4,
        description: "ドMバイ家畜克幸",
        type: "deffencer",
        skills: [1, 8, 11, 14],
        song: "../audio/katsuyuki.mp3"
    },
    {
        id: 15,
        name: "某ミニマリスト",
        image: "../images/tanuto.png",
        hp: 130,
        attack: 150,
        defense: 100,
        move: 5,
        description: "私が障ガイ者だから差別をしているんだねい！！",
        type: "healer",
        skills: [1, 3, 7, 11]
    },
    {
        id: 16,
        name: "就活ゆうな",
        image: "../images/yuuna2.png",
        hp: 150,
        attack: 250,
        defense: 80,
        move: 5,
        description: "採用されたぞおおおおおおお正社員んんんんんんんん動物看護士の資格生かせるうううううううううううう",
        type: "healer",
        skills: [1, 2, 9, 15],
        song: "../audio/yuuna2.mp3"
    }
];

/*
 * characterDatabase の skills から自動生成する。
 * 手書きの id → 技ID配列 マッピングをここでは一切持たない。
 * window.MONSTER_WAR_DATA.characterSkillsDatabase の形は
 * 以前と同じ（id → 技ID配列のオブジェクト）なので、
 * これを直接参照している既存コードは変更不要。
 */
const characterSkillsDatabase = characterDatabase.reduce(
    (map, character) => {
        map[character.id] = character.skills || [];
        return map;
    },
    {}
);

/*
 * [DB統合 / 保守性]
 * characterSkillsDatabaseと同じ理由・同じやり方で、
 * characterDatabase側の各キャラクターが持つsongフィールドから
 * 自動生成する。以前はここに「id → {path, title}」という
 * 別オブジェクトを独立して持っており、キャラクターを追加/削除しても
 * こちら側を直し忘れて気づけない、という同じ問題を抱えていた。
 *
 * また、titleはほぼ character.name (+「のテーマ」) をそのまま
 * 文字列として複製しているだけだったため、pathだけを持たせれば
 * 十分と判断し廃止した。表示用のラベルが必要な場面
 * (再生開始時のconsole.logなど)は、battle.js側で
 * getCharacter(characterId).name から都度組み立てる。
 *
 * window.MONSTER_WAR_DATA.characterSongDatabase の形は
 * 「id → 曲パス(文字列)」に変わったため、battle.js側の
 * playCharacterSong()もこれに合わせて更新済み。
 * 曲を持たないキャラクター(song未指定)はここに含まれない。
 */
const characterSongDatabase = characterDatabase.reduce(
    (map, character) => {
        if (character.song) {
            map[character.id] = character.song;
        }
        return map;
    },
    {}
);

// totalを自動計算
characterDatabase.forEach(character => {
    character.total =
        character.hp +
        character.attack +
        character.defense;
});

/*
 * ========================================
 * 共通ヘルパー関数
 * ========================================
 *
 * [重複解消]
 * 以前は getCharacter / getSkill / getCharacterSkills が
 * party/script.js と battle/battle.js の両方に
 * ほぼ同じ内容でコピペされており、しかも getSkill だけ
 * id の型変換(Number())の有無が食い違っていました。
 * データと一緒に定義しておくことで、今後は1箇所を直せば
 * 全画面に反映されます。
 */
function getCharacter(id) {
    return characterDatabase.find(
        character => character.id === Number(id)
    );
}

function getSkill(id) {
    return skillDatabase.find(
        skill => skill.id === Number(id)
    );
}

function getCharacterSkills(characterId) {
    const skillIds = characterSkillsDatabase[characterId] || [];

    return skillIds
        .map(id => getSkill(id))
        .filter(Boolean);
}


window.MONSTER_WAR_DATA = {

    characterDatabase,
    skillDatabase,
    characterSkillsDatabase,
    characterSongDatabase

};