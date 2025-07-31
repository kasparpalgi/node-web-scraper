const fs = require('fs');
const path = require('path');

const PLN_TO_EUR = 0.23;
const PROFIT_MARGIN = 0.10;
const fileName = 'zooart-2025-07-30--20_29_54.json';

const inputPath = path.join(__dirname, 'scraped/zooart/' + fileName);
const outputPath = path.join(__dirname, 'scraped/zooart/eur-' +  fileName);

function convertPrice(pricePLN) {
    const eur = pricePLN * PLN_TO_EUR;
    const withMargin = eur * (1 + PROFIT_MARGIN);
    return Math.round(withMargin * 100) / 100;
}

function convertProducts(products) {
    return products.map(product => {
        // Convert sizes[0].price
        if (product.sizes?.[0]?.price != null) {
            product.sizes[0].price = convertPrice(product.sizes[0].price);
        }

        // Convert unitPrice
        if (product.unitPrice != null) {
            product.unitPrice = convertPrice(product.unitPrice);
        }

        return product;
    });
}

try {
    const raw = fs.readFileSync(inputPath, 'utf-8');
    const products = JSON.parse(raw);
    const converted = convertProducts(products);

    fs.writeFileSync(outputPath, JSON.stringify(converted, null, 2));
    console.log(`✅ Converted products saved to: ${outputPath}`);
} catch (error) {
    console.error('❌ Error processing file:', error.message);
}
