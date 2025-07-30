// --- Dependencies ---
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

// --- Configuration ---
const openAImodel = 'gpt-4.1';
const aiMaxTokens = 3000;
const aiTemperature = 0.5;
const projectName = "zooart";
const categoryUrl = 'https://zooart.com.pl/pol_m_Psy_Karma-dla-psow_Karma-bytowa-dla-psow_Sucha-karma-dla-psow-1345.html?filter_producer=1331637976&filter_promotion=&filter_series=&filter_traits%5B1332119889%5D=&filter_traits%5B1332118355%5D=&filter_traits%5B1332118360%5D=&filter_traits%5B1332121055%5D=';
const headlessBrowser = true; // Set true for production
const testing = false; // Set false to scrape all products
const britFood = true;

async function callOpenAI(prompt, model = openAImodel) {
    console.log("--- Calling OpenAI API ---");
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
        console.error("OpenAI API key not found. Make sure it's set in your .env file.");
        return null;
    }

    try {
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions', {
            model: model,
            response_format: { type: "json_object" },
            messages: [{
                role: "system",
                content: "You are a helpful native Estonian translator designed to output JSON."
            }, {
                role: "user",
                content: prompt
            }],
            temperature: aiTemperature,
            max_tokens: aiMaxTokens,
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
        }
        );

        const jsonString = response.data.choices[0].message.content;
        console.log("--- OpenAI JSON response received successfully. ---");
        return jsonString;

    } catch (error) {
        console.error("Error calling OpenAI API:", error.response ? error.response.data : error.message);
        return null;
    }
}

async function processAndTranslateProduct(productData) {
    // 1. Format Brit food title
    if (britFood && productData.title && productData.title.toLowerCase().startsWith('brit')) {
        const parts = productData.title.split(' ').filter(p => p);
        if (parts.length >= 4) {
            try {
                const brand = parts[0];
                const weight = parts[parts.length - 1];
                const size = parts[parts.length - 2];
                const ageType = parts[parts.length - 3];
                const seriesName = parts.slice(1, -3).join(' ');
                productData.title = `${brand} '${seriesName}' - ${ageType} ${size} (${weight})`;
            } catch (e) {
                console.log(`Could not auto-format title for "${productData.title}". Using original.`);
            }
        }
    }

    // 2. Translate descriptions with AI
    if (productData.shortDescription || productData.longDescription) {
        console.log("Building combined prompt for translation...");
        const combinedPrompt = `
You are an expert native Estonian translator and marketing copywriter, translating from Polish to Estonian for a pet food e-commerce site.

### TASK
Process the provided Polish product information and generate two Estonian descriptions: a short one and a long one.

### INPUT DATA
- Polish Short Description: "${productData.shortDescription}"
- Polish Long Description: "${productData.longDescription}"

### OUTPUT FORMAT
Your final output MUST be a single, valid JSON object with two keys: "shortDescription" and "longDescription". Do not include any text outside of the JSON object.

### INSTRUCTIONS
1.  **For the "shortDescription" value:** Translate the Polish Short Description into a concise, appealing Estonian marketing sentence.
2.  **For the "longDescription" value:** Use the Polish Long Description to create a structured Estonian version. It must include:
    - A short, appealing summary paragraph.
    - All structured data found (feeding table, ingredients/Koostisosad, additives/Toidulisandid, etc.), translated into Estonian.
    - Preserve the formatting with newlines (\\n) within the JSON string value.

Example JSON structure to return:
{
  "shortDescription": "Täissööt...",
  "longDescription": "BRIT Premium By Nature on täisväärtuslik kuivtoit...\\n\\nSöötmistabel:\\n<tabel>\\n\\nKoostisosad:\\n<koostisosad>..."
}`;

        const jsonResponseString = await callOpenAI(combinedPrompt);

        if (jsonResponseString) {
            try {
                const translatedData = JSON.parse(jsonResponseString);
                // Safely update the product data
                if (translatedData.shortDescription) {
                    productData.shortDescription = translatedData.shortDescription;
                }
                if (translatedData.longDescription) {
                    productData.longDescription = translatedData.longDescription;
                }
            } catch (error) {
                console.error("Failed to parse JSON response from OpenAI:", error);
                // Fallback: keep the original Polish text if parsing fails
                productData.shortDescription += " (Translation Failed)";
                productData.longDescription += " (Translation Failed)";
            }
        } else {
            console.error("No response from OpenAI. Keeping original Polish text.");
        }
    }

    return productData;
}


// --- Puppeteer Scraping Functions ---

async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0; const distance = 100;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance); totalHeight += distance;
                if (totalHeight >= scrollHeight - window.innerHeight) {
                    setTimeout(() => { clearInterval(timer); resolve(); }, 500);
                }
            }, 100);
        });
    });
}

async function getProductLinks(page, url) {
    console.log('Navigating to category page...');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    try {
        const cookieButtonSelector = 'button.btn_accept_all_cookies';
        await page.waitForSelector(cookieButtonSelector, { timeout: 5000 });
        await page.click(cookieButtonSelector);
    } catch (error) {
        console.log('Cookie consent banner not found or already accepted.');
    }
    await page.waitForSelector('#search .product_wrapper', { timeout: 10000 });
    await autoScroll(page);
    await new Promise(resolve => setTimeout(resolve, 2000));
    const productLinks = await page.evaluate(() => {
        const productElements = document.querySelectorAll('#search .product_wrapper a.product-name');
        return Array.from(productElements).map(element => ({ url: element.href, title: element.textContent.trim() }));
    });
    console.log(`Found ${productLinks.length} products on the page.`);
    return productLinks;
}

async function scrapeProductData(page, productUrl) {
    console.log(`Scraping product: ${productUrl}`);
    try {
        await page.goto(productUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForSelector('#projector_form', { timeout: 10000 });
        const productData = await page.evaluate(() => {
            const parseNumber = (text) => text ? parseFloat(text.replace(',', '.').replace(/[^0-9.]/g, '')) || null : null;
            const data = {};
            data.title = document.querySelector('h1')?.textContent?.trim() || '';
            data.url = window.location.href;
            data.brand = document.querySelector('.producer a.brand')?.textContent?.trim() || '';
            data.productCode = document.querySelector('.code strong')?.textContent?.trim() || '';
            data.series = document.querySelector('.series a')?.textContent?.trim() || '';
            data.shortDescription = document.querySelector('.projector_description')?.textContent?.trim() || '';
            data.longDescription = document.querySelector('.projector_longdescription')?.innerText?.trim() || '';
            data.catalogPrice = parseNumber(document.querySelector('#projector_price_srp')?.textContent);
            data.unitPrice = parseNumber(document.querySelector('#unit_converted_price')?.textContent);
            data.availability = document.querySelector('#projector_status div')?.textContent?.trim() || '';
            data.shipping = document.querySelector('#projector_delivery_days')?.textContent?.trim() || '';
            data.loyaltyPoints = parseNumber(document.querySelector('#projector_points_recive_points')?.textContent);
            data.labels = Array.from(document.querySelectorAll('.label_icons span')).map(el => el.textContent.trim());
            data.images = Array.from(document.querySelectorAll('#bx-pager img')).map(img => `https://zooart.com.pl${img.getAttribute('data-zoom-image')}`);
            if (data.images.length === 0) {
                const mainImg = document.querySelector('#projector_main_photo a');
                if (mainImg?.href) data.images.push(mainImg.href);
            }
            data.sizes = Array.from(document.querySelectorAll('.sizes a.select_button')).map(btn => ({ type: btn.dataset.type, name: btn.textContent.trim(), price: parseNumber(btn.dataset.price) }));
            data.productId = document.querySelector('input[name="product"]')?.value || '';
            return data;
        });
        productData.scrapedAt = new Date().toISOString();
        return productData;
    } catch (error) {
        console.error(`Error scraping product ${productUrl}:`, error.message);
        return { url: productUrl, error: `Failed to scrape product page. ${error.message}`, scrapedAt: new Date().toISOString() };
    }
}

function saveToJson(data) {
    const now = new Date();
    const dateStamp = now.toISOString().slice(0, 10);
    const timeStamp = now.toTimeString().slice(0, 5).replace(':', '_');
    const fileName = `${dateStamp}--${timeStamp}.json`;
    const dirPath = path.join('scraped', projectName);
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(path.join(dirPath, fileName), JSON.stringify(data, null, 2), 'utf8');
    console.log(`Data successfully saved to ${path.join(dirPath, fileName)}`);
}

async function main() {
    if (!process.env.OPENAI_API_KEY) {
        console.error("FATAL: OpenAI API key is missing. Please create a .env file with OPENAI_API_KEY=your_key.");
        return;
    }

    let browser = null;
    try {
        console.log('Launching browser...');
        browser = await puppeteer.launch({ headless: headlessBrowser, args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'], defaultViewport: null });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        const allProductLinks = await getProductLinks(page, categoryUrl);
        if (allProductLinks.length === 0) {
            console.log('No product links found. Exiting.');
            return;
        }

        let linksToProcess = testing ? allProductLinks.slice(0, 1) : allProductLinks;
        if (testing) console.log(`--- TESTING MODE: Will scrape 1 of ${allProductLinks.length} products. ---`);

        const scrapedProducts = [];
        console.log(`\nStarting to scrape ${linksToProcess.length} product(s)...`);

        for (let i = 0; i < linksToProcess.length; i++) {
            const link = linksToProcess[i];
            console.log(`\nProcessing ${i + 1}/${linksToProcess.length}: ${link.title}`);
            let productData = await scrapeProductData(page, link.url);

            if (!productData.error) {
                console.log('Post-processing data (formatting title, translating)...');
                productData = await processAndTranslateProduct(productData);
            }

            scrapedProducts.push(productData);

            if (i < linksToProcess.length - 1) {
                const delay = 2000 + Math.random() * 2000;
                console.log(`Waiting for ${Math.round(delay / 1000)}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        console.log(`\nScraping completed! Total products scraped: ${scrapedProducts.length}`);
        if (scrapedProducts.length > 0) {
            saveToJson(scrapedProducts);
            console.log('\nSample of the first scraped product (with all transformations):');
            console.log(JSON.stringify(scrapedProducts[0], null, 2));
        }
    } catch (error) {
        console.error('An error occurred during the scraping process:', error);
    } finally {
        if (browser) {
            console.log('Closing browser...');
            await browser.close();
        }
    }
}

main();