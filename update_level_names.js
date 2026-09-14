const fs = require('fs');
const path = require('path');

const dataDir = './data';

// Helper function to convert filename (snake_case) to Title Case
function filenameToTitleCase(filename) {
    // Remove .json extension
    let name = filename.replace('.json', '');
    
    // Split by underscore and capitalize each word
    return name
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

// Get all JSON files in data directory
const files = fs.readdirSync(dataDir).filter(file => file.endsWith('.json'));

console.log(`Found ${files.length} JSON files to process\n`);

let changedCount = 0;
let skippedCount = 0;

files.forEach(file => {
    // Skip special files
    if (file.startsWith('_')) {
        console.log(`⏭️  Skipping special file: ${file}`);
        skippedCount++;
        return;
    }

    const filePath = path.join(dataDir, file);
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    // Convert filename to Title Case for the name field
    const newLevelName = filenameToTitleCase(file);
    
    let updated = false;
    
    // Update the name field if it differs
    if (content.name !== newLevelName) {
        console.log(`📝 ${file}`);
        console.log(`   Name: "${content.name}" → "${newLevelName}"`);
        content.name = newLevelName;
        updated = true;
    }
    
    // Ensure first creator is the author
    if (content.creators && content.creators.length > 0) {
        const firstCreator = content.creators[0];
        if (content.author !== firstCreator) {
            console.log(`   Author: "${content.author}" → "${firstCreator}"`);
            content.author = firstCreator;
            updated = true;
        }
    }
    
    // Write back updated content
    if (updated) {
        fs.writeFileSync(filePath, JSON.stringify(content, null, 4) + '\n');
        changedCount++;
        console.log(`   ✅ Updated\n`);
    } else {
        skippedCount++;
    }
});

console.log(`\n${'='.repeat(50)}`);
console.log(`✅ Complete! Updated: ${changedCount}, Skipped: ${skippedCount}`);
console.log(`${'='.repeat(50)}`);
