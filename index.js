const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// --- Configuration ---
const projectName = "zooart";
const categoryUrl = 'https://zooart.com.pl/pol_m_Psy_Karma-dla-psow_Karma-bytowa-dla-psow_Sucha-karma-dla-psow-1345.html?filter_producer=1331637976&filter_promotion=&filter_series=&filter_traits%5B1332119889%5D=&filter_traits%5B1332118355%5D=&filter_traits%5B1332118360%5D=&filter_traits%5B1332121055%5D=';
const headlessBrowser = true; // Set true for production
const testing = false; // Set false to scrape all products

// Scroll to bottom (trigger lazy loading)
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

// Navigate to category page, handle cookies, scrape all product links
async function getProductLinks(page, url) {
    console.log('Navigating to category page...');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    try {
        console.log('Checking for cookie consent banner...');
        const cookieButtonSelector = 'button.btn_accept_all_cookies';
        await page.waitForSelector(cookieButtonSelector, { timeout: 5000 });
        console.log('Cookie consent banner found. Clicking "Accept"...');
        await page.click(cookieButtonSelector);
        await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
        console.log('Cookie consent banner not found or already accepted. Continuing...');
    }

    console.log('Waiting for the product container to load...');
    await page.waitForSelector('#search .product_wrapper', { timeout: 10000 });

    console.log('Scrolling down to load all products...');
    await autoScroll(page);
    await new Promise(resolve => setTimeout(resolve, 2000));

    const productLinks = await page.evaluate(() => {
        const productElements = document.querySelectorAll('#search .product_wrapper a.product-name');
        return Array.from(productElements).map(element => ({
            url: element.href,
            title: element.textContent.trim()
        }));
    });

    console.log(`Found ${productLinks.length} products on the page.`);
    return productLinks;
}

// Scrape detailed data for a single product
async function scrapeProductData(page, productUrl) {
    console.log(`Scraping product: ${productUrl}`);
    try {
        await page.goto(productUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForSelector('#projector_form', { timeout: 10000 });

        const productData = await page.evaluate(() => {
            const parseNumber = (text) => {
                if (!text) return null;
                try {
                    const cleanedText = text.replace(',', '.').replace(/[^0-9.]/g, '');
                    const number = parseFloat(cleanedText);
                    return isNaN(number) ? null : number;
                } catch (e) {
                    return null;
                }
            };

            const data = {};
            const baseUrl = 'https://zooart.com.pl';

            // Basic info
            data.title = document.querySelector('h1')?.textContent?.trim() || '';
            data.url = window.location.href;
            data.brand = document.querySelector('.producer a.brand')?.textContent?.trim() || '';
            data.productCode = document.querySelector('.code strong')?.textContent?.trim() || '';
            data.series = document.querySelector('.series a')?.textContent?.trim() || '';

            // Descriptions
            data.shortDescription = document.querySelector('.projector_description')?.textContent?.trim() || '';
            const longDescElement = document.querySelector('.projector_longdescription');
            data.longDescription = longDescElement ? longDescElement.innerText.trim() : '';

            // Prices
            data.catalogPrice = parseNumber(document.querySelector('#projector_price_srp')?.textContent);
            data.unitPrice = parseNumber(document.querySelector('#unit_converted_price')?.textContent);

            // Availability & Shipping
            data.availability = document.querySelector('#projector_status div')?.textContent?.trim() || '';
            data.shipping = document.querySelector('#projector_delivery_days')?.textContent?.trim() || '';

            // Loyalty points
            data.loyaltyPoints = parseNumber(document.querySelector('#projector_points_recive_points')?.textContent);

            // Labels
            data.labels = Array.from(document.querySelectorAll('.label_icons span')).map(el => el.textContent.trim());

            // Images
            const images = [];
            document.querySelectorAll('#bx-pager img').forEach(img => {
                const zoomImage = img.getAttribute('data-zoom-image');
                if (zoomImage) {
                    images.push(baseUrl + zoomImage);
                }
            });
            if (images.length === 0) {
                const mainImg = document.querySelector('#projector_main_photo a');
                if (mainImg && mainImg.href) {
                    images.push(mainImg.href);
                }
            }
            data.images = images;

            // Size/Variant options
            const sizes = [];
            document.querySelectorAll('.sizes a.select_button').forEach(sizeBtn => {
                sizes.push({
                    type: sizeBtn.getAttribute('data-type'),
                    name: sizeBtn.textContent.trim(),
                    price: parseNumber(sizeBtn.getAttribute('data-price'))
                });
            });
            data.sizes = sizes;

            // Product ID
            data.productId = document.querySelector('input[name="product"]')?.value || '';

            return data;
        });

        productData.scrapedAt = new Date().toISOString();
        return productData;

    } catch (error) {
        console.error(`Error scraping product ${productUrl}:`, error.message);
        return {
            url: productUrl,
            error: `Failed to scrape product page. ${error.message}`,
            scrapedAt: new Date().toISOString()
        };
    }
}

// Save data to JSON
function saveToJson(data) {
    const now = new Date();
    const dateStamp = now.toISOString().slice(0, 10);
    const timeStamp = now.toTimeString().slice(0, 5).replace(':', '_');
    const fileName = `${dateStamp}--${timeStamp}.json`;
    const dirPath = path.join('scraped', projectName);
    fs.mkdirSync(dirPath, { recursive: true });
    const filePath = path.join(dirPath, fileName);
    const jsonData = JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, jsonData, 'utf8');
    console.log(`Data successfully saved to ${filePath}`);
}

async function main() {
    let browser = null;
    try {
        console.log('Launching browser...');
        browser = await puppeteer.launch({
            headless: headlessBrowser,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'],
            defaultViewport: null
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        const allProductLinks = await getProductLinks(page, categoryUrl);

        if (allProductLinks.length === 0) {
            console.log('No product links found. Exiting.');
            return;
        }

        let linksToProcess = allProductLinks;

        if (testing) {
            console.log(`--- TESTING MODE ENABLED ---`);
            console.log(`Found ${allProductLinks.length} total products. Will scrape 1 for demonstration.`);
            linksToProcess = allProductLinks.slice(0, 1);
        }

        const scrapedProducts = [];
        console.log(`\nStarting to scrape ${linksToProcess.length} product(s)...`);

        for (let i = 0; i < linksToProcess.length; i++) {
            const link = linksToProcess[i];
            console.log(`\nProcessing ${i + 1}/${linksToProcess.length}: ${link.title}`);
            const productData = await scrapeProductData(page, link.url);
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
            console.log('\nSample of the first scraped product:');
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