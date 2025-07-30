# Example web scraper with Node / Pupeteer

Scraping in this example pet food products from https://zooart.com.pl/pol_m_Psy_Karma-dla-psow_Karma-bytowa-dla-psow_Sucha-karma-dla-psow-1345.html?filter_producer=1331637976&filter_promotion=&filter_series=&filter_traits%5B1332119889%5D=&filter_traits%5B1332118355%5D=&filter_traits%5B1332118360%5D=&filter_traits%5B1332121055%5D=

## The scraper will create two output files:

* zooart_products.json - Complete structured data
* zooart_products.csv - Spreadsheet-friendly format

Remember to respect the website's robots.txt and terms of service when scraping!

## Why Puppeteer?

I chose Puppeteer because:

- JavaScript Rendering: Handles dynamic content that loads via JavaScript
- Real Browser: Behaves like a real browser, avoiding detection
- Reliable Selectors: Can wait for elements to load properly
- Network Control: Can wait for network requests to complete

## Alternative Options

I may prefer other tools next on some other projects:

- Playwright - Similar to Puppeteer but supports multiple browsers
- Cheerio + Axios - Faster but won't handle JavaScript-rendered content
- Selenium - More heavyweight but very reliable