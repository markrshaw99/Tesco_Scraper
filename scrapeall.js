const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const cheerio = require('cheerio');

// Helper: delay (ms)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Helper: Auto-scroll the full page to trigger lazy-loading
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let totalHeight = 0;
      const distance = 300; // pixels to scroll each step
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 500);
    });
  });
  // Allow extra time for dynamic content to load after scrolling
  await delay(3000);
}

// Extract all product links from the category page by scanning for <a> tags whose href contains the product path.
// Excludes the current URL (if any) and deduplicates.
async function extractProductLinks(page, currentUrl = '') {
  // Optionally wait a bit more if needed for dynamic content to finish loading.
  await delay(10000);
  return await page.evaluate((currentUrl) => {
    const anchors = Array.from(document.querySelectorAll('a'));
    const links = anchors
      .map(a => a.href)
      .filter(href =>
        href &&
        href.includes('/groceries/en-GB/products/') &&
        href !== currentUrl
      );
    return Array.from(new Set(links)); // remove duplicates
  }, currentUrl);
}

// Extract nutrition data from the product page HTML using Cheerio.
function extractStandardizedNutrition(html) {
  const $ = cheerio.load(html);
  const table = $('.product__info-table');
  if (!table.length) {
    console.warn('Nutritional table not found on page.');
    return null;
  }
  // Find header cells from the table header row.
  const headerCells = table.find('thead tr th');
  let standardIndex = -1;
  headerCells.each((i, cell) => {
    if (i === 0) return; // Skip the first header (label)
    const headerText = $(cell).text().toLowerCase();
    if (headerText.includes('100g') || headerText.includes('100ml')) {
      // Note: tbody rows contain only <td>; subtract 1 from header index.
      standardIndex = i - 1;
      return false; // break out of loop
    }
  });
  if (standardIndex === -1) {
    console.warn("Standardized nutritional column ('Per 100g' or 'Per 100ml') not found.");
    return null;
  }
  const nutritionData = {};
  table.find('tbody tr').each((i, row) => {
    const label = $(row).find('th').first().text().trim();
    const cells = $(row).find('td');
    const value = cells.eq(standardIndex).text().trim();
    if (label && value) {
      nutritionData[label] = value;
    }
  });
  return nutritionData;
}

// Scrape individual product page (given its URL) to extract product title, price, and nutrition data.
async function scrapeProductPage(url, browser) {
  const page = await browser.newPage();
  try {
    console.log(`Scraping product page: ${url}`);
    // Set minimal headers to mimic a real browser.
    await page.setExtraHTTPHeaders({
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:139.0) Gecko/20100101 Firefox/139.0",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.5",
      "Referer": "https://www.tesco.com/"
    });
    page.setDefaultNavigationTimeout(100000);
    // Use a wait condition that waits until the page loads completely
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 100000 });
    await page.waitForSelector('h1[data-auto="pdp-product-title"]', { timeout: 100000 });
    
    // Optional: scroll the product page to trigger any lazy-loading within the product details.
    await autoScroll(page);
    
    // Get the full HTML content of the product page.
    const html = await page.content();
    const $ = cheerio.load(html);
    
    // Extract product title, price, and nutrition data.
    const title = $('h1[data-auto="pdp-product-title"]').text().trim();
    const price = $('p[class*="priceText"]').first().text().trim();
    const nutritionData = extractStandardizedNutrition(html);
    
    console.log(`Scraped: ${title}`);
    return { title, price, nutrition: nutritionData, url };
  } catch (error) {
    console.error(`Error scraping ${url}: ${error.toString()}`);
    return null;
  } finally {
    await page.close();
  }
}

(async () => {
  // Launch browser with stealth settings.
  const browser = await puppeteer.launch({
    headless: true, // Change to false for live debugging
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  // Category page URL for fresh meat and poultry.
  const categoryUrl = "https://www.tesco.com/groceries/en-GB/shop/fresh-food/fresh-meat-and-poultry/all";
  console.log(`Navigating to category page: ${categoryUrl}`);

  // Open the category page.
  const categoryPage = await browser.newPage();
  await categoryPage.setExtraHTTPHeaders({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:139.0) Gecko/20100101 Firefox/139.0",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.5",
    "Referer": "https://www.tesco.com/"
  });
  categoryPage.setDefaultNavigationTimeout(120000);

  // We use "domcontentloaded" to speed up navigation.
  await categoryPage.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });

  // Auto-scroll the category page to trigger lazy-loading of products.
  await autoScroll(categoryPage);

  // Optional: take a screenshot for debugging purposes.
  await categoryPage.screenshot({ path: 'category_debug.png' });
  console.log("Category page screenshot saved as category_debug.png.");

  // Extract all product links from the category page.
  const productLinks = await extractProductLinks(categoryPage);
  console.log(`Found ${productLinks.length} product links on the category page.`);

  // Close the category page – we now have the links.
  await categoryPage.close();

  // Limit to just the first 20 products.
  const linksToProcess = productLinks.slice(0, 20);
  console.log(`Processing ${linksToProcess.length} product links...`);

  // Array to store the final results.
  const results = [];

  // Process each product link sequentially.
  for (const link of linksToProcess) {
    const productData = await scrapeProductPage(link, browser);
    if (productData) {
      results.push(productData);
    }
    // Optionally add a short delay between requests.
    await delay(1000);
  }

  console.log("Final Scraped Product Data (up to 20 products):");
  console.log(JSON.stringify(results, null, 2));

  await browser.close();
})();
