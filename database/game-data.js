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
        description: "当たれば確実に相手を殺せるが、範囲が狭いうえに命中しにくい。",
        targeting: {
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
        power: 50,
        effect: "damage",
        description: "広範囲の敵に攻撃。必ず命中する。",
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
        }
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
        name: "コンスタンチョー",
        type: "物理",
        power: 50,
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
        /*
         * [重複IDバグ修正]
         * 元データではこの技も id: 1 になっており、
         * 先頭の「カンチョー」(id:1)と衝突していました。
         * getSkill()はArray.find()で最初に見つかった方（カンチョー）を
         * 返すため、この「貫・チョー」はどのキャラクターにも
         * 割り当てようがない状態でした（デッドコード化していました）。
         * 未使用のID 13を新たに割り当てています。
         *
         * まだどのキャラクターのcharacterSkillsDatabaseにも
         * 追加していません。使わせたいキャラクターが決まったら
         * characterSkillsDatabase側にIDを追加してください。
         */
        id: 13,
        name: "貫・チョー",
        type: "物理",
        power: 80,
        effect: "damage_falloff_by_target_count",
        description: "前方一列に攻撃。対象が多いほど威力が下がる",
        targeting: {
            type: "direction",
            range: 100,
            targetCount: "all",
            targetSide: "enemy"
        }
    }
];


const characterSkillsDatabase = {
    1: [1, 2, 4, 5], // デスリオン
    2: [1, 3, 7, 8], // 清武
    3: [1, 3, 7, 10], // 桃子
    4: [1, 5, 6, 7], // りおん
    5: [1, 5, 7, 8], // 武
    6: [1, 5, 6, 11], // VOLCANO MAN
    7: [1, 5, 6, 9], // 割り箸工場のおじさん
    8: [1, 2, 9, 12], // ゆうな
    9: [1, 7, 8, 9], // そらと
    10: [1, 6, 9, 10], // しおん
    11: [1, 5, 9, 11], // フヂムラメイ
    12: [1, 2, 5, 10], // hasuo
    13: [1, 9, 11, 12], // きよし
    14: [1, 8, 10, 11], // 大木克幸
    15: [1, 3, 7, 11] // 某ミニマリスト
};


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
        type: "attacker"
    },
    {
        id: 2,
        name: "清武",
        image: "../images/kiyotake.png",
        hp: 150,
        attack: 150,
        defense: 100,
        move: 3,
        description: "争いは好まない穏便派。回復担当。",
        type: "healer"
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
        type: "healer"
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
        type: "attacker"
    },
    {
        id: 5,
        name: "武",
        image: "../images/takeshi.png",
        hp: 150,
        attack: 170,
        defense: 100,
        move: 3,
        description: "ひょうひょうとしていて様々こなせる。",
        type: "supporter"
    },
    {
        id: 6,
        name: "VOLCANO MAN",
        image: "../images/volcano.png",
        hp: 170,
        attack: 100,
        defense: 180,
        move: 2,
        description: "己の御髪を火山にされたバーバーへの怒りで豹変。",
        type: "deffencer"
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
        type: "attacker"
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
        type: "attacker"
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
        type: "supporter"
    },
    {
        id: 10,
        name: "しおん",
        image: "../images/shion.png",
        hp: 150,
        attack: 180,
        defense: 120,
        move: 20,
        description: "ニート。",
        type: "attacker"
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
        type: "attacker"
    },
    {
        id: 12,
        name: "hasuo",
        image: "../images/hasuo.png",
        hp: 200,
        attack: 150,
        defense: 150,
        move: 1,
        description: "電車の中で弁当を食い始める生粋の関西人。",
        type: "deffencer"
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
        type: "attacker"
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
        type: "deffencer"
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
        type: "healer"
    }
];

const characterSongDatabase = {
    1: {
        path: "../audio/death.mp3",
        title: "デスリオン"
    },

    2: {
        path: "../audio/kiyotake.mp3",
        title: "清武のテーマ"
    },

    3: {
        path: "../audio/momoko.mp3",
        title: "桃子のテーマ"
    },

    4: {
        path: "../audio/rion.mp3",
        title: "りおんのテーマ"
    },

    5: {
        path: "../audio/takeshi.mp3",
        title: "武のテーマ"
    },

    8: {
        path: "../audio/yuuna.mp3",
        title: "ゆうなのテーマ"
    },

    10: {
        path: "../audio/shion.mp3",
        title: "しおん"
    },

    12: {
        path: "../audio/hasuo.mp3",
        title: "hasuoのテーマ"
    },

    13: {
        path: "../audio/kiyoshi.mp3",
        title: "きよしのテーマ"
    }
};

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