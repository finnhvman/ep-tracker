const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse'); 

const PDF_URL = 'https://storage.googleapis.com/microsites-microservice/ep/ep_elszamolhato_termekek.pdf';
const DOWNLOAD_DIR = path.join(__dirname, 'pdfs');

if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

const honapok = {
    'január': '01', 'február': '02', 'március': '03', 'április': '04',
    'május': '05', 'június': '06', 'július': '07', 'augusztus': '08',
    'szeptember': '09', 'október': '10', 'november': '11', 'december': '12'
};

function extractValidDate(text) {
    const match = text.match(/érvényes:\s*(\d{4})\.\s*([a-záéíóöőúüű]+)\s*(\d{1,2})/i);
    if (match) {
        const ev = match[1];
        const honap = honapok[match[2].toLowerCase()] || '01';
        const nap = match[3].padStart(2, '0');
        return `${ev}-${honap}-${nap}`;
    }
    console.warn('⚠️ Nem találtam érvényességi dátumot, fallback a mai napra.');
    return new Date().toISOString().split('T')[0];
}

function extractProducts(text) {
    const products = new Map();
    const regex = /(\d{8,14})\s+([^\n]+)/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
        const barcode = match[1];
        let name = match[2].trim();
        if (name && !name.includes('Termék neve') && !name.includes('Vonalkód')) {
            products.set(barcode, name);
        }
    }
    return products;
}

// Visszaadja a mappában lévő PDF-eket csökkenő sorrendben (legfrissebb dátum elöl)
function getSortedPdfs() {
    return fs.readdirSync(DOWNLOAD_DIR)
        .filter(file => file.endsWith('.pdf'))
        .sort((a, b) => b.localeCompare(a)) 
        .map(file => path.join(DOWNLOAD_DIR, file));
}

async function run() {
    try {
        console.log(`Letöltés és parse-olás: ${PDF_URL}...`);
        
        const parser = new PDFParse({ url: PDF_URL });
        const result = await parser.getText(); 
        const text = result.text;
        
        const fileDate = extractValidDate(text);
        const newFileName = `${fileDate}_rossmann_ep.pdf`;
        const newFilePath = path.join(DOWNLOAD_DIR, newFileName);

        let newProducts, oldProducts;
        let fileToCompareNew, fileToCompareOld;

        if (fs.existsSync(newFilePath)) {
            console.log(`Ez a fájl már megvan: ${newFileName}. A két legfrissebb lokális fájlt hasonlítom össze...\n`);
            
            const allPdfs = getSortedPdfs();
            if (allPdfs.length < 2) {
                console.log('Csak egy fájl van a mappában. Nincs mihez hasonlítani.');
                return;
            }
            
            fileToCompareNew = allPdfs[0];
            fileToCompareOld = allPdfs[1];

            // Újabb és régebbi lokális fájlok beolvasása
            const parserNew = new PDFParse({ data: fs.readFileSync(fileToCompareNew) });
            newProducts = extractProducts((await parserNew.getText()).text);

            const parserOld = new PDFParse({ data: fs.readFileSync(fileToCompareOld) });
            oldProducts = extractProducts((await parserOld.getText()).text);

        } else {
            // Új fájl érkezett, lementjük
            const response = await fetch(PDF_URL);
            const buffer = Buffer.from(await response.arrayBuffer());
            fs.writeFileSync(newFilePath, buffer);
            console.log(`Új lista mentve: ${newFilePath}\n`);

            const allPdfs = getSortedPdfs();
            fileToCompareNew = allPdfs[0]; // Ez az, amit most mentettünk le

            if (allPdfs.length < 2) {
                console.log('Ez az első lementett fájl. Jövő héten lesz mihez hasonlítani!');
                return;
            }
            fileToCompareOld = allPdfs[1]; // A korábbi legfrissebb

            newProducts = extractProducts(text); // Ennek a textjét már ismerjük a letöltésből
            
            const parserOld = new PDFParse({ data: fs.readFileSync(fileToCompareOld) });
            oldProducts = extractProducts((await parserOld.getText()).text);
        }

        console.log(`Összehasonlítás:\nRégi: ${path.basename(fileToCompareOld)}\nÚj: ${path.basename(fileToCompareNew)}\n`);

        const added = [];
        const removed = [];

        for (const [barcode, name] of newProducts) {
            if (!oldProducts.has(barcode)) added.push({ barcode, name });
        }

        for (const [barcode, name] of oldProducts) {
            if (!newProducts.has(barcode)) removed.push({ barcode, name });
        }

        console.log('--- EREDMÉNY ---\n');

        if (added.length === 0 && removed.length === 0) {
            console.log('Minden a régi, nincs változás.');
            return;
        }

        if (added.length > 0) {
            console.log(`🟢 ÚJ TERMÉKEK (${added.length} db):`);
            added.forEach(p => console.log(`  + [${p.barcode}] ${p.name}`));
            console.log('');
        }

        if (removed.length > 0) {
            console.log(`🔴 LEKERÜLT TERMÉKEK (${removed.length} db):`);
            removed.forEach(p => console.log(`  - [${p.barcode}] ${p.name}`));
        }

    } catch (err) {
        console.error('Baki történt:', err.message);
    }
}

run();