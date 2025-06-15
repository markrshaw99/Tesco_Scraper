const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const fs = require('fs');

// Use the stealth plugin.
puppeteer.use(StealthPlugin());

// Helper: delay function (ms)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Helper: Auto-scroll full page to trigger lazy-loaded content.
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let totalHeight = 0;
      const distance = 300; // pixels per scroll
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
  // Extra delay so content can finish loading.
  await delay(3000);
}

// Extract product links from a category page by scanning all anchor elements.
async function extractProductLinks(page, currentUrl = '') {
  // Additional delay for dynamic content.
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
    return Array.from(new Set(links));
  }, currentUrl);
}

// Extract nutritional data from the product page HTML using Cheerio.
function extractStandardizedNutrition(html) {
  const $ = cheerio.load(html);
  const table = $('.product__info-table');
  if (!table.length) {
    console.warn('Nutritional table not found on page.');
    return null;
  }
  const headerCells = table.find('thead tr th');
  let standardIndex = -1;
  headerCells.each((i, cell) => {
    if (i === 0) return; // Skip the label column.
    const headerText = $(cell).text().toLowerCase();
    if (headerText.includes('100g') || headerText.includes('100ml')) {
      // Adjust index because tbody rows have only <td> elements.
      standardIndex = i - 1;
      return false;
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

// Scrape individual product page to extract title, price, and nutritional info.
async function scrapeProductPage(url, browser) {
  const page = await browser.newPage();
  try {
    console.log(`Scraping product page: ${url}`);
    await page.setExtraHTTPHeaders({
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:139.0) Gecko/20100101 Firefox/139.0",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.5",
      "Referer": "https://www.tesco.com/"
    });
    page.setDefaultNavigationTimeout(100000);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 100000 });
    await page.waitForSelector('h1[data-auto="pdp-product-title"]', { timeout: 100000 });
    // Scroll the product page to ensure any lazy-loading takes effect.
    await autoScroll(page);
    const html = await page.content();
    const $ = cheerio.load(html);
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
  const browser = await puppeteer.launch({
    headless: true,  // Set to false for visual debugging.
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  // Category page URL.
  const categoryUrl = "https://www.tesco.com/groceries/en-GB/shop/fresh-food/fresh-meat-and-poultry/all?sortBy=relevance&count=48";
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
  await categoryPage.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await autoScroll(categoryPage);

  // Optional: Save a screenshot for debugging.
  await categoryPage.screenshot({ path: 'category_debug.png' });
  console.log("Category page screenshot saved as category_debug.png.");
  
  // Collect product links from the first page.
  let allProductLinks = await extractProductLinks(categoryPage);
  console.log(`Found ${allProductLinks.length} product links on page 1.`);
  
  // Pagination: Cycle through additional pages by clicking the "Next" button.
  let currentPage = 1;
  const MAX_PAGES = 10; // Safety limit.
  while (currentPage < MAX_PAGES) {
    // Use the new selector based on the provided HTML.
    const nextButton = await categoryPage.$('a[data-next-previous-btn="next"]');
    if (!nextButton) {
      console.log("No 'Next' button found; reached the end of pagination.");
      break;
    }
    console.log("Clicking 'Next' to load more products...");
    await Promise.all([
      categoryPage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 120000 }),
      nextButton.click()
    ]);
    currentPage++;
    await autoScroll(categoryPage);
    const newLinks = await extractProductLinks(categoryPage);
    console.log(`Found ${newLinks.length} product links on page ${currentPage}.`);
    allProductLinks = Array.from(new Set([...allProductLinks, ...newLinks]));
  }
  
  await categoryPage.close();
  
  console.log(`Total unique product links found: ${allProductLinks.length}`);
  
  // Limit processing to the first 20 product links.
  const linksToProcess = allProductLinks.slice(0, 600);
  console.log(`Processing ${linksToProcess.length} product links...`);
  
  // Array to store data.
  const results = [];
  for (const link of linksToProcess) {
    const data = await scrapeProductPage(link, browser);
    if (data) results.push(data);
    await delay(1000);  // Delay between product requests.
  }
  
  // Save the scraped results to a JSON file.
  fs.writeFileSync('scraped-data.json', JSON.stringify(results, null, 2));
  console.log("Scraped data saved to scraped-data.json.");
  
  await browser.close();
})();
