let EditorTeksta = function (divRef) {

    if (!divRef || divRef.tagName !== 'DIV') {
        throw new Error("Pogresan tip elementa!");
    }

    if (divRef.getAttribute('contenteditable') !== 'true') {
        throw new Error("Neispravan DIV, ne posjeduje contenteditable atribut!");
    }

    const parsirajLinije = () => {
        let rawText = divRef.innerText || "";
        return rawText.split(/\r?\n/);
    };

    const isSceneHeading = (line) => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        if (!(trimmed.startsWith("INT.") || trimmed.startsWith("EXT."))) return false;

        const timeRegex = /-\s+(DAY|NIGHT|AFTERNOON|MORNING|EVENING)\s*$/;
        return trimmed === trimmed.toUpperCase() && timeRegex.test(trimmed);
    };

    const isParenthetical = (line) => {
        let trimmed = line.trim();
        return trimmed.startsWith("(") && trimmed.endsWith(")");
    };

    const isRoleFormat = (line) => {
        let trimmed = line.trim();
        if (!trimmed) return false;

        const roleRegex = /^[A-ZČĆŽŠĐ]+(\s+[A-ZČĆŽŠĐ]+)*$/;
        if (!roleRegex.test(trimmed)) return false;

        if (!/[A-ZČĆŽŠĐ]/.test(trimmed)) return false;

        if (isSceneHeading(line)) return false;

        return true;
    };

    const analizirajStrukturu = () => {
        const lines = parsirajLinije();
        const structure = [];

        for (let i = 0; i < lines.length; i++) {
            let raw = lines[i];
            let line = raw.trim();
            let type = "unknown";

            if (line === "") {
                type = "empty";
            } else if (isSceneHeading(line)) {
                type = "sceneHeading";
            } else if (isParenthetical(line)) {
                type = "parenthetical";
            } else if (isRoleFormat(line)) {
                let isRoleContext = false;

                for (let j = i + 1; j < lines.length; j++) {
                    let nextLine = lines[j];
                    let nextTrimmed = nextLine.trim();

                    if (nextTrimmed === "") continue;
                    if (isParenthetical(nextLine)) continue;

                    if (nextTrimmed === nextTrimmed.toUpperCase() || isSceneHeading(nextLine)) {
                        isRoleContext = false;
                    } else {
                        isRoleContext = true;
                    }
                    break;
                }

                if (isRoleContext) type = "role";
                else type = "action";
            } else {
                type = "text";
            }

            structure.push({
                original: raw,
                content: line,
                type,
                index: i
            });
        }

        let currentRole = null;

        for (let i = 0; i < structure.length; i++) {
            let s = structure[i];

            if (s.type === "sceneHeading") {
                currentRole = null;
            } else if (s.type === "role") {
                currentRole = s.content;
            } else if (s.type === "text") {
                if (currentRole) {
                    s.type = "speech";
                    s.role = currentRole;
                } else {
                    s.type = "action";
                }
            } else if (s.type === "parenthetical") {
            } else if (s.type === "empty") {
                currentRole = null;
            }
        }

        return structure;
    };



    const izgradiBlokove = () => {
        const structure = analizirajStrukturu();

        let blocks = [];
        let sceneCounters = {};
        let scenesOrder = [];
        let currentScene = "SCENA BEZ NASLOVA";
        let lastSigType = null;

        const ensureScene = (title) => {
            if (!sceneCounters[title]) {
                sceneCounters[title] = { replikaCounter: 0, segmentCounter: 0 };
                scenesOrder.push(title);
            }
        };

        ensureScene(currentScene);
        let currentBlock = null;
        let currentRole = null;

        for (let i = 0; i < structure.length; i++) {
            let s = structure[i];

            switch (s.type) {
                case "sceneHeading":
                    currentScene = s.content;
                    ensureScene(currentScene);
                    currentBlock = null;
                    currentRole = null;
                    lastSigType = "sceneHeading";
                    break;

                case "role": {
                    ensureScene(currentScene);
                    let counters = sceneCounters[currentScene];

                    if (currentRole === s.content && blocks.length > 0 && currentBlock === blocks[blocks.length - 1]) {
                        lastSigType = "role";
                        break;
                    }

                    if (
                        lastSigType === null ||
                        lastSigType === "sceneHeading" ||
                        lastSigType === "action"
                    ) {
                        counters.segmentCounter += 1;
                    }

                    counters.replikaCounter += 1;

                    currentBlock = {
                        scene: currentScene,
                        role: s.content,
                        lines: [],
                        sceneReplikaIndex: counters.replikaCounter,
                        segmentIndex: counters.segmentCounter
                    };
                    blocks.push(currentBlock);
                    currentRole = s.content;
                    lastSigType = "role";
                    break;
                }

                case "speech":
                    if (currentBlock) {
                        currentBlock.lines.push(s.content);
                        currentRole = s.role || currentBlock.role;
                        lastSigType = "speech";
                    } else {
                        lastSigType = "action";
                        currentRole = null;
                    }
                    break;

                case "parenthetical":
                    break;

                case "action":
                    currentBlock = null;
                    currentRole = null;
                    lastSigType = "action";
                    break;

                case "empty":
                    currentBlock = null;
                    currentRole = null;
                    break;

                default:
                    break;
            }
        }

        return {
            blocks,
            structure,
            scenesOrder,
            sceneCounters
        };
    };



    let dajBrojRijeci = function () {
        let charStyles = [];

        const traverse = (node, styles) => {
            if (node.nodeType === 3) {
                for (let ch of node.nodeValue) {
                    charStyles.push({ char: ch, styles: [...styles] });
                }
            } else if (node.nodeType === 1) {
                let newStyles = [...styles];
                let tag = node.tagName.toUpperCase();

                if (tag === "B" || tag === "STRONG") newStyles.push("B");
                if (tag === "I" || tag === "EM") newStyles.push("I");

                node.childNodes.forEach(ch => traverse(ch, newStyles));

                if (tag === "BR" || tag === "DIV" || tag === "P") {
                    charStyles.push({ char: " ", styles: [] });
                }
            }
        };

        traverse(divRef, []);

        const hasLetter = (txt) => /[A-Za-zČĆŽŠĐčćžšđ]/.test(txt);

        const isSeparator = (ch) => {
            return /[ \t\r\n,.]/.test(ch);
        };

        let words = [];
        let current = { text: "", styles: [] };

        for (let cs of charStyles) {
            if (!isSeparator(cs.char)) {
                current.text += cs.char;
                current.styles.push(cs.styles);
            } else {
                if (current.text && hasLetter(current.text)) {
                    words.push(current);
                }
                current = { text: "", styles: [] };
            }
        }
        if (current.text && hasLetter(current.text)) {
            words.push(current);
        }

        let total = words.length;

        let bold = words.filter(w =>
            w.styles.length > 0 && w.styles.every(s => s.includes("B"))
        ).length;

        let italic = words.filter(w =>
            w.styles.length > 0 && w.styles.every(s => s.includes("I"))
        ).length;

        return {
            ukupno: total,
            boldiranih: bold,
            italic: italic
        };
    };

    let dajUloge = function () {
        const structure = analizirajStrukturu();
        let set = new Set();

        structure.forEach(s => {
            if (s.type === "role") {
                if (!set.has(s.content)) {
                    set.add(s.content);
                }
            }
        });

        return [...set];
    };

    let pogresnaUloga = function () {
        const structure = analizirajStrukturu();
        let counts = {};

        structure.forEach(s => {
            if (s.type === "role") {
                counts[s.content] = (counts[s.content] || 0) + 1;
            }
        });

        const uloge = Object.keys(counts);

        const dist = (a, b) => {
            const dp = Array(b.length + 1)
                .fill(null)
                .map(() => Array(a.length + 1).fill(0));

            for (let i = 0; i <= b.length; i++) dp[i][0] = i;
            for (let j = 0; j <= a.length; j++) dp[0][j] = j;

            for (let i = 1; i <= b.length; i++) {
                for (let j = 1; j <= a.length; j++) {
                    dp[i][j] =
                        b[i - 1] === a[j - 1]
                            ? dp[i - 1][j - 1]
                            : 1 + Math.min(
                                dp[i - 1][j],
                                dp[i][j - 1],
                                dp[i - 1][j - 1]
                              );
                }
            }
            return dp[b.length][a.length];
        };

        let greske = new Set();

        for (let i = 0; i < uloge.length; i++) {
            for (let j = 0; j < uloge.length; j++) {
                if (i === j) continue;

                let A = uloge[i];
                let B = uloge[j];

                let limit = (A.length > 5 && B.length > 5) ? 2 : 1;

                if (dist(A, B) <= limit) {
                    if (counts[B] >= 4 && counts[B] >= counts[A] + 3) {
                        greske.add(A);
                    }
                }
            }
        }

        return [...greske];
    };



    let brojLinijaTeksta = function (uloga) {
        if (!uloga) return 0;
      
        const { blocks } = izgradiBlokove();

        let total = 0;
        blocks.forEach(b => {
            if (b.role === uloga) {
                total += b.lines.length;
            }
        });

        return total;
    };

    let scenarijUloge = function (uloga) {
        if (!uloga) return [];
    
        const { blocks } = izgradiBlokove();
        let rezultat = [];

        for (let i = 0; i < blocks.length; i++) {
            let b = blocks[i];
            if (b.role !== uloga) continue;

            let prevBlock = null;
            if (i - 1 >= 0) {
                let pb = blocks[i - 1];
                if (pb.scene === b.scene && pb.segmentIndex === b.segmentIndex) {
                    prevBlock = pb;
                }
            }

            let nextBlock = null;
            if (i + 1 < blocks.length) {
                let nb = blocks[i + 1];
                if (nb.scene === b.scene && nb.segmentIndex === b.segmentIndex) {
                    nextBlock = nb;
                }
            }

            rezultat.push({
                scena: b.scene,
                pozicijaUTekstu: b.sceneReplikaIndex,
                prethodni: prevBlock ? {
                    uloga: prevBlock.role,
                    linije: [...prevBlock.lines]
                } : null,
                trenutni: {
                    uloga: b.role,
                    linije: [...b.lines]
                },
                sljedeci: nextBlock ? {
                    uloga: nextBlock.role,
                    linije: [...nextBlock.lines]
                } : null
            });
        }

        return rezultat;
    };

    let grupisiUloge = function () {
        const { blocks, scenesOrder } = izgradiBlokove();

        let mapa = {};
        let rezultat = [];

        blocks.forEach(b => {
            if (!mapa[b.scene]) mapa[b.scene] = {};
            if (!mapa[b.scene][b.segmentIndex]) mapa[b.scene][b.segmentIndex] = [];

            let lista = mapa[b.scene][b.segmentIndex];
            if (!lista.includes(b.role)) {
                lista.push(b.role);
            }
        });

        scenesOrder.forEach(sceneTitle => {
            const segs = mapa[sceneTitle];
            if (!segs) return;

            const segmentKeys = Object.keys(segs)
                .map(x => parseInt(x, 10))
                .sort((a, b) => a - b);

            segmentKeys.forEach(segNum => {
                rezultat.push({
                    scena: sceneTitle,
                    segment: segNum,
                    uloge: segs[segNum]
                });
            });
        });

        return rezultat;
    };

    let formatirajTekst = function (komanda) {
 
        return false;
    };

    return {
        dajBrojRijeci,
        dajUloge,
        pogresnaUloga,
        brojLinijaTeksta,
        scenarijUloge,
        grupisiUloge,
        formatirajTekst
    };
};
