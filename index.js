// --- Dependencies ---
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios'); // For making API requests
require('dotenv').config(); // To load environment variables from .env file

// --- Configuration ---
const projectName = "zooart";
const categoryUrl = 'https://zooart.com.pl/pol_m_Psy_Karma-dla-psow_Karma-bytowa-dla-psow_Sucha-karma-dla-psow-1345.html?filter_producer=1331637976&filter_promotion=&filter_series=&filter_traits%5B1332119889%5D=&filter_traits%5B1332118355%5D=&filter_traits%5B1332118360%5D=&filter_traits%5B1332121055%5D=';
const headlessBrowser = true; // Set true for production
const testing = true; // Set false to scrape all products
const britFood = true;

// --- OpenAI API Function ---
async function callOpenAI(prompt, model = 'gpt-4-turbo') {
    console.log("--- Calling OpenAI API... ---");
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
        console.error("OpenAI API key not found. Make sure it's set in your .env file.");
        return "Translation failed: API key not configured.";
    }

    try {
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions', {
            model: model, // Using the specified model, e.g., 'gpt-4-turbo' or 'gpt-4o'
            messages: [{
                role: "user",
                content: prompt
            }],
            temperature: 0.5, // Controls randomness. Lower is more deterministic.
            max_tokens: 2048, // Limit the length of the response
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
        }
        );

        const translatedText = response.data.choices[0].message.content.trim();
        console.log("--- OpenAI response received successfully. ---");
        return translatedText;

    } catch (error) {
        console.error("Error calling OpenAI API:", error.response ? error.response.data : error.message);
        return `Translation failed due to API error: ${error.message}`;
    }
}


/**
 * Processes scraped data to format title and translate descriptions.
 * @param {object} productData - The raw scraped product data object.
 * @returns {Promise<object>} - The processed and translated product data object.
 */
async function processAndTranslateProduct(productData) {
    // --- 1. Format Brit food title ---
    if (britFood && productData.title && productData.title.toLowerCase().startsWith('brit')) {
        const parts = productData.title.split(' ').filter(p => p);
        if (parts.length >= 4) {
            try {
                const brand = parts[0];
                const weight = parts[parts.length - 1];
                const size = parts[parts.length - 2];
                const ageType = parts[parts.length - 3];
                const seriesName = parts.slice(1, -3).join(' ');

                // UPDATED: Using single quotes for the series name
                productData.title = `${brand} '${seriesName}' - ${ageType} ${size} (${weight})`;
            } catch (e) {
                console.log(`Could not auto-format title for "${productData.title}". Using original.`);
            }
        }
    }

    // --- 2. Translate short description ---
    if (productData.shortDescription) {
        console.log("Translating short description...");
        const shortDescPrompt = `Translate the following Polish text to Estonian like a native speaker would write for a product description. Keep it concise. Provide only the translated text, nothing else.\n\nPolish text: "${productData.shortDescription}"`;
        productData.shortDescription = await callOpenAI(shortDescPrompt);
    }

    // --- 3. Translate and summarize long description ---
    if (productData.longDescription) {
        console.log("Translating and summarizing long description...");
        const longDescPrompt = `You are an expert translator specializing in pet food marketing copy, translating from Polish to Estonian.
Your task is to process the provided Polish product description and create a shortened, structured Estonian version that is clear and easy to read.

Follow these steps:
1.  **Summary:** From the introductory paragraphs of the Polish text, write a short, appealing summary in Estonian. It should explain what the product is, who it's for, and its main benefits.
2.  **Structured Data:** Find the key data sections in the Polish text (like feeding table, ingredients, additives) and translate them directly, keeping the structure. Use Estonian headers.

The final output should be a single string with newlines separating the sections, exactly like this example structure:
<Estonian summary paragraph>

Söötmistabel:
<Translated feeding table>

Koostisosad:
<Translated analytical constituents list>

Toidulisandid 1 kg kohta:
<Translated dietary additives list>

<Translated final notes like metabolic energy, storage instructions, etc.>

---
Here is the Polish text to process:
${productData.longDescription}`;

        productData.longDescription = await callOpenAI(longDescPrompt);
    }

    return productData;
}


// --- Puppeteer Scraping Functions (Unchanged) ---

async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 100;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;
                if (totalHeight >= scrollHeight - window.innerHeight) {
                    setTimeout(() => {
                        clearInterval(timer);
                        resolve();
                    }, 500);
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

// --- Main Execution Logic ---
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