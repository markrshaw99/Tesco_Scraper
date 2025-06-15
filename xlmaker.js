const XLSX = require('xlsx');
const fs = require('fs');

// Read the JSON data from your scraped-data.json file
const data = JSON.parse(fs.readFileSync('scraped-data.json', 'utf8'));

// Compute the union of all nutrition keys
const nutritionKeysSet = new Set();
data.forEach(item => {
  if (item.nutrition) {
    Object.keys(item.nutrition).forEach(key => {
      nutritionKeysSet.add(key);
    });
  }
});
const nutritionKeys = Array.from(nutritionKeysSet);
// Optionally, sort the keys alphabetically
nutritionKeys.sort();

// Prepare a new array of rows where each row is flattened
const rows = data.map(item => {
  // Create base fields
  const row = {
    Title: item.title,
    Price: item.price,
    URL: item.url
  };
  
  // Put each nutrition field into its own property; leave blank if missing.
  nutritionKeys.forEach(key => {
    row[key] = (item.nutrition && item.nutrition[key]) ? item.nutrition[key] : "";
  });
  
  return row;
});

// Convert the processed data into a worksheet
const worksheet = XLSX.utils.json_to_sheet(rows);

// Create a new workbook and add the worksheet
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, worksheet, 'ScrapedData');

// Write the workbook to an Excel file
XLSX.writeFile(workbook, 'scraped-data.xlsx');

console.log('Excel file "scraped-data.xlsx" has been created successfully.');
