// Step 5.1: Import modules
const axios = require('axios');    // Axios for HTTP requests
const cheerio = require('cheerio'); // Cheerio for parsing HTML

// Step 5.2: Define an array of product URLs to scrape.
const productUrls = [
  "https://www.tesco.com/groceries/en-GB/products/292284222",
  "https://www.tesco.com/groceries/en-GB/products/254656399",
];

// Step 5.3: Create a function to extract standardized nutritional data ("Per 100g" or "Per 100ml").
function extractStandardizedNutrition(html) {
  const $ = cheerio.load(html); // Load the HTML into Cheerio

  // Select the nutritional table by its class.
  const table = $('.product__info-table');
  if (!table.length) {
    console.warn('Nutritional table not found in this page.');
    return null;
  }

  // Identify which column in the header contains our standard info.
  // Get header cells and determine the index for "Per 100g" or "Per 100ml".
  const headerCells = table.find('thead tr th');
  let standardIndex = -1;
  headerCells.each((index, cell) => {
    if (index === 0) return; // Skip the first header which is the label column.
    const headerText = $(cell).text().toLowerCase();
    if (headerText.includes('100g') || headerText.includes('100ml')) {
      // In the tbody the data cells are in a separate <td> collection,
      // so subtract 1 from the header index.
      standardIndex = index - 1;
      return false; // Break out of the loop.
    }
  });

  if (standardIndex === -1) {
    console.warn("Standardized nutritional column ('Per 100g' or 'Per 100ml') not found.");
    return null;
  }

  // Extract the nutritional data using the determined column index.
  const nutritionStandard = {};
  table.find('tbody tr').each((i, row) => {
    // The <th> in every row has the nutritional label (e.g., Energy, Fat, etc.)
    const label = $(row).find('th').first().text().trim();
    // Get all <td> cells in the row and select the one at our calculated index.
    const cells = $(row).find('td');
    const value = cells.eq(standardIndex).text().trim();

    if (label && value) {
      nutritionStandard[label] = value;
    }
  });

  return nutritionStandard;
}

// Step 5.4: Create a function to scrape a single product page.
async function scrapeProduct(url) {
  try {
    // Make an HTTP GET request with extra headers to mimic a browser.
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
                      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
                      'Chrome/87.0.4280.66 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.tesco.com/'
      }
    });
    // Extract the standardized nutritional data using our function.
    const nutritionData = extractStandardizedNutrition(response.data);
    console.log(`Standardized nutrition for ${url}:`, nutritionData);
    return nutritionData;
  } catch (error) {
    console.error(`Error scraping ${url}:`, error.toString());
    return null;
  }
}

// Step 5.5: Create a function to loop through all product URLs and scrape each one.
async function scrapeAllProducts() {
  const results = {};
  for (const url of productUrls) {
    const data = await scrapeProduct(url);
    if (data) {
      results[url] = data;
    }
  }
  console.log("All scraped nutritional data (standardized):", results);
  // Optionally, you can write these results to a file or database.
}

// Step 5.6: Kick off the scraping process.
scrapeAllProducts();
