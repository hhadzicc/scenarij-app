
const assert = chai.assert;
const expect = chai.expect;

let activeEditorDiv = null;

function setupMockDom(initialContent) {

    const existing = document.getElementById('divEditor');
    if (existing) {
        existing.remove();
    }

    const div = document.createElement('div');
    div.setAttribute('id', 'divEditor');
    div.setAttribute('contenteditable', 'true');
    div.innerHTML = initialContent || '';

    document.body.appendChild(div);
    activeEditorDiv = div;
    return div;
}

afterEach(() => {
    const existing = document.getElementById('divEditor');
    if (existing) {
        existing.remove();
    }
    activeEditorDiv = null;
    execCommandCalled = false;
    lastExecCommand = null;
});

let execCommandCalled = false;
let lastExecCommand = null;

beforeEach(() => {
    execCommandCalled = false;
    lastExecCommand = null;

    document.execCommand = (command, showUI, value) => {
        execCommandCalled = true;
        lastExecCommand = { command, showUI, value };
        return true; 
    };

    
    window.getSelection = () => ({
        rangeCount: 1,
        getRangeAt: () => ({
            commonAncestorContainer: activeEditorDiv || document.body,
            startContainer: activeEditorDiv || document.body,
            endContainer: activeEditorDiv || document.body,
            closest: (selector) => {
                return (activeEditorDiv && activeEditorDiv.matches(selector)) ? activeEditorDiv : null;
            },
            collapsed: false
        }),
        isCollapsed: false, 
        removeAllRanges: () => {},
        addRange: () => {}
    });
});

const mockNoSelection = () => {
    window.getSelection = () => ({ isCollapsed: true, rangeCount: 0 });
};

const mockExternalSelection = () => {
    window.getSelection = () => ({
        isCollapsed: false,
        rangeCount: 1,
        getRangeAt: () => ({
            commonAncestorContainer: {
                nodeName: 'SPAN',
                closest: (selector) => null,
                ownerDocument: document
            }
        }),
    });
};

describe('EditorTeksta Modul', () => {

    // --- 1. CONSTRUCTOR TESTS ---
    describe('Konstruktor', () => {
        let editorDiv;

        beforeEach(() => {
            editorDiv = setupMockDom();
        });

        it('treba baciti izuzetak ako element nije DIV', () => {
            const span = document.createElement('span');
            span.setAttribute('contenteditable', 'true');
            expect(() => EditorTeksta(span)).to.throw("Pogresan tip elementa!");
        });

        it('treba baciti izuzetak ako DIV nema contenteditable atribut', () => {
            editorDiv.removeAttribute('contenteditable');
            expect(() => EditorTeksta(editorDiv)).to.throw("Neispravan DIV, ne posjeduje contenteditable atribut!");
        });

        it('treba kreirati instancu za validan DIV sa contenteditable="true"', () => {
            const editor = EditorTeksta(editorDiv);
            expect(editor).to.be.an('object');
            expect(editor).to.have.property('dajBrojRijeci');
        });
    });

    // --- 2. dajBrojRijeci() TESTS ---
    describe('dajBrojRijeci()', () => {
        let editorDiv;
        let editor;

        beforeEach(() => {
            editorDiv = setupMockDom();
        });

        it('treba taÄno prebrojati rijeÄi razdvojene razmakom i interpunkcijom', () => {
            // Spec: "RijeÄ - cjelina teksta razdvojena razmakom ili znakovima interpunkcije"
            // "Ovo,je.tekst" -> Ovo, je, tekst (3 rijeÄi)
            editorDiv.innerHTML = "Ovo,je.tekst"; 
            editor = EditorTeksta(editorDiv);
            const res = editor.dajBrojRijeci();
            assert.equal(res.ukupno, 3, 'Zarez i taÄka trebaju razdvajati rijeÄi.');
        });

        it('treba tretirati crtice i apostrofe UNUTAR rijeÄi kao dio rijeÄi', () => {
            // Spec: "crtica i apostrof unutar rijeÄi tretiraju se kao dio te rijeÄi"
            editorDiv.innerHTML = "To-je to. Don't stop."; 
            editor = EditorTeksta(editorDiv);
            const res = editor.dajBrojRijeci();
            // To-je (1), to (1), Don't (1), stop (1) -> Total 4
            assert.equal(res.ukupno, 4, 'Crtice i apostrofi unutar rijeÄi se ne smiju tretirati kao separatori.');
        });

        it('ne smije brojati brojeve i samostalne interpunkcijske znakove', () => {
            // Spec: "Brojevi, samostalni interpunkcijski znakovi... ne smatraju se rijeÄima"
            editorDiv.innerHTML = "RijeÄ 123 45.6 ! ?"; 
            editor = EditorTeksta(editorDiv);
            const res = editor.dajBrojRijeci();
            // RijeÄ (1). 123 (0), 45.6 (0), ! (0), ? (0) -> Total 1
            assert.equal(res.ukupno, 1, 'Brojevi i samostalni znakovi se ne smiju brojati.');
        });

        it('treba brojati formatirane rijeÄi (bold/italic)', () => {                     
            editorDiv.innerHTML = "<b>Bold</b> <i>Italic</i> Obicna";
            editor = EditorTeksta(editorDiv);
            assert.deepEqual(editor.dajBrojRijeci(), { ukupno: 3, boldiranih: 1, italic: 1 });
        });
    });

    // --- 3. dajUloge() TESTS ---
    describe('dajUloge()', () => {
        let editorDiv;
        let editor;

        beforeEach(() => {
            editorDiv = setupMockDom();
        });

        it('treba vratiti listu uloga (SVE VELIKA SLOVA) praÄ‡enih govorom', () => {
            // Spec: "iskljuÄivo velikim slovima, bez drugih znakova (brojeva, interpunkcije)"
            // "odmah ispod te linije mora postojati najmanje jedna linija obiÄan govor"
            editorDiv.innerHTML = `
                INT. - DAY
                
                MARKO
                Pozdrav svima.
                
                IVAN
                I tebi pozdrav.
                
                GLAS IZ POZADINE
                (Å¡apat)
                Jeste li tu?
                
                MARKO
                Tu sam.
            `.replace(/\n/g, '<br>');
            editor = EditorTeksta(editorDiv);
            const uloge = editor.dajUloge();
            // MARKO, IVAN, GLAS IZ POZADINE. (Marko se ne ponavlja)
            assert.deepEqual(uloge, ['MARKO', 'IVAN', 'GLAS IZ POZADINE']);
        });

        it('ne smije prihvatiti uloge sa brojevima ili interpunkcijom', () => {
            editorDiv.innerHTML = `
                R2D2
                Bip bop.
                
                DR. HOUSE
                Lupus?
                
                PRAVA ULOGA
                Tekst.
            `.replace(/\n/g, '<br>');
            editor = EditorTeksta(editorDiv);
            const uloge = editor.dajUloge();
            // R2D2 ima broj. DR. HOUSE ima taÄku. 
            // Samo PRAVA ULOGA je validna.
            assert.deepEqual(uloge, ['PRAVA ULOGA']);
        });

        it('ne smije prihvatiti ulogu ako nema govora ispod nje', () => {
            editorDiv.innerHTML = `
                SAMO NAZIV
                
                DRUGI NAZIV
                (samo scenska napomena u zagradi, ne racuna se kao govor)
                
                TRECI
                Ovo je govor.
            `.replace(/\n/g, '<br>');
            editor = EditorTeksta(editorDiv);
            const uloge = editor.dajUloge();
            assert.deepEqual(uloge, ['TRECI']);
        });
    });

    // --- 4. pogresnaUloga() TESTS ---
    describe('pogresnaUloga()', () => {
        let editorDiv;
        let editor;

        beforeEach(() => {
            editorDiv = setupMockDom();
        });

        it('treba detektovati greÅ¡ku u kucanju za kratke uloge (len <= 5, diff 1)', () => {
            editorDiv.innerHTML = `
                ANA
                Text.
                ANA
                Text.
                ANA
                Text.
                ANA
                Text.
                
                ENA
                Text.
            `.replace(/\n/g, '<br>');
            editor = EditorTeksta(editorDiv);
            assert.deepEqual(editor.pogresnaUloga(), ['ENA']);
        });

        it('treba detektovati greÅ¡ku u kucanju za duge uloge (len > 5, diff <= 2)', () => {
            editorDiv.innerHTML = `
                TEODORA
                Text.
                TEODORA
                Text.
                TEODORA
                Text.
                TEODORA
                Text.
                TEODORA
                Text.
                
                TEODOR
                Text.
            `.replace(/\n/g, '<br>');
            editor = EditorTeksta(editorDiv);
            assert.deepEqual(editor.pogresnaUloga(), ['TEODOR']);
        });

        it('ne smije detektovati greÅ¡ku ako frekvencija nije dovoljno razliÄita', () => {
            editorDiv.innerHTML = `
                ANA
                Text.
                ANA
                Text.
                ANA
                Text.
                ENA
                Text.
            `.replace(/\n/g, '<br>');
            editor = EditorTeksta(editorDiv);
            assert.deepEqual(editor.pogresnaUloga(), []);
        });
    });

    // --- 5. brojLinijaTeksta(uloga) TESTS ---
    describe('brojLinijaTeksta(uloga)', () => {
        let editorDiv;
        let editor;

        beforeEach(() => {
            editorDiv = setupMockDom();
        });

        it('treba brojati linije govora, ignoriÅ¡uÄ‡i prazne i zagrade', () => {
            editorDiv.innerHTML = `
                MARKO
                Linija jedan.
                (scenska napomena)
                Linija dva.
                
                MARKO
                Linija tri.
                (pauza)
                
                IVAN
                Nesto.
            `.replace(/\n/g, '<br>');
            editor = EditorTeksta(editorDiv);
            // MARKO: Linija jedan, Linija dva, Linija tri. (3 linije)
            // "(scenska napomena)" i "(pauza)" se ignorisu jer su cijele u zagradi.
            assert.equal(editor.brojLinijaTeksta('MARKO'), 3);
        });
        
        it('treba brojati liniju koja sadrÅ¾i zagrade ali i tekst', () => {
             editorDiv.innerHTML = `
                MARKO
                (tiho) Ovo se racuna.
            `.replace(/\n/g, '<br>');
            editor = EditorTeksta(editorDiv);
            assert.equal(editor.brojLinijaTeksta('MARKO'), 1);
        });
    });

    // --- 6. scenarijUloge(uloga) TESTS ---
    describe('scenarijUloge(uloga)', () => {
        let editorDiv;
        let editor;
        
        const script = `
            INT. - DAY
            
            ANA
            Bok.
            
            IVAN
            Zdravo.
            
            ANA
            Kako si?
            
            EXT. - DAY
            
            ANA
            Lijepo vrijeme.
        `.replace(/\n/g, '<br>');

        beforeEach(() => {
            editorDiv = setupMockDom(script);
            editor = EditorTeksta(editorDiv);
        });

        it('treba vratiti ispravne objekte scenarija', () => {
            const res = editor.scenarijUloge('ANA');
            console.log(res);
            // Ana se pojavljuje 3 puta (2 puta u SOBA, 1 u VRT)
            assert.equal(res.length, 3);
            
            // Prvo pojavljivanje
            assert.equal(res[0].scena, 'INT. - DAY');
            assert.equal(res[0].pozicijaUTekstu, 1);
            assert.isNull(res[0].prethodni);
            assert.equal(res[0].sljedeci.uloga, 'IVAN');
            
            // Drugo pojavljivanje
            assert.equal(res[1].scena, 'INT. - DAY');
            assert.equal(res[1].pozicijaUTekstu, 3);
            assert.equal(res[1].prethodni.uloga, 'IVAN');
            
            // TreÄ‡e pojavljivanje (nova scena)
            assert.equal(res[2].scena, 'EXT. - DAY');
            assert.equal(res[2].pozicijaUTekstu, 1); // BrojaÄ ide od 1 jer je nova scena
            assert.isNull(res[2].prethodni); //Nema ranijeg govora u ovoj sceni
        });
    });

    // --- 7. grupisiUloge() TESTS ---
    describe('grupisiUloge()', () => {
        let editorDiv;
        let editor;

        beforeEach(() => {
            editorDiv = setupMockDom();
        });

        it('treba grupisati uloge po scenama i segmentima (prekid na AKCIJU)', () => {
            editorDiv.innerHTML = `
                INT. - DAY
                
                A
                Text.
                
                B
                Text.
                
                AKCIJA PREKIDA
                
                C
                Text.
                
                INT. - NIGHT
                
                A
                Text.
            `.replace(/\n/g, '<br>');
            editor = EditorTeksta(editorDiv);
            const grupe = editor.grupisiUloge();
            console.log(grupe);
            // Ocekujemo 3 grupe:
            // 1. SCENA 1, Segment 1: [A, B]
            // 2. SCENA 1, Segment 2: [C]
            // 3. SCENA 2, Segment 1: [A]
            
            assert.equal(grupe.length, 3);
            
            assert.equal(grupe[0].scena, 'INT. - DAY');
            assert.deepEqual(grupe[0].uloge, ['A', 'B']);
            
            assert.equal(grupe[1].scena, 'INT. - DAY');
            assert.deepEqual(grupe[1].uloge, ['C']);
            
            assert.equal(grupe[2].scena, 'INT. - NIGHT');
            assert.deepEqual(grupe[2].uloge, ['A']);
        });
    });

    // --- 8. formatirajTekst() TESTS ---
    describe('formatirajTekst()', () => {
        let editorDiv;
        let editor;

        beforeEach(() => {
            editorDiv = setupMockDom("Test content");
            editor = EditorTeksta(editorDiv);
        });

        it('treba pozvati execCommand sa ispravnim parametrima za validnu komandu', () => {
            const success = editor.formatirajTekst('bold');
            expect(success).to.be.true;
            expect(execCommandCalled).to.be.true;
            expect(lastExecCommand.command).to.equal('bold');
        });

        it('treba vratiti false za nevalidnu komandu', () => {
            const success = editor.formatirajTekst('delete'); // Nije u specifikaciji (samo bold/italic/underline)
            expect(success).to.be.false;
            expect(execCommandCalled).to.be.false;
        });

        it('treba vratiti false ako nema selekcije', () => {
            mockNoSelection();
            const success = editor.formatirajTekst('bold');
            expect(success).to.be.false;
        });
    });
});