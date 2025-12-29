document.addEventListener("DOMContentLoaded", function () {

    let divEditor = document.getElementById("divEditor");
    let divPoruke = document.getElementById("poruke");

    let editor;
    try {
        editor = EditorTeksta(divEditor);
    } catch (e) {
        divPoruke.style.display = "block";
        divPoruke.innerText = "Greška pri inicijalizaciji: " + e.message;
        return;
    }

    function prikaziPoruku(tekst) {
        divPoruke.style.display = "block";
        if (typeof tekst === "object") {
            divPoruke.innerText = JSON.stringify(tekst, null, 2);
        } else {
            divPoruke.innerText = tekst;
        }
    }

    // ===== FORMATIRANJE =====
    document.getElementById("btnBold").addEventListener("click", () => {
        editor.formatirajTekst("bold");
    });

    document.getElementById("btnItalic").addEventListener("click", () => {
        editor.formatirajTekst("italic");
    });

    document.getElementById("btnUnderline").addEventListener("click", () => {
        editor.formatirajTekst("underline");
    });

    // ===== STATISTIKA =====
    document.getElementById("btnBrojRijeci").addEventListener("click", function () {
        let stats = editor.dajBrojRijeci();
        prikaziPoruku(`Ukupno: ${stats.ukupno}, Bold: ${stats.boldiranih}, Italic: ${stats.italic}`);
    });

    document.getElementById("btnUloge").addEventListener("click", function () {
        prikaziPoruku(editor.dajUloge());
    });

    document.getElementById("btnPogresnaUloga").addEventListener("click", function () {
        let greske = editor.pogresnaUloga();
        prikaziPoruku(greske.length ? greske : "Nema pogrešnih uloga");
    });

    document.getElementById("btnGrupisiUloge").addEventListener("click", function () {
        prikaziPoruku(editor.grupisiUloge());
    });

    // ===== INTERAKCIJA SA ULOGAMA =====
    document.getElementById("btnBrojLinija").addEventListener("click", function () {
        let u = prompt("Unesite ime uloge:");
        if (u === null) return;
        prikaziPoruku(editor.brojLinijaTeksta(u));
    });

    document.getElementById("btnScenarijUloge").addEventListener("click", function () {
        let u = prompt("Unesite ime uloge:");
        if (u === null) return;
        prikaziPoruku(editor.scenarijUloge(u));
    });

    // Globalno izlaganje radi eventualnog pozivanja iz konzole
    window.editor = editor;

    // ======================= SPIRALA 3 =======================
    let pollingTimer = null;
    let lastSince = 0;

    function scenarioToEditorText(scenario) {
        if (!scenario || !Array.isArray(scenario.content)) return "";
        // najjednostavniji prikaz: [lineId] text
        // koristi innerText -> neće razbiti EditorTeksta parsiranje
        return scenario.content.map(l => `[${l.lineId}] ${l.text}`).join("\n");
    }

    function refreshScenario() {
        const scenarioId = Number(document.getElementById("inpScenarioId").value);

        PoziviAjax.getScenario(scenarioId, (status, data) => {
            prikaziPoruku({ status, data });

            if (status === 200) {
                divEditor.innerText = scenarioToEditorText(data);
            }
        });
    }

    function startPolling() {
        const scenarioId = Number(document.getElementById("inpScenarioId").value);

        if (pollingTimer) clearInterval(pollingTimer);

        pollingTimer = setInterval(() => {
            PoziviAjax.getDeltas(scenarioId, lastSince, (status, data) => {
                if (status !== 200) return;

                const deltas = data?.deltas || [];
                if (deltas.length === 0) return;

                for (const d of deltas) {
                    const ts = Number(d.timestamp) || 0;
                    if (ts > lastSince) lastSince = ts;
                }

                // robustno: uvijek ponovo ucitaj scenario
                refreshScenario();
            });
        }, 3000);
    }

    // Dugmad iz HTML-a
    const btnLoadScenario = document.getElementById("btnLoadScenario");
    const btnCreateScenario = document.getElementById("btnCreateScenario");
    const btnLockLine = document.getElementById("btnLockLine");
    const btnUpdateLine = document.getElementById("btnUpdateLine");
    const btnLockChar = document.getElementById("btnLockChar");
    const btnUpdateChar = document.getElementById("btnUpdateChar");

    if (btnLoadScenario) {
        btnLoadScenario.addEventListener("click", () => {
            lastSince = 0;
            refreshScenario();
            startPolling();
        });
    }

    if (btnCreateScenario) {
        btnCreateScenario.addEventListener("click", () => {
            const title = prompt("Naslov scenarija (prazno = Neimenovani scenarij):") ?? "";
            PoziviAjax.postScenario(title, (status, data) => {
                prikaziPoruku({ status, data });

                if (status === 200) {
                    document.getElementById("inpScenarioId").value = data.id;
                    divEditor.innerText = scenarioToEditorText(data);
                    lastSince = 0;
                    startPolling();
                }
            });
        });
    }

    if (btnLockLine) {
        btnLockLine.addEventListener("click", () => {
            const scenarioId = Number(document.getElementById("inpScenarioId").value);
            const userId = Number(document.getElementById("inpUserId").value);
            const lineId = Number(document.getElementById("inpLineId").value);

            PoziviAjax.lockLine(scenarioId, lineId, userId, (status, data) => {
                prikaziPoruku({ status, data });
            });
        });
    }

    if (btnUpdateLine) {
        btnUpdateLine.addEventListener("click", () => {
            const scenarioId = Number(document.getElementById("inpScenarioId").value);
            const userId = Number(document.getElementById("inpUserId").value);
            const lineId = Number(document.getElementById("inpLineId").value);

            const txt = prompt('Unesi novi tekst (šalje se kao newText: ["..."]):');
            if (txt === null) return;

            PoziviAjax.updateLine(scenarioId, lineId, userId, [txt], (status, data) => {
                prikaziPoruku({ status, data });
                if (status === 200) refreshScenario();
            });
        });
    }

    if (btnLockChar) {
        btnLockChar.addEventListener("click", () => {
            const scenarioId = Number(document.getElementById("inpScenarioId").value);
            const userId = Number(document.getElementById("inpUserId").value);
            const oldName = String(document.getElementById("inpCharOld").value || "");

            PoziviAjax.lockCharacter(scenarioId, oldName, userId, (status, data) => {
                prikaziPoruku({ status, data });
            });
        });
    }

    if (btnUpdateChar) {
        btnUpdateChar.addEventListener("click", () => {
            const scenarioId = Number(document.getElementById("inpScenarioId").value);
            const userId = Number(document.getElementById("inpUserId").value);
            const oldName = String(document.getElementById("inpCharOld").value || "");
            const newName = String(document.getElementById("inpCharNew").value || "");

            PoziviAjax.updateCharacter(scenarioId, userId, oldName, newName, (status, data) => {
                prikaziPoruku({ status, data });
                if (status === 200) refreshScenario();
            });
        });
    }
	function stripLinePrefix(s) {
  return String(s ?? "").replace(/^\s*\[\s*\d+\s*\]\s*/, "");
}




    // (Opcionalno) --automatski ucitaj scenario 1 kad se stranica otvori
    if (btnLoadScenario) btnLoadScenario.click();
    // ===================== END S3 =====================
});
