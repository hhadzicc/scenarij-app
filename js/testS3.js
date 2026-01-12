const request = require('supertest');
const expect = require('chai').expect;
const API_URL = "http://localhost:3000";

describe('Napredni Testovi - Spirala 3 API', () => {
    const scenarioId = 1;
    const userId1 = 1;
    const userId2 = 2;

    
    it('treba automatski otključati prethodnu liniju ako korisnik zaključa novu (globalno zaključavanje)', async () => {
        // Korisnik 1 zaključava liniju 1
        await request(API_URL)
            .post(`/api/scenarios/${scenarioId}/lines/1/lock`)
            .send({ userId: userId1 });

        // Korisnik 1 zaključava liniju 2. Prethodna (linija 1) bi trebala biti otključana 
        await request(API_URL)
            .post(`/api/scenarios/${scenarioId}/lines/2/lock`)
            .send({ userId: userId1 });

        // Sada Korisnik 2 treba moći zaključati liniju 1 jer ju je Korisnik 1 "napustio" 
        const res = await request(API_URL)
            .post(`/api/scenarios/${scenarioId}/lines/1/lock`)
            .send({ userId: userId2 });

        expect(res.status).to.equal(200);
        expect(res.body.message).to.contain("uspjesno");
    });

    
    it('treba prelomiti 45 riječi u tačno 3 linije (20+20+5 riječi)', async () => {
        // Generišemo tačno 45 riječi
        const fortyFiveWords = Array(45).fill("riječ").join(" ");
        
        // Prvo zaključamo liniju 
        await request(API_URL)
            .post(`/api/scenarios/${scenarioId}/lines/3/lock`)
            .send({ userId: userId1 });

        // Ažuriramo liniju sa dugim tekstom 
        await request(API_URL)
            .put(`/api/scenarios/${scenarioId}/lines/3`)
            .send({ 
                userId: userId1, 
                newText: [fortyFiveWords] 
            });

        // Dobavljamo scenario i provjeravamo strukturu 
        const res = await request(API_URL).get(`/api/scenarios/${scenarioId}`);
        const content = res.body.content;

        // Provjeravamo da li su dodane nove linije zbog prelamanja 
        // Originalna linija 3 je postala 3 linije
        const line3 = content.find(l => l.lineId === 3);
        const nextLine = content.find(l => l.lineId === line3.nextLineId);
        
        expect(line3.text.split(" ").length).to.equal(20);
        expect(nextLine.text.split(" ").length).to.equal(20); 
    });

    
    it('treba promijeniti ime lika pazeći na velika/mala slova (case-sensitive)', async () => {
        const oldName = "ALICE";
        const newName = "ALICIA";

        // Zaključavamo ime
        await request(API_URL)
            .post(`/api/scenarios/${scenarioId}/characters/lock`)
            .send({ userId: userId1, characterName: oldName });

        
        await request(API_URL)
            .post(`/api/scenarios/${scenarioId}/characters/update`)
            .send({ 
                userId: userId1, 
                oldName: oldName, 
                newName: newName 
            });

        // Provjeravamo da li se u scenariju "alice" (mala slova) NIJE promijenilo
        const res = await request(API_URL).get(`/api/scenarios/${scenarioId}`);
        const text = JSON.stringify(res.body.content);
        
        expect(text).to.contain(newName);
    });

    
    it('treba vratiti samo promjene nastale nakon zadatog timestampa', async () => {
        const sinceTimestamp = 1736520010; // Primjer iz deltas.json 

        const res = await request(API_URL)
            .get(`/api/scenarios/${scenarioId}/deltas`)
            .query({ since: sinceTimestamp }); 

        expect(res.status).to.equal(200);
        // Svi vraćeni deltas moraju imati veći timestamp 
        res.body.deltas.forEach(delta => {
            expect(delta.timestamp).to.be.greaterThan(sinceTimestamp);
        });
    });

    
    it('ne smije dozvoliti Korisniku B da ažurira liniju koju je zaključao Korisnik A', async () => {
        // Korisnik 1 zaključava
        const lock1 = await request(API_URL)
            .post(`/api/scenarios/${scenarioId}/lines/6/lock`)
            .send({ userId: userId1 });

        expect(lock1.body.message).to.contain("uspjesno zakljucana"); 
        // Korisnik 2 pokušava ažurirati 
        const res = await request(API_URL)
            .put(`/api/scenarios/${scenarioId}/lines/6`)
            .send({ 
                userId: userId2, 
                newText: ["Hakerski napad!"] 
            });

        expect(res.status).to.equal(409); 
        expect(res.body.message).to.contain("vec zakljucana"); 
    });
});