const puppeteer = require('puppeteer');
const fs = require('fs');

const categoryUrl = 'https://zooart.com.pl/pol_m_Psy_Karma-dla-psow_Karma-bytowa-dla-psow_Sucha-karma-dla-psow-1345.html?filter_producer=1331637976&filter_promotion=&filter_series=&filter_traits%5B1332119889%5D=&filter_traits%5B1332118355%5D=&filter_traits%5B1332118360%5D=&filter_traits%5B1332121055%5D=';
const headlessBrowser = false; // set true for production

class ZooartScraper {
    constructor() {
        this.browser = null;
        this.page = null;
        this.products = [];
    }

    async init() {
        this.browser = await puppeteer.launch({
            headless: headlessBrowser,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        this.page = await this.browser.newPage();

        // Set user agent to avoid detection
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        // Set viewport
        await this.page.setViewport({ width: 1920, height: 1080 });
    }

    async getProductLinks(categoryUrl) {
        console.log('Navigating to category page...');
        await this.page.goto(categoryUrl, { waitUntil: 'networkidle2' });

        // Wait for products to load
        await this.page.waitForSelector('.product_wrapper', { timeout: 10000 });

        const productLinks = await this.page.evaluate(() => {
            const productElements = document.querySelectorAll('.product_wrapper .product-name');
            return Array.from(productElements).map(element => {
                return {
                    url: element.href,
                    title: element.textContent.trim()
                };
            });
        });

        console.log(`Found ${productLinks.length} products`);
        return productLinks;
    }

    async scrapeProductData(productUrl) {
        console.log(`Scraping product: ${productUrl}`);

        try {
            await this.page.goto(productUrl, { waitUntil: 'networkidle2' });

            // Wait for the main product form to load
            await this.page.waitForSelector('#projector_form', { timeout: 10000 });

            const productData = await this.page.evaluate(() => {
                const data = {};

                // Basic product info
                data.title = document.querySelector('h1')?.textContent?.trim() || '';
                data.url = window.location.href;

                // Brand/Producer
                data.brand = document.querySelector('.brand')?.textContent?.trim() || '';

                // Product code
                data.productCode = document.querySelector('.code strong')?.textContent?.trim() || '';

                // Series
                data.series = document.querySelector('.series a')?.textContent?.trim() || '';

                // Description
                data.description = document.querySelector('.projector_description li')?.textContent?.trim() || '';

                // Prices
                data.catalogPrice = document.querySelector('#projector_price_srp')?.textContent?.trim() || '';
                data.ourPrice = document.querySelector('#projector_price_value')?.textContent?.trim() || '';
                data.unitPrice = document.querySelector('#unit_converted_price')?.textContent?.trim() || '';

                // Availability/Shipping
                data.shipping = document.querySelector('#projector_delivery_days')?.textContent?.trim() || '';

                // Points
                data.loyaltyPoints = document.querySelector('#projector_points_recive_points')?.textContent?.trim() || '';

                // Labels (bestseller, etc.)
                const labels = [];
                document.querySelectorAll('.label_icons span').forEach(label => {
                    labels.push(label.textContent.trim());
                });
                data.labels = labels;

                // Images
                const images = [];
                document.querySelectorAll('#bx-pager img').forEach(img => {
                    const zoomImage = img.getAttribute('data-zoom-image');
                    if (zoomImage) {
                        images.push('https://zooart.com.pl' + zoomImage);
                    }
                });
                data.images = images;

                // Product ID (from hidden input)
                data.productId = document.querySelector('#projector_product_hidden')?.value || '';

                // Size options
                const sizes = [];
                document.querySelectorAll('.sizes .select_button').forEach(sizeBtn => {
                    sizes.push({
                        type: sizeBtn.getAttribute('data-type'),
                        name: sizeBtn.textContent.trim(),
                        price: sizeBtn.getAttribute('data-price')
                    });
                });
                data.sizes = sizes;

                return data;
            });

            // Add timestamp
            productData.scrapedAt = new Date().toISOString();

            return productData;

        } catch (error) {
            console.error(`Error scraping product ${productUrl}:`, error.message);
            return {
                url: productUrl,
                error: error.message,
                scrapedAt: new Date().toISOString()
            };
        }
    }

    async scrapeAllProducts(categoryUrl, maxProducts = null) {
        await this.init();

        try {
            // Get all product links
            const productLinks = await this.getProductLinks(categoryUrl);

            // Limit products if specified
            const linksToProcess = maxProducts ? productLinks.slice(0, maxProducts) : productLinks;

            console.log(`Starting to scrape ${linksToProcess.length} products...`);

            // Scrape each product
            for (let i = 0; i < linksToProcess.length; i++) {
                const link = linksToProcess[i];
                console.log(`Processing ${i + 1}/${linksToProcess.length}: ${link.title}`);

                const productData = await this.scrapeProductData(link.url);
                this.products.push(productData);

                // Add delay to avoid being blocked
                await this.delay(2000 + Math.random() * 3000);
            }

            console.log(`Scraping completed! Total products: ${this.products.length}`);
            return this.products;

        } catch (error) {
            console.error('Error during scraping:', error);
            throw error;
        } finally {
            await this.close();
        }
    }

    async saveToJson(filename = 'zooart_products.json') {
        const jsonData = JSON.stringify(this.products, null, 2);
        fs.writeFileSync(filename, jsonData, 'utf8');
        console.log(`Data saved to ${filename}`);
    }

    async saveToCSV(filename = 'zooart_products.csv') {
        if (this.products.length === 0) return;

        const headers = Object.keys(this.products[0]).filter(key => key !== 'images' && key !== 'sizes' && key !== 'labels');
        const csvRows = [headers.join(',')];

        this.products.forEach(product => {
            const row = headers.map(header => {
                let value = product[header] || '';
                // Handle arrays by joining them
                if (Array.isArray(value)) {
                    value = value.join('; ');
                }
                // Escape quotes and wrap in quotes if contains comma
                value = value.toString().replace(/"/g, '""');
                if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                    value = `"${value}"`;
                }
                return value;
            });
            csvRows.push(row.join(','));
        });

        fs.writeFileSync(filename, csvRows.join('\n'), 'utf8');
        console.log(`Data saved to ${filename}`);
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
        }
    }
}

// Usage example
async function main() {
    const scraper = new ZooartScraper();

    try {
        // Scrape first 5 products for testing (remove limit for all products)
        const products = await scraper.scrapeAllProducts(categoryUrl, 5);

        // Save to files
        await scraper.saveToJson();
        await scraper.saveToCSV();

        console.log('Sample scraped data:', JSON.stringify(products[0], null, 2));

    } catch (error) {
        console.error('Scraping failed:', error);
    }
}

// Run the scraper
if (require.main === module) {
    main();
}

module.exports = ZooartScraper;