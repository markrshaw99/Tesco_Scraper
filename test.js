const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

(async () => {
  // Launch Puppeteer in non-headless mode for debugging.
  const browser = await puppeteer.launch({
    headless: false,  // Once this works, you can switch to true.
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  // Set a default navigation timeout.
  page.setDefaultNavigationTimeout(120000);
  
  // Set a minimal, allowed set of HTTP headers.
  await page.setExtraHTTPHeaders({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:139.0) Gecko/20100101 Firefox/139.0",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.5",
    "Referer": "https://www.tesco.com/"
  });
  
  const url = "https://www.tesco.com/groceries/en-GB/products/292284222";
  console.log(`Loading page: ${url}`);
  
  try {
    // Use 'domcontentloaded' so that we wait only for the basic HTML.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    // Wait for the product title to appear.
    await page.waitForSelector('h1[data-auto="pdp-product-title"]', { timeout: 120000 });
  } catch (err) {
    console.error("Navigation error:", err.toString());
    await browser.close();
    return;
  }
  
  // For debugging, take a screenshot.
  await page.screenshot({ path: 'debug_page.png' });
  console.log("Screenshot saved as debug_page.png");
  
  const html = await page.content();
  const $ = cheerio.load(html);
  
  // Extract and log the product title.
  const pageTitle = $('h1[data-auto="pdp-product-title"]').text().trim();
  console.log("Page title:", pageTitle);
  
  await browser.close();
})();
