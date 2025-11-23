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
});
